// ---------------------------------------------------------------------------
// TreeSnapshot — compute a hash of the directory tree for change detection
//
// Creates a deterministic BLAKE3 hash from the sorted list of
// (relativePath, mtimeMs) for all files matching the file filter.
// If the hash hasn't changed, the tree is unchanged and no sync is needed.
//
// Skips directories that match any exclude pattern to avoid traversing
// node_modules, .git, etc.
// ---------------------------------------------------------------------------

import { statSync, readdirSync } from "fs";
import { join, relative, resolve } from "path";
import type { FileFilter } from "../domain/ports/FileFilter";
import type { Hasher } from "../domain/systems/HashingSystem";
import { matchesAny } from "./globMatcher";

export interface TreeEntry {
  /** Absolute path to the file */
  path: string;
  /** Path relative to the scanned root directory */
  relativePath: string;
  /** Last modification time in milliseconds */
  mtimeMs: number;
}

export interface TreeSnapshot {
  entries: TreeEntry[];
  /** BLAKE3 hash of the sorted tree state */
  hash: string;
}

function shouldSkipDir(dirPath: string, excludePatterns: string[]): boolean {
  if (excludePatterns.length === 0) return false;
  const normalised = dirPath.replace(/\\/g, "/");
  const dirPattern = normalised.endsWith("/") ? `${normalised}**` : `${normalised}/**`;
  return matchesAny(excludePatterns, dirPattern);
}

function collectEntries(
  root: string,
  currentDir: string,
  fileFilter: FileFilter,
  excludePatterns: string[],
  out: TreeEntry[],
): void {
  if (root !== currentDir && shouldSkipDir(currentDir, excludePatterns)) {
    return;
  }

  try {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        collectEntries(root, fullPath, fileFilter, excludePatterns, out);
      } else if (entry.isFile()) {
        if (!fileFilter.shouldInclude(fullPath)) continue;
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(fullPath).mtimeMs;
        } catch {
          continue;
        }
        out.push({
          path: fullPath,
          relativePath: relative(root, fullPath),
          mtimeMs,
        });
      }
    }
  } catch {
    // Skip directories that can't be read
  }
}

/**
 * Scan dir and produce a TreeSnapshot.
 *
 * The hash is computed from the sorted concatenation of
 * relativePath|mtimeMs for every file that passes fileFilter.
 *
 * @param dir Root directory to scan
 * @param fileFilter File filter to determine which files to include
 * @param hasher Hasher for computing the BLAKE3 hash
 * @param excludePatterns Glob patterns for directories to skip entirely
 */
export async function computeTreeSnapshot(
  dir: string,
  fileFilter: FileFilter,
  hasher: Hasher,
  excludePatterns: string[] = [],
): Promise<TreeSnapshot> {
  const root = resolve(dir);
  const entries: TreeEntry[] = [];
  collectEntries(root, root, fileFilter, excludePatterns, entries);

  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const lines: string[] = [];
  for (const e of entries) {
    lines.push(`${e.relativePath}|${e.mtimeMs}`);
  }

  const hash = await hasher.hash(lines.join("\n"));

  return { entries, hash };
}
