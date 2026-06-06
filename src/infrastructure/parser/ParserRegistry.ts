// ---------------------------------------------------------------------------
// ParserRegistry — Phase 3
// Routes file paths to the appropriate SourceParser based on extension and
// content sniffing (for .md files: Obsidian frontmatter vs. plain Markdown).
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import type { SourceParser } from "../../domain/ports/SourceParser";
import type { SourceParserRegistry } from "../../domain/ports/SourceParserRegistry";
import { ObsidianParser } from "./ObsidianParser";
import { MarkdownParser } from "./MarkdownParser";

/**
 * Registry of source parsers keyed by file extension.
 *
 * Two-phase resolution:
 * 1. Find candidate parser(s) by file extension
 * 2. For .md files: content-sniff for Obsidian YAML frontmatter to decide
 *    between ObsidianParser and MarkdownParser
 */
export class ParserRegistry implements SourceParserRegistry {
  /**
   * Internal map: extension → parser for fast extension lookup.
   * NOTE: When multiple parsers share the same extension (e.g. .md),
   * only the last-registered one is stored here for the extension key.
   * The .md routing is handled separately via content sniffing.
   */
  private extensionMap: Map<string, SourceParser> = new Map();

  /**
   * Set of all unique parser instances. Used by getEnabledParsers().
   * Separated from extensionMap because multiple parsers can share the
   * same extension (e.g. ObsidianParser + MarkdownParser both handle .md).
   */
  private allParsers: Set<SourceParser> = new Set();

  /**
   * References kept for .md content sniffing so we can choose the right parser.
   */
  private obsidianParser: ObsidianParser | null = null;
  private markdownParser: MarkdownParser | null = null;

  register(parser: SourceParser): void {
    this.allParsers.add(parser);
    for (const ext of parser.extensions) {
      this.extensionMap.set(ext.toLowerCase(), parser);
    }
    if (parser instanceof ObsidianParser) {
      this.obsidianParser = parser;
    }
    if (parser instanceof MarkdownParser) {
      this.markdownParser = parser;
    }
  }

  /**
   * Resolve the best parser for a given file path.
   *
   * For .md files, performs content sniffing to determine whether the file
   * has Obsidian-style YAML frontmatter. Uses synchronous file I/O.
   */
  getParser(path: string): SourceParser | null {
    const ext = "." + path.split(".").pop()?.toLowerCase();
    if (!ext || !this.extensionMap.has(ext)) return null;

    // .md files need content sniffing: Obsidian frontmatter or plain Markdown?
    if (ext === ".md" && this.obsidianParser && this.markdownParser) {
      try {
        // Sync read of first chunk to check for frontmatter
        const firstBytes = readFileSync(path, { encoding: "utf-8", flag: "r" });
        if (ObsidianParser.hasFrontmatter(firstBytes)) {
          return this.obsidianParser;
        }
        return this.markdownParser;
      } catch {
        // If file can't be read, fall back to the default registered parser
        return this.extensionMap.get(ext) ?? null;
      }
    }

    return this.extensionMap.get(ext) ?? null;
  }

  getEnabledParsers(): SourceParser[] {
    return Array.from(this.allParsers).filter(p => p.enabled !== false);
  }
}
