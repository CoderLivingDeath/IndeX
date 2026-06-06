// ---------------------------------------------------------------------------
// MarkdownParser — Phase 3
// Uses unified/remark to parse .md files into ParsedSource with MDAST walk.
// ---------------------------------------------------------------------------

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import type { Root, Heading, Link, Text } from "mdast";
import { visit } from "unist-util-visit";
import type { SourceParser } from "../../domain/ports/SourceParser";
import type { ParsedSource, SourceType } from "../../domain/types";
import { BLAKE3Hasher } from "../hashing/BLAKE3Hasher";
import type { Heading as HeadingType, Link as LinkType, MarkdownStats } from "./types";

/**
 * Parser for plain Markdown files (.md).
 * Strips frontmatter if present. Extracts headings, links, and stats from the
 * MDAST produced by unified/remark.
 */
export class MarkdownParser implements SourceParser {
  readonly type: SourceType = "markdown";
  readonly extensions = [".md"];
  private hasher = new BLAKE3Hasher();

  supportsFile(path: string): boolean {
    return this.extensions.some((ext) => path.endsWith(ext));
  }

  async parse(path: string): Promise<ParsedSource> {
    const content = await Bun.file(path).text();

    const file = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkFrontmatter)
      .parse(content) as Root;

    const headings: HeadingType[] = [];
    const links: LinkType[] = [];
    let wordCount = 0;
    let paragraphCount = 0;
    let codeBlockCount = 0;

    visit(file, (node) => {
      if (node.type === "heading") {
        const h = node as Heading;
        const headingText = h.children
          .filter((c): c is Text => c.type === "text")
          .map((c) => c.value)
          .join("");
        const anchor = headingText
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .replace(/\s+/g, "-");
        headings.push({ level: h.depth, text: headingText, anchor });
      }

      if (node.type === "link") {
        const l = node as Link;
        const linkText = l.children
          .filter((c): c is Text => c.type === "text")
          .map((c) => c.value)
          .join("");
        const url = l.url;
        const isInternal = url.startsWith("/") || url.startsWith("#") || !url.includes("://");
        const isAnchor = url.startsWith("#");
        links.push({ url, text: linkText, isInternal, isAnchor });
      }

      if (node.type === "paragraph") {
        paragraphCount++;
      }

      if (node.type === "code") {
        codeBlockCount++;
      }

      if (node.type === "text") {
        const words = (node as Text).value.split(/\s+/).filter(Boolean);
        wordCount += words.length;
      }

      // Also count text inside paragraph children for inline code etc.
      // visit already visits all descendants, so text nodes directly inside
      // paragraphs are already counted above.
    });

    const title = headings.find((h) => h.level === 1)?.text || path;
    const section = headings.find((h) => h.level === 2)?.text;
    const readingTimeMinutes = Math.ceil(wordCount / 200);
    const stats: MarkdownStats = {
      wordCount,
      readingTimeMinutes,
      paragraphCount,
      codeBlockCount,
    };

    const file_blake3 = await this.hasher.hash(content);

    return {
      type: "markdown",
      path,
      content,
      tags: [],
      metadata: {
        kind: "markdown",
        heading: title,
        section,
        wordCount,
        // Extended parser-specific metadata beyond the SourceMetadata union.
        // Consumers should narrow via `kind` and access these fields directly.
        headings,
        links,
        stats,
      } as ParsedSource["metadata"] & {
        headings: HeadingType[];
        links: LinkType[];
        stats: MarkdownStats;
      },
      file_blake3,
      last_parsed: new Date().toISOString(),
    };
  }
}
