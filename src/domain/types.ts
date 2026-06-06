// ---------------------------------------------------------------------------
// Domain Types — Phase 1
// ---------------------------------------------------------------------------

/**
 * Union of supported source file types.
 */
export type SourceType = "code" | "markdown" | "obsidian" | "generic";

/**
 * Discriminated union of per-type metadata.
 * Narrow via the `kind` field.
 */
export type SourceMetadata =
  | { kind: "code"; language: string; packageName?: string }
  | { kind: "markdown"; heading?: string; section?: string; wordCount?: number }
  | { kind: "obsidian"; tags: string[]; links: string[]; frontmatter?: Record<string, unknown> }
  | { kind: "generic"; encoding: string; mimeType?: string };

/**
 * A single indexed chunk of source data.
 * One source file can produce many SourceData rows (one per chunk).
 */
export interface SourceData {
  id: string; // UUID v7
  chunk_id: string; // UUID v7
  source_id: string; // Original source UUID
  type: SourceType;
  title: string;
  content: string;
  tags: string[];
  path: string;
  file_blake3: string; // hash of entire file
  semantic_blake3: string; // hash of core semantic unit
  chunk_index: number;
  total_chunks: number;
  embeddings: number[];
  metadata: SourceMetadata;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

/**
 * A search query against the index.
 */
export interface SearchQuery {
  text: string;
  mode: "semantic" | "keyword" | "hybrid";
  tags?: string[];
  top_k: number;
  source_types?: SourceType[];
  min_score?: number;
  filters?: Record<string, unknown>;
}

/**
 * A single search result.
 */
export interface SearchResult {
  source: SourceData;
  score: number;
  match_type: "semantic" | "keyword" | "hybrid";
  model_scores?: Record<string, number>;
}

/**
 * A parsed source file prior to chunking.
 */
export interface ParsedSource {
  type: SourceType;
  path: string;
  content: string;
  tags: string[];
  metadata: SourceMetadata;
  file_blake3: string;
  last_parsed: string; // ISO 8601
}

/**
 * Aggregate statistics for the index.
 */
export interface IndexStats {
  total_sources: number;
  total_chunks: number;
  total_files: number;
  last_indexed: string; // ISO 8601
}
