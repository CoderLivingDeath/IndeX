import type { FileFilter } from "../ports/FileFilter";
import type { SourceParserRegistry } from "../ports/SourceParserRegistry";
import type { Logger } from "../ports/Logger";
import type { Chunk, Chunker } from "../systems/ChunkingSystem";
import type { Embedder, EmbedderRegistry } from "../systems/EmbeddingSystem";
import type { SourceRepository } from "../ports/SourceRepository";
import type { Hasher } from "../systems/HashingSystem";
import type { SourceData, IndexStats, SourceMetadata } from "../types";
import type { FileIndex } from "../ast";
import { generateAstSummary } from "../ast";
import { truncateEmbedContent } from "./embedTruncation";
import { scanDirectory } from "../../shared/fileUtils";

/**
 * Orchestrates the indexing pipeline: scan directory → filter files →
 * parse each file → chunk → embed via applicable models → upsert to repo.
 *
 * Pure business logic — all external dependencies injected via constructor.
 */
export class IndexingService {
  constructor(
    private readonly fileFilter: FileFilter,
    private readonly parserRegistry: SourceParserRegistry,
    private readonly chunker: Chunker,
    private readonly embedderRegistry: EmbedderRegistry,
    private readonly repo: SourceRepository,
    private readonly hasher: Hasher,
    private readonly logger?: Logger,
  ) {}

  /**
   * Index all files in `directory`.
   *
   * 1. Recursively scan for files
   * 2. Filter via `fileFilter.shouldInclude`
   * 3. Process in **parallel batches** (configurable concurrency) →
   *    Phase A: parse + chunk all files in the batch (parallel)
   *    Phase B: sequential dedup across DB + **in-memory batch set** (no race)
   *    Phase C: group unique chunks by embedder, embedBatch per group
   *    Phase D: build SourceData and upsert
   * 4. Return aggregate stats
   */
  async index(directory: string): Promise<IndexStats> {
    const files = scanDirectory(directory);
    const included = files.filter((f) => this.fileFilter.shouldInclude(f));
    let totalTokens = 0;
    let totalDeduped = 0;
    let totalChunks = 0;
    const totalFiles = included.length;
    let processedFiles = 0;
    let skippedCount = 0;
    const startTime = Date.now();

    const CONCURRENCY = 4;
    let lastLoggedMilestone = 0;

    // Embedding reuse cache shared by all batches in this run. Key includes
    // the model so vectors from different embedders never collide.
    const vectorCache = new Map<string, number[]>();

    this.logger?.info(`Scan complete: ${totalFiles} files to index`);

    for (let offset = 0; offset < included.length; offset += CONCURRENCY) {
      const fileBatch = included.slice(offset, offset + CONCURRENCY);

      // ── Phase A (Parallel): parse + chunk all files in the batch ──
      const parsedBatch = await Promise.all(
        fileBatch.map(async (filePath) => {
          const parser = this.parserRegistry.getParser(filePath);
          if (!parser) return null;

          const parsed = await parser.parse(filePath);
          const chunks = await this.chunker.chunk(parsed.content);
          return {
            filePath,
            parsed,
            chunks,
            sourceId: crypto.randomUUID(),
            metaWithAst: enrichMetadata(parsed.metadata, parsed.fileIndex),
            astSummary: parsed.fileIndex ? generateAstSummary(parsed.fileIndex) : "",
            embedder: this.embedderRegistry.getEmbedder(parsed.type),
          };
        }),
      );

      // ── Phase B (Sequential): prepare every chunk and resolve vectors ──
      // Dedup happens at the embedding level: duplicate content reuses an
      // existing vector, but every file still gets its own chunk rows.
      const entries: ChunkEntry[] = [];
      const dedupedCounts: number[] = new Array(parsedBatch.length).fill(0);

      for (let pi = 0; pi < parsedBatch.length; pi++) {
        const pf = parsedBatch[pi];
        if (!pf) continue;

        for (const chunk of pf.chunks) {
          const embedContent = await truncateEmbedContent(pf.astSummary, chunk.core_content);
          const semanticHash = await this.hasher.hash(embedContent);
          const embedder = pf.embedder;
          entries.push({
            pfIdx: pi,
            chunk,
            embedContent,
            semanticHash,
            embedder,
            key: `${embedder?.model ?? "none"}:${semanticHash}`,
            vector: null,
          });
        }
      }

      // Group identical content so it is embedded at most once per run.
      const byKey = new Map<string, ChunkEntry[]>();
      for (const entry of entries) {
        const group = byKey.get(entry.key);
        if (group) group.push(entry);
        else byKey.set(entry.key, [entry]);
      }

      // Resolve vectors from the run cache or the persisted index.
      const pending: Array<{ key: string; entries: ChunkEntry[] }> = [];
      for (const [key, group] of byKey) {
        const cached = vectorCache.get(key);
        if (cached) {
          for (const entry of group) {
            entry.vector = cached;
            dedupedCounts[entry.pfIdx]!++;
          }
          continue;
        }

        const first = group[0]!;
        if (!first.embedder) continue;

        const existing = await this.repo.getEmbeddingBySemanticHash(first.semanticHash);
        if (existing && existing.length === first.embedder.dimensions) {
          vectorCache.set(key, existing);
          for (const entry of group) {
            entry.vector = existing;
            dedupedCounts[entry.pfIdx]!++;
          }
          continue;
        }

        pending.push({ key, entries: group });
      }

      // ── Phase C: group pending content by embedder, embedBatch per group ──
      const pendingByEmbedder = new Map<Embedder, typeof pending>();
      for (const item of pending) {
        const embedder = item.entries[0]!.embedder!;
        let group = pendingByEmbedder.get(embedder);
        if (!group) { group = []; pendingByEmbedder.set(embedder, group); }
        group.push(item);
      }

      const embedResults = await Promise.all(
        [...pendingByEmbedder.entries()].map(async ([embedder, items]) => {
          const embeddings = await embedder.embedBatch(items.map((i) => i.entries[0]!.embedContent));
          return { items, embeddings };
        }),
      );

      for (const { items, embeddings } of embedResults) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i]!;
          const embedding = embeddings[i]!;
          const vector = [...embedding.vector];
          vectorCache.set(item.key, vector);

          item.entries.forEach((entry, index) => {
            entry.vector = vector;
            // Every duplicate beyond the first was served by reuse.
            if (index > 0) dedupedCounts[entry.pfIdx]!++;
          });
        }
      }

      // ── Phase D: build per-file SourceData and upsert ──────────
      for (let pi = 0; pi < parsedBatch.length; pi++) {
        const pf = parsedBatch[pi];
        if (!pf) { skippedCount++; continue; }

        processedFiles++;
        const relPath = pf.filePath.replace(/\\/g, "/").split("/").slice(-3).join("/");
        const dc = dedupedCounts[pi]!;
        const dcTotal = pf.chunks.length;
        const dedupSuffix = dc === 0 ? "" : dc === dcTotal ? ` (ALL reused)` : ` (${dc}/${dcTotal} reused)`;
        this.logger?.info(`[${processedFiles}/${totalFiles}] ${relPath}${dedupSuffix}`);

        const batch: SourceData[] = [];
        let fileTokens = 0;
        const now = new Date().toISOString();

        for (const entry of entries) {
          if (entry.pfIdx !== pi) continue;
          fileTokens += entry.chunk.size_tokens;
          batch.push({
            id: crypto.randomUUID(),
            chunk_id: crypto.randomUUID(),
            source_id: pf.sourceId,
            type: pf.parsed.type,
            title: pf.filePath,
            content: entry.chunk.content,
            tags: pf.parsed.tags,
            path: pf.filePath,
            file_blake3: pf.parsed.file_blake3,
            semantic_blake3: entry.semanticHash,
            chunk_index: entry.chunk.chunk_index,
            total_chunks: entry.chunk.total_chunks,
            embeddings: entry.vector ?? [],
            metadata: pf.metaWithAst,
            created_at: now,
            updated_at: now,
          });
        }

        totalDeduped += dc;

        // Full indexing is idempotent: replace this file's previous rows
        // before inserting the new ones (the diff service does the same).
        await this.repo.deleteByPath(pf.filePath);
        if (batch.length > 0) {
          await this.repo.upsertBatch(batch);
          totalTokens += fileTokens;
          totalChunks += batch.length;
        }
        if (pf.parsed.fileIndex) {
          await this.repo.upsertFileIndex(pf.parsed.fileIndex);
        }

        // Progress log when crossing a 50-file boundary
        const milestone = Math.floor(processedFiles / 50);
        if (milestone > lastLoggedMilestone) {
          lastLoggedMilestone = milestone;
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
          this.logger?.info(
            `Progress: ${processedFiles}/${totalFiles - skippedCount} files (${elapsed}s) | tokens: ${totalTokens}`,
          );
        }
      }
    }

    // Final progress summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    this.logger?.info(
      `Progress: ${processedFiles}/${totalFiles - skippedCount} files (${elapsed}s) | tokens: ${totalTokens}`,
    );

    // Report stats for THIS run, not the whole repository. Callers that need
    // global totals use repo.stats() / DeleteUseCase.stats().
    return {
      total_sources: processedFiles,
      total_chunks: totalChunks,
      total_files: processedFiles,
      total_tokens: totalTokens,
      total_deduped_chunks: totalDeduped,
      last_indexed: new Date().toISOString(),
    };
  }

}

/** A chunk awaiting (or holding) its embedding for the current batch. */
interface ChunkEntry {
  pfIdx: number;
  chunk: Chunk;
  embedContent: string;
  semanticHash: string;
  embedder: Embedder | null;
  /** Cache key: `${model}:${semanticHash}`. */
  key: string;
  vector: number[] | null;
}

/**
 * Enrich metadata with AST data when fileIndex is available.
 */
function enrichMetadata(
  meta: SourceMetadata,
  fileIndex?: FileIndex,
): SourceMetadata {
  if (!fileIndex || meta.kind !== "code") return meta;
  return {
    ...meta,
    ast: {
      symbols: fileIndex.symbols.map((s) => ({ kind: s.kind, name: s.name, line: s.startPosition.line })),
      imports: fileIndex.imports.map((i) => ({ source: i.source, specifiers: i.specifiers })),
      exports: fileIndex.exports.map((e) => ({ name: e.name, kind: e.kind })),
    },
  };
}
