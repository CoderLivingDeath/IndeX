// ---------------------------------------------------------------------------
// ChunkUseCase — Phase 9
//
// Scans a directory, filters files by include/exclude patterns, parses each
// through the SourceParserRegistry, and chunks the content via a Chunker.
// ---------------------------------------------------------------------------

import { readdirSync } from "fs";
import { join } from "path";
import type { ChunkSystems } from "./di/Systems";
import type { Chunk } from "../domain/systems/ChunkingSystem";

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
 * Very simple glob-like matcher — mirrors the one in PackUseCase.
 */
function matchesGlob(pattern: string, filePath: string): boolean {
  const normalised = filePath.replace(/\\/g, "/");
  if (pattern.startsWith("**/")) {
    const suffix = pattern.slice(3);
    if (suffix.includes("*")) {
      const ext = suffix.slice(1);
      return normalised.endsWith(ext);
    }
    return normalised.endsWith(`/${suffix}`) || normalised.endsWith(suffix);
  }
  if (pattern === "*") return !filePath.includes("/") && !filePath.includes("\\");
  return filePath.includes(pattern);
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
    const allFiles = this.scanDirectory(directory);

    // 2. Apply fileFilter
    let matched = allFiles.filter((f) =>
      this.systems.fileFilter.shouldInclude(f),
    );

    // 3. Apply PackOptions include/exclude
    if (options?.include && options.include.length > 0) {
      matched = matched.filter((f) =>
        options.include!.some((pattern) => matchesGlob(pattern, f)),
      );
    }
    if (options?.exclude && options.exclude.length > 0) {
      matched = matched.filter(
        (f) => !options.exclude!.some((pattern) => matchesGlob(pattern, f)),
      );
    }

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
