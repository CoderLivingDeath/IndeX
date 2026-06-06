// ---------------------------------------------------------------------------
// Parser-Specific Metadata Types — Phase 3
// ---------------------------------------------------------------------------

/**
 * A heading extracted from a Markdown document.
 */
export interface Heading {
  level: number;
  text: string;
  anchor: string;
}

/**
 * A link extracted from a Markdown document.
 */
export interface Link {
  url: string;
  text: string;
  isInternal: boolean;
  isAnchor: boolean;
}

/**
 * Aggregate statistics for a Markdown document.
 */
export interface MarkdownStats {
  wordCount: number;
  readingTimeMinutes: number;
  paragraphCount: number;
  codeBlockCount: number;
}

/**
 * Extended metadata specific to Markdown parsing.
 */
export interface MarkdownMetadata {
  headings: Heading[];
  links: Link[];
  stats: MarkdownStats;
}

/**
 * A wiki-link extracted from an Obsidian document.
 */
export interface WikiLink {
  target: string;
  alias?: string;
}

/**
 * Extended metadata specific to Obsidian parsing.
 */
export interface ObsidianMetadata {
  frontmatter: Record<string, unknown>;
  tags: string[];
  wikiLinks: WikiLink[];
  backlinks: string[];
  graphConnections: string[];
}

/**
 * Extended metadata specific to code file parsing.
 */
export interface CodeMetadata {
  language: string;
  complexity: {
    lines: number;
    functions: number;
    classes: number;
  };
  topLevelDeclarations: string[];
}
