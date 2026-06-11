import type { FileFilter } from "../ports/FileFilter";
import type { SourceParserRegistry } from "../ports/SourceParserRegistry";
import type { Logger } from "../ports/Logger";
import type { Chunker } from "../systems/ChunkingSystem";
import type { Embedder, Embedding, EmbedderRegistry } from "../systems/EmbeddingSystem";
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
    const totalFiles = included.length;
    let processedFiles = 0;
    let skippedCount = 0;
    const startTime = Date.now();

    const CONCURRENCY = 4;
    let lastLoggedMilestone = 0;

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

      // ── Phase B (Sequential): dedup across DB + in-memory batch set ──
      // seenHashes prevents race within the batch: even though upsert
      // hasn't happened yet, we remember hashes we already committed to.
      const seenHashes = new Set<string>();
      // Flat list of all unique (non-deduped) chunks across the batch
      const uniqueChunks: Array<{
        pfIdx: number;
        chunk: import("../../domain/systems/ChunkingSystem").Chunk;
        embedContent: string;
        semanticHash: string;
      }> = [];
      const dedupedCounts: number[] = new Array(parsedBatch.length).fill(0);

      for (let pi = 0; pi < parsedBatch.length; pi++) {
        const pf = parsedBatch[pi];
        if (!pf) continue;

        for (const chunk of pf.chunks) {
          const embedContent = await truncateEmbedContent(pf.astSummary, chunk.core_content);
          const semanticHash = await this.hasher.hash(embedContent);

          // Sequential: check DB (already persisted) + in-memory (current batch)
          if (seenHashes.has(semanticHash) || await this.repo.hasSemanticBlake3(semanticHash)) {
            dedupedCounts[pi]!++;
            continue;
          }

          seenHashes.add(semanticHash);
          uniqueChunks.push({ pfIdx: pi, chunk, embedContent, semanticHash });
        }
      }

      // ── Phase C: group unique chunks by embedder, embedBatch per group ──
      const embedderGroups = new Map<Embedder, typeof uniqueChunks>();
      for (const uc of uniqueChunks) {
        const pf = parsedBatch[uc.pfIdx]!;
        if (!pf.embedder) continue;
        let group = embedderGroups.get(pf.embedder);
        if (!group) { group = []; embedderGroups.set(pf.embedder, group); }
        group.push(uc);
      }

      const embedResults = await Promise.all(
        [...embedderGroups.entries()].map(async ([embedder, items]) => {
          const texts = items.map((i) => i.embedContent);
          const embeddings = await embedder.embedBatch(texts);
          return { items, embeddings };
        }),
      );

      // Map each unique chunk → its embedding (or undefined if no embedder)
      const chunkEmbedding = new Map<(typeof uniqueChunks)[number], Embedding>();
      for (const { items, embeddings } of embedResults) {
        for (let i = 0; i < items.length; i++) {
          chunkEmbedding.set(items[i]!, embeddings[i]!);
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
        const dedupSuffix = dc === 0 ? "" : dc === dcTotal ? ` (ALL deduped)` : ` (${dc}/${dcTotal} deduped)`;
        this.logger?.info(`[${processedFiles}/${totalFiles}] ${relPath}${dedupSuffix}`);

        const batch: SourceData[] = [];
        let fileTokens = 0;

        for (const uc of uniqueChunks) {
          if (uc.pfIdx !== pi) continue;
          const embedding = chunkEmbedding.get(uc);
          fileTokens += uc.chunk.size_tokens;
          const now = new Date().toISOString();
          batch.push({
            id: crypto.randomUUID(),
            chunk_id: crypto.randomUUID(),
            source_id: pf.sourceId,
            type: pf.parsed.type,
            title: pf.filePath,
            content: uc.chunk.content,
            tags: pf.parsed.tags,
            path: pf.filePath,
            file_blake3: pf.parsed.file_blake3,
            semantic_blake3: uc.semanticHash,
            chunk_index: uc.chunk.chunk_index,
            total_chunks: uc.chunk.total_chunks,
            embeddings: embedding ? [...embedding.vector] : [],
            metadata: pf.metaWithAst,
            created_at: now,
            updated_at: now,
          });
        }

        totalDeduped += dedupedCounts[pi]!;

        if (batch.length > 0) {
          await this.repo.upsertBatch(batch);
          totalTokens += fileTokens;
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

    const repoStats = await this.repo.stats();
    return { ...repoStats, total_tokens: totalTokens, total_deduped_chunks: totalDeduped };
  }

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
