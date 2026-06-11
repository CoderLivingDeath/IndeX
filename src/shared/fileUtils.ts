// ---------------------------------------------------------------------------
// fileUtils — shared file system utilities
//
// Consolidates recursive file scanning to eliminate duplication across
// IndexingService, DiffIndexingService, PackUseCase, ChunkUseCase, EmbedUseCase.
// ---------------------------------------------------------------------------

import { readdirSync } from "fs";
import { join } from "path";

/**
 * Recursively collect all file paths under a directory.
 *
 * This is the canonical implementation — all use cases should call this
 * instead of implementing their own scanDirectory.
 *
 * @param dir - Absolute or relative path to scan
 * @returns Flat array of absolute file paths
 */
export function scanDirectory(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...scanDirectory(fullPath));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  } catch {
    // Skip directories that can't be read (permission errors etc.)
  }
  return results;
}
