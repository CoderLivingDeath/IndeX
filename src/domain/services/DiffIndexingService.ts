import type { FileFilter } from "../ports/FileFilter";
import type { SourceParserRegistry } from "../ports/SourceParserRegistry";
import type { Chunk, Chunker } from "../systems/ChunkingSystem";
import type { EmbedderRegistry } from "../systems/EmbeddingSystem";
import type { SourceRepository } from "../ports/SourceRepository";
import type { Hasher } from "../systems/HashingSystem";
import type { SourceData, SourceMetadata } from "../types";
import type { FileIndex } from "../ast";
import { generateAstSummary } from "../ast";
import { truncateEmbedContent } from "./embedTruncation";
import { scanDirectory } from "../../shared/fileUtils";

export interface DiffIndexResult {
  indexed: number;
  skipped: number;
  errors: number;
}

export class DiffIndexingService {
  /**
   * Incremental / differential indexing service.
   *
   * For every file that matches the filter:
   *  1. Compute the current `file_blake3`.
   *  2. Compare against the stored hash.
   *  3. **Match** → skip (no re-processing).
   *  4. **Mismatch** (or new file) → re-process: parse → chunk → embed →
   *     delete old chunks → upsert new ones → rebuild FileIndex.
   *
   * Cross-file semantic dedup is implicit: old chunks are deleted via
   * `deleteByPath` (scoped to the changed file only), so shared hashes
   * survive via other files that still reference them.
   */
  constructor(
    private readonly hasher: Hasher,
    private readonly parserRegistry: SourceParserRegistry,
    private readonly chunker: Chunker,
    private readonly embedderRegistry: EmbedderRegistry,
    private readonly repo: SourceRepository,
    private readonly fileFilter: FileFilter,
  ) {}

  /**
   * Process a single file for changes. Used by the watch daemon to avoid
   * scanning the entire directory on every event.
   *
   * Returns `{ indexed: 1 }` if the file was re-processed,
   * `{ skipped: 1 }` if unchanged, or `{ errors: 1 }` on failure.
   */
  async diffIndexFile(filePath: string): Promise<DiffIndexResult> {
    try {
      if (!this.fileFilter.shouldInclude(filePath)) {
        return { indexed: 0, skipped: 1, errors: 0 };
      }

      const content = await Bun.file(filePath).text();
      const currentHash = await this.hasher.hash(content);
      const storedHash = await this.repo.getFileBlake3ByPath(filePath);

      if (storedHash === currentHash) {
        return { indexed: 0, skipped: 1, errors: 0 };
      }

      await this.reprocessFile(filePath, currentHash);
      return { indexed: 1, skipped: 0, errors: 0 };
    } catch {
      return { indexed: 0, skipped: 0, errors: 1 };
    }
  }

  async diffIndex(directory: string): Promise<DiffIndexResult> {
    const files = scanDirectory(directory);
    const included = files.filter((f) => this.fileFilter.shouldInclude(f));

    let indexed = 0;
    let skipped = 0;
    let errors = 0;

    for (const filePath of included) {
      try {
        const content = await Bun.file(filePath).text();
        const currentHash = await this.hasher.hash(content);
        const storedHash = await this.repo.getFileBlake3ByPath(filePath);

        // File unchanged → skip
        if (storedHash === currentHash) {
          skipped++;
          continue;
        }

        // File is new or changed → full re-processing
        await this.reprocessFile(filePath, currentHash);
        indexed++;
      } catch {
        errors++;
      }
    }

    return { indexed, skipped, errors };
  }

  // ── Private helpers ────────────────────────────────────────

  private async reprocessFile(
    filePath: string,
    fileHash: string,
  ): Promise<void> {
    // 1. Delete existing chunks for this path (cross-file dedup is implicit
    //    because deleteByPath only removes entries scoped to `filePath`).
    await this.repo.deleteByPath(filePath);

    // 2. Parse → chunk → embed (same pipeline as IndexingService)
    const parser = this.parserRegistry.getParser(filePath);
    if (!parser) return;

    const parsed = await parser.parse(filePath);
    const chunks = await this.chunker.chunk(parsed.content);
    const sourceId = crypto.randomUUID();

    const metaWithAst = enrichMetadata(parsed.metadata, parsed.fileIndex);

    // Generate AST summary for semantic enrichment
    const astSummary = parsed.fileIndex ? generateAstSummary(parsed.fileIndex) : "";
    const embedder = this.embedderRegistry.getEmbedder(parsed.type);

    const entries: DiffChunkEntry[] = [];
    for (const chunk of chunks) {
      // Append AST summary to content before embedding (semantic AST search)
      // Truncate to fit model's context window.
      const embedContent = await truncateEmbedContent(astSummary, chunk.core_content);
      const semanticHash = await this.hasher.hash(embedContent);
      entries.push({
        chunk,
        embedContent,
        semanticHash,
        key: `${embedder?.model ?? "none"}:${semanticHash}`,
        vector: null,
      });
    }

    // Group identical content: embed once, reuse the vector for duplicates.
    const byKey = new Map<string, DiffChunkEntry[]>();
    for (const entry of entries) {
      const group = byKey.get(entry.key);
      if (group) group.push(entry);
      else byKey.set(entry.key, [entry]);
    }

    const pending: Array<{ key: string; entries: DiffChunkEntry[] }> = [];
    for (const [key, group] of byKey) {
      const first = group[0]!;
      if (!embedder) continue;

      const existing = await this.repo.getEmbeddingBySemanticHash(first.semanticHash);
      if (existing && existing.length === embedder.dimensions) {
        for (const entry of group) entry.vector = existing;
        continue;
      }
      pending.push({ key, entries: group });
    }

    if (pending.length > 0 && embedder) {
      const embeddings = await embedder.embedBatch(
        pending.map((p) => p.entries[0]!.embedContent),
      );
      for (let i = 0; i < pending.length; i++) {
        const vector = [...embeddings[i]!.vector];
        for (const entry of pending[i]!.entries) entry.vector = vector;
      }
    }

    const batch: SourceData[] = [];
    const now = new Date().toISOString();

    for (const entry of entries) {
      batch.push({
        id: crypto.randomUUID(),
        chunk_id: crypto.randomUUID(),
        source_id: sourceId,
        type: parsed.type,
        title: filePath,
        content: entry.chunk.content,
        tags: parsed.tags,
        path: filePath,
        file_blake3: fileHash,
        semantic_blake3: entry.semanticHash,
        chunk_index: entry.chunk.chunk_index,
        total_chunks: entry.chunk.total_chunks,
        embeddings: entry.vector ?? [],
        metadata: metaWithAst,
        created_at: now,
        updated_at: now,
      });
    }

    if (batch.length > 0) {
      await this.repo.upsertBatch(batch);
    }

    // 3. Rebuild FileIndex if the parser provides one
    if (parsed.fileIndex) {
      await this.repo.upsertFileIndex(parsed.fileIndex);
    }
  }

}

/** A chunk awaiting (or holding) its embedding for a single file reprocess. */
interface DiffChunkEntry {
  chunk: Chunk;
  embedContent: string;
  semanticHash: string;
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
