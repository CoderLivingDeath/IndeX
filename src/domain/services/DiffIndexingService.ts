import { readdirSync } from "fs";
import { join } from "path";
import type { FileFilter } from "../ports/FileFilter";
import type { SourceParserRegistry } from "../ports/SourceParserRegistry";
import type { Chunker } from "../systems/ChunkingSystem";
import type { EmbedderRegistry } from "../systems/EmbeddingSystem";
import type { SourceRepository } from "../ports/SourceRepository";
import type { Hasher } from "../systems/HashingSystem";
import type { SourceData, SourceMetadata } from "../types";
import type { FileIndex } from "../ast";
import { generateAstSummary } from "../ast";
import { truncateEmbedContent } from "./embedTruncation";

export interface DiffIndexResult {
  indexed: number;
  skipped: number;
  errors: number;
}

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
export class DiffIndexingService {
  constructor(
    private readonly hasher: Hasher,
    private readonly parserRegistry: SourceParserRegistry,
    private readonly chunker: Chunker,
    private readonly embedderRegistry: EmbedderRegistry,
    private readonly repo: SourceRepository,
    private readonly fileFilter: FileFilter,
  ) {}

  async diffIndex(directory: string): Promise<DiffIndexResult> {
    const files = this.scanDirectory(directory);
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

    const batch: SourceData[] = [];

    for (const chunk of chunks) {
      // Append AST summary to content before embedding (semantic AST search)
      // Truncate to fit model's context window
      const embedContent = await truncateEmbedContent(astSummary, chunk.core_content);

      const semanticHash = await this.hasher.hash(embedContent);
      const embedder = this.embedderRegistry.getEmbedder(parsed.type);
      const embeddings: number[] = [];

      if (embedder) {
        const result = await embedder.embed(embedContent);
        embeddings.push(...result.vector);
      }

      const now = new Date().toISOString();

      batch.push({
        id: crypto.randomUUID(),
        chunk_id: crypto.randomUUID(),
        source_id: sourceId,
        type: parsed.type,
        title: filePath,
        content: chunk.content,
        tags: parsed.tags,
        path: filePath,
        file_blake3: fileHash,
        semantic_blake3: semanticHash,
        chunk_index: chunk.chunk_index,
        total_chunks: chunk.total_chunks,
        embeddings,
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

  /** Recursively collect all file paths under `dir`. */
  private scanDirectory(dir: string): string[] {
    const results: string[] = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.scanDirectory(fullPath));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
    return results;
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
