// ---------------------------------------------------------------------------
// globMatcher — shared glob pattern matching utility
//
// Wraps micromatch for consistent glob matching across the entire project.
// All include/exclude pattern matching goes through this single function.
// ---------------------------------------------------------------------------

import micromatch from "micromatch";

/**
 * Check if a file path matches any of the given glob patterns.
 *
 * - Path separators are normalized to `/` internally.
 * - Supports all micromatch glob patterns: `**`, `*`, `?`, `{a,b}`, etc.
 * - Returns `false` for empty patterns array.
 *
 * @param patterns - Array of glob patterns (e.g. `[".ts", "*.test.ts"]`)
 * @param filePath - Absolute or relative file path
 * @returns `true` if the path matches at least one pattern
 */
export function matchesAny(patterns: string[], filePath: string): boolean {
  if (!patterns || patterns.length === 0) return false;
  const normalised = filePath.replace(/\\/g, "/");
  return micromatch.isMatch(normalised, patterns, { dot: true });
}

/**
 * Check if a file path matches ALL of the given glob patterns.
 *
 * @param patterns - Array of glob patterns
 * @param filePath - File path to check
 * @returns `true` if the path matches every pattern
 */
export function matchesAll(patterns: string[], filePath: string): boolean {
  if (!patterns || patterns.length === 0) return false;
  const normalised = filePath.replace(/\\/g, "/");
  return micromatch.every(normalised, patterns, { dot: true });
}

/**
 * Filter an array of file paths by include/exclude glob patterns.
 *
 * - `include` (optional): keep only files matching at least one pattern
 * - `exclude` (optional): remove files matching any pattern
 * - Patterns use micromatch glob syntax
 *
 * @param files - Array of file paths
 * @param opts - Optional include/exclude patterns
 * @returns Filtered file array
 */
export function filterByGlob(
  files: string[],
  opts?: { include?: string[]; exclude?: string[] },
): string[] {
  let result = files;
  if (opts?.include && opts.include.length > 0) {
    const patterns = opts.include;
    result = result.filter((f) => matchesAny(patterns, f));
  }
  if (opts?.exclude && opts.exclude.length > 0) {
    const patterns = opts.exclude;
    result = result.filter((f) => !matchesAny(patterns, f));
  }
  return result;
}
