// ---------------------------------------------------------------------------
// ObsidianParser — Phase 3
// Parses Obsidian-flavoured Markdown files with YAML frontmatter and
// wiki-link syntax [[target]] and [[target|alias]].
// ---------------------------------------------------------------------------

import YAML from "yaml";
import type { SourceParser } from "../../domain/ports/SourceParser";
import type { ParsedSource, SourceType } from "../../domain/types";
import { BLAKE3Hasher } from "../hashing/BLAKE3Hasher";
import type { WikiLink } from "./types";

/** Parsed frontmatter fields we care about. */
interface Frontmatter {
  title?: string;
  tags?: string[];
  [key: string]: unknown;
}

/**
 * Parser for Obsidian-flavoured Markdown files (.md).
 * Extracts YAML frontmatter, wiki-links, and tags.
 */
export class ObsidianParser implements SourceParser {
  readonly type: SourceType = "obsidian";
  readonly extensions = [".md"];
  private hasher = new BLAKE3Hasher();

  supportsFile(path: string): boolean {
    return path.endsWith(".md");
  }

  /**
   * Detect whether a file contains Obsidian-style YAML frontmatter between
   * leading `---` markers. Used by ParserRegistry for content sniffing.
   */
  static hasFrontmatter(content: string): boolean {
    return /^---\n/.test(content);
  }

  async parse(path: string): Promise<ParsedSource> {
    const content = await Bun.file(path).text();

    // ---- Parse frontmatter -------------------------------------------------
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
    let frontmatter: Frontmatter = {};
    let bodyContent = content;

    if (frontmatterMatch) {
      frontmatter = (YAML.parse(frontmatterMatch[1] ?? "") || {}) as Frontmatter;
      bodyContent = content.slice(frontmatterMatch[0].length);
    }

    // ---- Extract wiki-links ------------------------------------------------
    // [[target]] or [[target|alias]]
    const wikiLinkRegex = /\[\[([^|]+?)(?:\|([^\]]+?))?\]\]/g;
    const wikiLinks: WikiLink[] = [];
    let match: RegExpExecArray | null;
    while ((match = wikiLinkRegex.exec(content)) !== null) {
      const link: WikiLink = { target: match[1]! };
      if (match[2]) link.alias = match[2];
      wikiLinks.push(link);
    }

    const tags: string[] = Array.isArray(frontmatter.tags)
      ? (frontmatter.tags as string[])
      : [];
    const title: string = frontmatter.title || path;
    const file_blake3 = await this.hasher.hash(content);

    return {
      type: "obsidian",
      path,
      content: bodyContent,
      tags,
      metadata: {
        kind: "obsidian",
        tags,
        links: wikiLinks.map((w) => w.target),
        frontmatter: frontmatter as Record<string, unknown>,
        // Extended parser-specific metadata
        wikiLinks,
        backlinks: [],
        graphConnections: [],
      } as ParsedSource["metadata"] & {
        wikiLinks: WikiLink[];
        backlinks: string[];
        graphConnections: string[];
      },
      file_blake3,
      last_parsed: new Date().toISOString(),
    };
  }
}
