// ---------------------------------------------------------------------------
// ChunkUseCase — Phase 9
//
// Scans a directory, filters files by include/exclude patterns, parses each
// through the SourceParserRegistry, and chunks the content via a Chunker.
// ---------------------------------------------------------------------------

import type { ChunkSystems } from "./di/Systems";
import type { Chunk } from "../domain/systems/ChunkingSystem";
import { scanDirectory } from "../shared/fileUtils";
import { filterByGlob } from "../shared/globMatcher";

/**
 * Options that control which files are included in chunking.
 */
export interface ChunkOptions {
  /** Glob patterns to include (e.g. `["**\/*.md"]`). */
  include?: string[];
  /** Glob patterns to exclude (e.g. `["**\/*.test.ts"]`). */
  exclude?: string[];
}

/**
 * Application-level use case for chunking source files in a directory.
 */
export class ChunkUseCase {
  constructor(private readonly systems: ChunkSystems) {}

  /**
   * Chunk all matching files from `directory`.
   *
   * @param directory - Root directory to scan.
   * @param options   - Optional include/exclude glob patterns.
   * @returns An array of Chunks from the matching files.
   */
  async execute(
    directory: string,
    options?: ChunkOptions,
  ): Promise<Chunk[]> {
    this.systems.logger.info(`Chunking ${directory}`);

    // 1. Recursively scan
    const allFiles = scanDirectory(directory);

    // 2. Apply fileFilter
    let matched = allFiles.filter((f) =>
      this.systems.fileFilter.shouldInclude(f),
    );

    // 3. Apply include/exclude glob patterns (via micromatch)
    matched = filterByGlob(matched, options);

    // 4. Parse and chunk
    const allChunks: Chunk[] = [];
    for (const filePath of matched) {
      const parser = this.systems.parserRegistry.getParser(filePath);
      if (!parser) continue;

      const parsed = await parser.parse(filePath);
      const chunks = await this.systems.chunker.chunk(parsed.content);
      allChunks.push(...chunks);
    }

    this.systems.logger.info(
      `Chunking produced ${allChunks.length} chunks from ${matched.length} files`,
    );

    return allChunks;
  }

}
