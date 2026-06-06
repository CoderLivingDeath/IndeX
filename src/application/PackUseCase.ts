// ---------------------------------------------------------------------------
// PackUseCase — Phase 9
//
// Scans a directory, filters files by include/exclude patterns, parses each
// through the SourceParserRegistry, and concatenates them into a single
// PackedContext markdown document suitable for LLM consumption.
// ---------------------------------------------------------------------------

import { readdirSync } from "fs";
import { join, relative } from "path";
import type { PackSystems } from "./di/Systems";
import type { PackedContext } from "../domain/systems/ContextPackagingSystem";

/**
 * Options that control which files are included in the packed output.
 */
export interface PackOptions {
  /** Glob patterns to include (e.g. `["**\/*.md"]`). */
  include?: string[];
  /** Glob patterns to exclude (e.g. `["**\/*.test.ts"]`). */
  exclude?: string[];
  /** Token budget — when specified the output is truncated. */
  maxTokens?: number;
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Very simple glob-like matcher.
 *
 * Supported patterns:
 *   - `**\/*.ext`  — any file with extension `.ext` at any depth
 *   - `**\/name`   — any file named `name` at any depth
 *   - `*`          — any filename (no directory separator)
 *
 * Falls back to substring matching for other patterns.
 */
function matchesGlob(pattern: string, filePath: string): boolean {
  // Normalise separators
  const normalised = filePath.replace(/\\/g, "/");

  if (pattern.startsWith("**/")) {
    const suffix = pattern.slice(3); // e.g. "*.md"
    if (suffix.includes("*")) {
      // `**/*.ext` → ends with `.ext`
      const ext = suffix.slice(1); // ".md"
      return normalised.endsWith(ext);
    }
    // `**/filename` → ends with `/filename`
    return normalised.endsWith(`/${suffix}`) || normalised.endsWith(suffix);
  }

  if (pattern === "*") return !filePath.includes("/") && !filePath.includes("\\");

  return filePath.includes(pattern);
}

/**
 * Crude token estimate: ~1 token per 4 characters.
 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

// ── Use Case ─────────────────────────────────────────────────────

export class PackUseCase {
  constructor(private readonly systems: PackSystems) {}

  /**
   * Pack all matching files from `directory` into a single markdown context.
   *
   * @param directory - Root directory to scan.
   * @param options   - Optional include/exclude glob patterns and token budget.
   */
  async execute(
    directory: string,
    options?: PackOptions,
  ): Promise<PackedContext> {
    this.systems.logger.info(`Packing ${directory}`);

    // 1. Recursively scan
    const allFiles = this.scanDirectory(directory);

    // 2. Apply fileFilter
    const filtered = allFiles.filter((f) =>
      this.systems.fileFilter.shouldInclude(f),
    );

    // 3. Apply PackOptions include/exclude
    let matched = filtered;
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

    // 4. Parse and concatenate
    const markdownParts: string[] = [];
    const sourceNotes: string[] = [];
    let totalTokens = 0;
    const maxTokens = options?.maxTokens ?? Number.POSITIVE_INFINITY;

    for (const filePath of matched) {
      if (totalTokens >= maxTokens) break;

      const parser = this.systems.parserRegistry.getParser(filePath);
      if (!parser) continue;

      const parsed = await parser.parse(filePath);
      const relPath = relative(directory, filePath).replace(/\\/g, "/");

      // File header
      const header = `---\n# ${relPath}\n---\n`;
      const body = parsed.content;
      const block = `${header}${body}\n\n`;

      const blockTokens = estimateTokens(block);

      if (totalTokens + blockTokens > maxTokens) {
        // Truncation would be needed; skip this file if it would exceed budget
        break;
      }

      markdownParts.push(block);
      totalTokens += blockTokens;
      sourceNotes.push(relPath);
    }

    const markdown = markdownParts.join("");
    const truncated = totalTokens >= maxTokens;

    this.systems.logger.info(
      `Packed ${sourceNotes.length} files, ${totalTokens} tokens${
        truncated ? " (truncated)" : ""
      }`,
    );

    return {
      markdown,
      chunks_used: sourceNotes.length,
      total_tokens: totalTokens,
      truncated,
      source_notes: sourceNotes,
    };
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
