import { readdirSync } from "fs";
import { join } from "path";
import type { FileFilter } from "../ports/FileFilter";
import type { SourceParserRegistry } from "../ports/SourceParserRegistry";
import type { Chunker } from "../systems/ChunkingSystem";
import type { EmbedderRegistry } from "../systems/EmbeddingSystem";
import type { SourceRepository } from "../ports/SourceRepository";
import type { Hasher } from "../systems/HashingSystem";
import type { SourceData, IndexStats, SourceMetadata } from "../types";
import type { FileIndex } from "../ast";
import { generateAstSummary } from "../ast";
import { truncateEmbedContent } from "./embedTruncation";

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
  ) {}

  /**
   * Index all files in `directory`.
   *
   * 1. Recursively scan for files
   * 2. Filter via `fileFilter.shouldInclude`
   * 3. Parse each through the matching `SourceParser`
   * 4. Chunk the parsed content
   * 5. Embed every chunk with **all** applicable embedders (per source type)
   * 6. Build `SourceData` rows and upsert in batch
   * 7. Return aggregate stats
   */
  async index(directory: string): Promise<IndexStats> {
    const files = this.scanDirectory(directory);
    const included = files.filter((f) => this.fileFilter.shouldInclude(f));
    let totalTokens = 0;

    for (const filePath of included) {
      const parser = this.parserRegistry.getParser(filePath);
      if (!parser) continue;

      const parsed = await parser.parse(filePath);
      const chunks = await this.chunker.chunk(parsed.content);
      const sourceId = crypto.randomUUID();

      // Enrich metadata with AST when available
      const metaWithAst = enrichMetadata(parsed.metadata, parsed.fileIndex);

      // Generate AST summary for semantic enrichment
      const astSummary = parsed.fileIndex ? generateAstSummary(parsed.fileIndex) : "";

      const batch: SourceData[] = [];
      let fileTokens = 0;

      for (const chunk of chunks) {
        // Append AST summary to content before embedding (semantic AST search)
        // Truncate to fit model's context window
        const embedContent = await truncateEmbedContent(astSummary, chunk.core_content);

        const semanticHash = await this.hasher.hash(embedContent);

        // Dedup: skip if chunk with same semantic hash already exists
        if (await this.repo.hasSemanticBlake3(semanticHash)) {
          continue;
        }

        fileTokens += chunk.size_tokens;

        const embedder = this.embedderRegistry.getEmbedder(parsed.type);
        const embeddings: number[] = [];

        // Embed via the model registered for this source type (if any)
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
          file_blake3: parsed.file_blake3,
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
        totalTokens += fileTokens;
      }

      // Persist FileIndex if the parser provides one
      if (parsed.fileIndex) {
        await this.repo.upsertFileIndex(parsed.fileIndex);
      }
    }

    const repoStats = await this.repo.stats();
    return { ...repoStats, total_tokens: totalTokens };
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
