export type SearchMode = "keyword" | "hybrid" | "semantic";

export type SourceType = "code" | "markdown" | "obsidian" | "generic";

export interface SourceMetadata {
  kind: SourceType;
  language?: string;
  ast?: {
    symbols: Array<{ kind: string; name: string; line: number }>;
    imports: Array<{ source: string; specifiers: string[] }>;
    exports: Array<{ name: string; kind: string }>;
  };
  [key: string]: unknown;
}

export interface SourceData {
  id: string;
  chunk_id: string;
  source_id: string;
  type: SourceType;
  title: string;
  content: string;
  tags: string[];
  path: string;
  file_blake3: string;
  semantic_blake3: string;
  chunk_index: number;
  total_chunks: number;
  embeddings: number[];
  metadata: SourceMetadata;
  created_at: string;
  updated_at: string;
}

export interface SearchResult {
  source: SourceData;
  score: number;
  match_type: "keyword" | "hybrid" | "semantic" | "ast";
  model_scores?: Record<string, number>;
}

export interface SearchResponse {
  results: SearchResult[];
  count: number;
  total: number;
  offset: number;
  limit: number;
  mode: string;
  error?: string;
  info?: string;
}

export interface IndexStats {
  total_sources: number;
  total_chunks: number;
  total_files: number;
  total_tokens: number;
  total_deduped_chunks: number;
  last_indexed: string;
}

export interface ModelConfig {
  name: string;
  dimensions: number;
  provider: string;
  baseUrl?: string;
}

export interface AppConfig {
  models: ModelConfig[];
  universal_model: string;
  embedder: {
    batch_size: number;
    cache_size: number;
  };
  chunking: {
    default_strategy: string;
    max_chunk_size: number;
    overlap: number;
  };
  search: {
    default_mode: "keyword" | "hybrid" | "semantic";
    top_k: number;
    hybrid_weight: number;
  };
  indexing: {
    include?: string[];
    exclude: string[];
  };
  mcp?: Record<string, unknown>;
}

export interface SystemInfo {
  cwd: string;
  storage: string;
  server: string;
}

export interface IndexResponse {
  status?: string;
  message?: string;
  stats?: IndexStats;
  error?: string;
}

export interface ClearResponse {
  status?: string;
  message?: string;
  error?: string;
}

export interface SourceResponse {
  chunks: SourceData[];
  total: number;
  error?: string;
}
