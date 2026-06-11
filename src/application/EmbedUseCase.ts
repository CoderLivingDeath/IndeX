// ---------------------------------------------------------------------------
// EmbedUseCase — Phase 9
//
// Two modes:
//   source: "chunks"  →  embed existing chunks from SourceRepository
//   source: "files"   →  re-parse files, chunk, then embed and upsert
// ---------------------------------------------------------------------------

import type { EmbedSystems } from "./di/Systems";
import type { SourceData } from "../domain/types";
import { BLAKE3Hasher } from "../infrastructure/hashing/BLAKE3Hasher";
import { truncateEmbedContent } from "../domain/services/embedTruncation";
import { scanDirectory } from "../shared/fileUtils";

/**
 * Options for the EmbedUseCase execution.
 */
export interface EmbedOptions {
  /** Whether to embed existing chunks or re-parse files. */
  source: "chunks" | "files";
  /** Directory to scan (required when source is "files"). */
  directory?: string;
  /** File paths to re-embed (used with source: "chunks"). */
  paths?: string[];
  /** Optional list of model names to use (defaults to all registered). */
  models?: string[];
}

/**
 * Application-level use case for generating embeddings.
 */
export class EmbedUseCase {
  constructor(private readonly systems: EmbedSystems) {}

  /**
   * Execute the embedding process.
   */
  async execute(options: EmbedOptions): Promise<void> {
    this.systems.logger.info(
      `Embedding with source="${options.source}"` +
        (options.directory ? ` directory="${options.directory}"` : ""),
    );

    if (options.source === "chunks") {
      await this.embedFromChunks(options.paths);
    } else {
      await this.embedFromFiles(options.directory);
    }
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Re-embed existing chunks from the repository.
   * When `paths` is provided, only those paths are re-embedded.
   */
  private async embedFromChunks(paths?: string[]): Promise<void> {
    if (!paths || paths.length === 0) {
      this.systems.logger.info("No paths specified for chunk embedding — skipping");
      return;
    }

    const batch: SourceData[] = [];

    for (const filePath of paths) {
      const existing = await this.systems.repo.getByPath(filePath);
      if (existing.length === 0) continue;

      for (const source of existing) {
        const embedder = this.systems.embedderRegistry.getEmbedder(source.type);
        if (!embedder) continue;

        const embedContent = await truncateEmbedContent("", source.content);
        const result = await embedder.embed(embedContent);
        source.embeddings = result.vector;
        source.updated_at = new Date().toISOString();
        batch.push(source);
      }
    }

    // Upsert updated chunks
    for (const item of batch) {
      await this.systems.repo.upsert(item);
    }

    this.systems.logger.info(`Re-embedded ${batch.length} chunks from ${paths.length} paths`);
  }

  /**
   * Scan directory, parse files, chunk, embed, and upsert.
   */
  private async embedFromFiles(directory?: string): Promise<void> {
    const dir = directory ?? ".";
    this.systems.logger.info(`Scanning ${dir} for files to embed`);

    const hasher = new BLAKE3Hasher();
    const allFiles = scanDirectory(dir);

    const matched = this.systems.fileFilter
      ? allFiles.filter((f) => this.systems.fileFilter!.shouldInclude(f))
      : allFiles;

    const batch: SourceData[] = [];

    for (const filePath of matched) {
      const parser = this.systems.parserRegistry?.getParser(filePath);
      if (!parser) continue;

      const parsed = await parser.parse(filePath);
      const chunks = await this.systems.chunker!.chunk(parsed.content);
      const sourceId = crypto.randomUUID();
      const now = new Date().toISOString();

      for (const chunk of chunks) {
        const embedder = this.systems.embedderRegistry.getEmbedder(parsed.type);
        let embeddings: number[] = [];

        if (embedder) {
          const embedContent = await truncateEmbedContent("", chunk.core_content);
          const result = await embedder.embed(embedContent);
          embeddings = result.vector;
        }

        batch.push({
          id: crypto.randomUUID(),
          chunk_id: crypto.randomUUID(),
          source_id: sourceId,
          type: parsed.type,
          title: filePath,
          content: chunk.content,
          tags: parsed.tags,
          path: filePath,
          file_blake3: parsed.file_blake3,
          semantic_blake3: await hasher.hash(chunk.core_content),
          chunk_index: chunk.chunk_index,
          total_chunks: chunk.total_chunks,
          embeddings,
          metadata: parsed.metadata,
          created_at: now,
          updated_at: now,
        });
      }
    }

    if (batch.length > 0) {
      await this.systems.repo.upsertBatch(batch);
    }

    this.systems.logger.info(`Embedded and upserted ${batch.length} chunks`);
  }

}