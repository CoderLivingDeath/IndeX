import { unified } from "unified";
import remarkParse from "remark-parse";
import type { RootContent } from "mdast";

export interface HeadingInfo {
  level: number;
  text: string;
  anchor: string;
}

/**
 * Extracts heading information from Markdown text using unified/remark AST parsing.
 */
export class MarkdownAstParser {
  private readonly processor = unified().use(remarkParse);

  /**
   * Parse markdown text and extract all headings with level, text, and GitHub-style anchor.
   */
  parse(markdown: string): HeadingInfo[] {
    if (!markdown.trim()) return [];

    const ast = this.processor.parse(markdown);
    const headings: HeadingInfo[] = [];

    walkTree(ast.children ?? [], headings);

    return headings;
  }
}

/**
 * Recursively walk the MDAST tree, collecting heading nodes.
 */
function walkTree(children: RootContent[], headings: HeadingInfo[]): void {
  for (const node of children) {
    if (node.type === "heading") {
      const text = extractTextContent((node as any).children ?? []);
      const anchor = slugify(text);
      headings.push({ level: (node as any).depth, text, anchor });
    }
    // Recurse into children (handles blockquote, etc.)
    if ("children" in node && Array.isArray((node as any).children)) {
      walkTree((node as any).children, headings);
    }
  }
}

/**
 * Extract plain text from a heading node's children.
 */
function extractTextContent(children: RootContent[]): string {
  return children
    .map((child: any) => {
      if (child.type === "text") return child.value ?? "";
      if (child.type === "link") {
        return extractTextContent(child.children ?? []);
      }
      if (child.type === "inlineCode") return child.value ?? "";
      return "";
    })
    .join("");
}

/**
 * Create a GitHub-style anchor slug from heading text.
 * - lowercase
 * - remove special characters (keep alphanumeric, spaces, hyphens)
 * - spaces become hyphens
 * - collapse multiple hyphens
 * - trim leading/trailing hyphens
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
