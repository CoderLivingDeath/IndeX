// ---------------------------------------------------------------------------
// PackUseCase — Phase 9
//
// Scans a directory, filters files by include/exclude patterns, parses each
// through the SourceParserRegistry, and produces a structured markdown
// document with file index, per-file metadata, AST JSONL sections, and
// fenced code blocks.
// ---------------------------------------------------------------------------

import { readdirSync } from "fs";
import { join, relative } from "path";
import type { PackSystems } from "./di/Systems";
import type { PackedContext } from "../domain/systems/ContextPackagingSystem";
import type { ParsedSource } from "../domain/types";

// ── Internal types ─────────────────────────────────────────────

interface FileEntry {
  relPath: string;
  parsed: ParsedSource;
  tokens: number;
  lines: number;
}

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

  // Handle `*.ext` patterns (e.g. `*.ts`, `*.md`)
  if (pattern.startsWith("*.")) {
    const ext = pattern.slice(1); // ".ts"
    return normalised.endsWith(ext);
  }

  return filePath.includes(pattern);
}

/**
 * Crude token estimate: ~1 token per 4 characters.
 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

/** Infer a display language name from file extension or metadata. */
function inferLanguage(parsed: ParsedSource, ext: string): string {
  if (parsed.metadata.kind === "code" && parsed.metadata.language) {
    return parsed.metadata.language;
  }
  const langMap: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TSX",
    ".js": "JavaScript",
    ".jsx": "JSX",
    ".md": "Markdown",
    ".json": "JSON",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".toml": "TOML",
    ".css": "CSS",
    ".html": "HTML",
    ".rs": "Rust",
    ".py": "Python",
    ".go": "Go",
    ".java": "Java",
  };
  return langMap[ext] ?? "text";
}

/** Format tags array as comma-separated string. */
function formatTags(tags?: string[]): string {
  if (!tags || tags.length === 0) return "";
  return tags.join(", ");
}

/** Build metadata key-value block. */
function metadataBlock(entry: FileEntry, directory: string): string {
  const p = entry.parsed;
  const ext = extractExt(entry.relPath);
  const lang = inferLanguage(p, ext);
  const type = p.type ?? "generic";
  const tags = formatTags(p.tags);
  return [
    `type: ${type}`,
    `language: ${lang}`,
    `lines: ${entry.lines}`,
    `tokens: ${entry.tokens}`,
    tags ? `tags: ${tags}` : "tags:",
    `path: ${entry.relPath}`,
    `blake3: ${p.file_blake3}`,
    `last_parsed: ${p.last_parsed}`,
  ].join("\n");
}

/** Extract file extension from a relative path. */
function extractExt(relPath: string): string {
  const idx = relPath.lastIndexOf(".");
  return idx >= 0 ? relPath.slice(idx).toLowerCase() : "";
}

/** Build AST JSONL lines from a FileIndex. */
function astJsonl(fileIndex: NonNullable<ParsedSource["fileIndex"]>): string {
  const lines: string[] = [];

  for (const imp of fileIndex.imports) {
    lines.push(JSON.stringify({ kind: "import", from: imp.source, specifiers: imp.specifiers, type: imp.kind }));
  }
  for (const exp of fileIndex.exports) {
    lines.push(JSON.stringify({ kind: "export", name: exp.name, type: exp.kind }));
  }
  for (const sym of fileIndex.symbols) {
    lines.push(JSON.stringify({
      kind: "symbol",
      symbolKind: sym.kind,
      name: sym.name,
      signature: sym.signature,
      line: sym.startPosition.line,
    }));
  }
  for (const rel of fileIndex.relationships) {
    lines.push(JSON.stringify({ kind: "relationship", type: rel.type, source: rel.source, target: rel.target }));
  }
  lines.push(JSON.stringify({
    kind: "complexity",
    functions: fileIndex.symbols.filter((s) => s.kind === "function" || s.kind === "method").length,
    classes: fileIndex.symbols.filter((s) => s.kind === "class").length,
    types: fileIndex.symbols.filter((s) => s.kind === "type" || s.kind === "interface").length,
    lines: fileIndex.symbols.reduce((max, s) => Math.max(max, s.endPosition.line), 0),
  }));

  return lines.join("\n");
}

/** HTML-escape content for embedding in `<pre><code>` blocks. */
function htmlEscape(raw: string): string {
  // Only &, <, > need escaping — backticks/headings inside <pre> are inert.
  return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Use Case ─────────────────────────────────────────────────────

export class PackUseCase {
  constructor(private readonly systems: PackSystems) {}

  /**
   * Pack all matching files from `directory` into a structured markdown context.
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

    // 4. Parse all files into entries (two-pass: first parse all for TOC)
    const entries: FileEntry[] = [];
    for (const filePath of matched) {
      const parser = this.systems.parserRegistry.getParser(filePath);
      if (!parser) continue;

      const parsed = await parser.parse(filePath);
      const relPath = relative(directory, filePath).replace(/\\/g, "/");
      const tokens = estimateTokens(parsed.content);
      const lines = parsed.content.split("\n").length;

      entries.push({ relPath, parsed, tokens, lines });
    }

    // 5. Build output
    const markdownParts: string[] = [];
    let totalTokens = 0;
    const maxTokens = options?.maxTokens ?? Number.POSITIVE_INFINITY;

    // 5a. File index table of contents
    if (entries.length > 0) {
      markdownParts.push("## File Index\n\n");
      markdownParts.push("| # | Path | Language | Lines | Tokens |\n");
      markdownParts.push("|---|------|----------|-------|--------|\n");
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]!;
        const ext = extractExt(e.relPath);
        const lang = inferLanguage(e.parsed, ext);
        markdownParts.push(`| ${i + 1} | ${e.relPath} | ${lang} | ${e.lines} | ${e.tokens} |\n`);
      }
      markdownParts.push("\n");
    }

    // 5b. Per-file sections
    for (const entry of entries) {
      if (totalTokens >= maxTokens) break;

      const headerTokens = estimateTokens(markdownParts.join(""));
      const blockTokens = entry.tokens + headerTokens;

      if (totalTokens + blockTokens > maxTokens && markdownParts.length > 0) {
        break;
      }

      // File section header
      markdownParts.push(`## ${entry.relPath}\n`);
      markdownParts.push(metadataBlock(entry, directory));
      markdownParts.push("\n\n");

      // AST JSONL section (code files only)
      if (entry.parsed.fileIndex) {
        markdownParts.push("### ast\n");
        markdownParts.push(astJsonl(entry.parsed.fileIndex));
        markdownParts.push("\n\n");
      }

      // Code / content block
      const ext = extractExt(entry.relPath);
      const lang = inferLanguage(entry.parsed, ext);
      const isCode = entry.parsed.type === "code" || entry.parsed.type === "generic";
      const escapedContent = htmlEscape(entry.parsed.content);
      const sectionLabel = isCode ? "code" : "content";
      markdownParts.push(`### ${sectionLabel}\n`);
      markdownParts.push(`<pre><code class="language-${lang.toLowerCase()}">\n`);
      markdownParts.push(escapedContent);
      markdownParts.push("\n</code></pre>\n\n");

      totalTokens = estimateTokens(markdownParts.join(""));
    }

    const markdown = markdownParts.join("");
    const truncated = totalTokens >= maxTokens;

    this.systems.logger.info(
      `Packed ${entries.length} files, ${totalTokens} tokens${
        truncated ? " (truncated)" : ""
      }`,
    );

    return {
      markdown,
      chunks_used: entries.length,
      total_tokens: totalTokens,
      truncated,
      source_notes: entries.map((e) => e.relPath),
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
