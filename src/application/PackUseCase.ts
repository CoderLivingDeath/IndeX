// ---------------------------------------------------------------------------
// PackUseCase — Phase 9
//
// Scans a directory, filters files by include/exclude patterns, parses each
// through the SourceParserRegistry, and produces a structured markdown
// document with file index, per-file metadata, AST JSONL sections, and
// fenced code blocks.
// ---------------------------------------------------------------------------

import { relative, resolve } from "path";
import type { PackSystems } from "./di/Systems";
import type { PackedContext } from "../domain/systems/ContextPackagingSystem";
import type { ParsedSource } from "../domain/types";
import { scanDirectory } from "../shared/fileUtils";
import { filterByGlob } from "../shared/globMatcher";

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
  /** Output format: "md" (markdown for humans) or "jsonl" (compact JSON lines). Default "jsonl". */
  format?: "md" | "jsonl";
  /** Include metadata block (type, language, lines, tokens, tags, path, blake3). Default true. */
  meta?: boolean;
  /** Include AST JSONL section (imports, exports, symbols, complexity). Default true. */
  ast?: boolean;
  /** Include code/content block. Default true. */
  content?: boolean;
  /** Include relationships/links section (cross-file references). Default true. */
  links?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────

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

/** Build AST JSONL lines (imports, exports, symbols, complexity) from a FileIndex. */
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
  lines.push(JSON.stringify({
    kind: "complexity",
    functions: fileIndex.symbols.filter((s) => s.kind === "function" || s.kind === "method").length,
    classes: fileIndex.symbols.filter((s) => s.kind === "class").length,
    types: fileIndex.symbols.filter((s) => s.kind === "type" || s.kind === "interface").length,
    lines: fileIndex.symbols.reduce((max, s) => Math.max(max, s.endPosition.line), 0),
  }));

  return lines.join("\n");
}

/** Build links/relationships JSONL lines from a FileIndex. */
function linksJsonl(fileIndex: NonNullable<ParsedSource["fileIndex"]>): string {
  return fileIndex.relationships
    .map((rel) => JSON.stringify({ kind: "relationship", type: rel.type, source: rel.source, target: rel.target }))
    .join("\n");
}

/** HTML-escape content for embedding in `<pre><code>` blocks. */
function htmlEscape(raw: string): string {
  // Only &, <, > need escaping — backticks/headings inside <pre> are inert.
  return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Output builders ──────────────────────────────────────────────

/** Build markdown output with file index + per-file sections. */
function buildOutputMd(
  entries: FileEntry[],
  directory: string,
  showMeta: boolean,
  showAst: boolean,
  showContent: boolean,
  showLinks: boolean,
  maxTokens: number,
): string {
  const parts: string[] = [];
  let totalTokens = 0;

  // File index table of contents
  if (entries.length > 0) {
    parts.push("## File Index\n\n");
    parts.push("| # | Path | Language | Lines | Tokens |\n");
    parts.push("|---|------|----------|-------|--------|\n");
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      const ext = extractExt(e.relPath);
      const lang = inferLanguage(e.parsed, ext);
      parts.push(`| ${i + 1} | ${e.relPath} | ${lang} | ${e.lines} | ${e.tokens} |\n`);
    }
    parts.push("\n");
  }

  const hasAnySection = showMeta || showAst || showContent || showLinks;

  for (const entry of entries) {
    if (totalTokens >= maxTokens) break;
    const headerTokens = estimateTokens(parts.join(""));
    const blockTokens = entry.tokens + headerTokens;
    if (totalTokens + blockTokens > maxTokens && parts.length > 0) break;

    if (!hasAnySection) continue;

    parts.push(`## ${entry.relPath}\n`);

    if (showMeta) {
      parts.push(metadataBlock(entry, directory));
      parts.push("\n\n");
    }

    if (showAst && entry.parsed.fileIndex) {
      const jsonl = astJsonl(entry.parsed.fileIndex);
      if (jsonl) {
        parts.push("### ast\n");
        parts.push(jsonl);
        parts.push("\n\n");
      }
    }

    if (showLinks && entry.parsed.fileIndex && entry.parsed.fileIndex.relationships.length > 0) {
      parts.push("### links\n");
      parts.push(linksJsonl(entry.parsed.fileIndex));
      parts.push("\n\n");
    }

    if (showContent) {
      const ext = extractExt(entry.relPath);
      const lang = inferLanguage(entry.parsed, ext);
      const isCode = entry.parsed.type === "code" || entry.parsed.type === "generic";
      const escapedContent = htmlEscape(entry.parsed.content);
      const sectionLabel = isCode ? "code" : "content";
      parts.push(`### ${sectionLabel}\n`);
      parts.push(`<pre><code class="language-${lang.toLowerCase()}">\n`);
      parts.push(escapedContent);
      parts.push("\n</code></pre>\n\n");
    }

    totalTokens = estimateTokens(parts.join(""));
  }

  return parts.join("");
}

/** Build JSONL output — one JSON object per file per line. */
function buildOutputJsonl(
  entries: FileEntry[],
  showMeta: boolean,
  showAst: boolean,
  showContent: boolean,
  showLinks: boolean,
  maxTokens: number,
): { output: string; totalTokens: number } {
  const lines: string[] = [];
  let totalChars = 0;

  for (const entry of entries) {
    if (totalChars > 0 && estimateTokens(lines.join("\n")) >= maxTokens) break;

    const obj: Record<string, unknown> = {};

    // Always included: path + type + language + lines + tokens
    const ext = extractExt(entry.relPath);
    const lang = inferLanguage(entry.parsed, ext);
    obj.path = entry.relPath;
    obj.type = entry.parsed.type ?? "generic";
    obj.language = lang;
    obj.lines = entry.lines;
    obj.tokens = entry.tokens;

    // Meta: blake3, last_parsed, tags
    if (showMeta) {
      obj.blake3 = entry.parsed.file_blake3;
      obj.last_parsed = entry.parsed.last_parsed;
      if (entry.parsed.tags && entry.parsed.tags.length > 0) {
        obj.tags = entry.parsed.tags;
      }
    }

    // AST: imports, exports, symbols, complexity
    if (showAst && entry.parsed.fileIndex) {
      const fi = entry.parsed.fileIndex;
      if (fi.imports.length > 0) obj.imports = fi.imports;
      if (fi.exports.length > 0) obj.exports = fi.exports;
      if (fi.symbols.length > 0) obj.symbols = fi.symbols;
      obj.complexity = {
        functions: fi.symbols.filter((s) => s.kind === "function" || s.kind === "method").length,
        classes: fi.symbols.filter((s) => s.kind === "class").length,
        types: fi.symbols.filter((s) => s.kind === "type" || s.kind === "interface").length,
      };
    }

    // Links / relationships
    if (showLinks && entry.parsed.fileIndex && entry.parsed.fileIndex.relationships.length > 0) {
      obj.relationships = entry.parsed.fileIndex.relationships;
    }

    // Content
    if (showContent) {
      obj.content = entry.parsed.content;
    }

    const line = JSON.stringify(obj);
    lines.push(line);
    totalChars += line.length + 1; // +1 for newline
  }

  const output = lines.join("\n") + (lines.length > 0 ? "\n" : "");
  return { output, totalTokens: estimateTokens(output) };
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
    const allFiles = scanDirectory(directory);

    // 2. Apply fileFilter
    let matched = allFiles.filter((f) =>
      this.systems.fileFilter.shouldInclude(f),
    );

    // 3. Resolve include/exclude patterns to absolute (relative to directory)
    //    so they match against the absolute paths from scanDirectory.
    const resolvedOptions = options
      ? {
          ...options,
          include: options.include?.map((p) => resolve(directory, p).replace(/\\/g, "/")),
          exclude: options.exclude?.map((p) => resolve(directory, p).replace(/\\/g, "/")),
        }
      : undefined;
    matched = filterByGlob(matched, resolvedOptions);

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

    // 5. Determine section visibility
    const hasExplicitSection =
      options?.meta !== undefined ||
      options?.ast !== undefined ||
      options?.content !== undefined ||
      options?.links !== undefined;

    const showMeta    = hasExplicitSection ? options?.meta    === true : true;
    const showAst     = hasExplicitSection ? options?.ast     === true : true;
    const showContent = hasExplicitSection ? options?.content === true : true;
    const showLinks   = hasExplicitSection ? options?.links   === true : false;
    const format      = options?.format ?? "jsonl";

    // 6. Build output in requested format
    let output: string;
    let totalTokens = 0;
    const maxTokens = options?.maxTokens ?? Number.POSITIVE_INFINITY;

    if (format === "md") {
      output = buildOutputMd(entries, directory, showMeta, showAst, showContent, showLinks, maxTokens);
      totalTokens = estimateTokens(output);
    } else {
      const result = buildOutputJsonl(entries, showMeta, showAst, showContent, showLinks, maxTokens);
      output = result.output;
      totalTokens = result.totalTokens;
    }

    const truncated = totalTokens >= maxTokens;

    this.systems.logger.info(
      `Packed ${entries.length} files, ${totalTokens} tokens [${format}]${
        truncated ? " (truncated)" : ""
      }`,
    );

    return {
      markdown: output,
      chunks_used: entries.length,
      total_tokens: totalTokens,
      truncated,
      source_notes: entries.map((e) => e.relPath),
    };
  }

}
