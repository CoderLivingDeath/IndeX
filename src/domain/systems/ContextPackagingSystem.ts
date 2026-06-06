import type { SearchResult } from "../types";

/**
 * A packed context ready to be sent to an LLM.
 */
export interface PackedContext {
  markdown: string;
  chunks_used: number;
  total_tokens: number;
  truncated: boolean;
  source_notes: string[];
}

/**
 * Deduplicates search results by source identity.
 */
export interface Deduplicator {
  deduplicate(results: SearchResult[]): Promise<SearchResult[]>;
}

/**
 * Counts and truncates text by token budget.
 */
export interface Tokenizer {
  count(text: string): Promise<number>;
  truncate(text: string, maxTokens: number): Promise<string>;
}

/**
 * Packs search results into a formatted context for LLM consumption.
 */
export interface ContextPacker {
  pack(
    results: SearchResult[],
    options?: { maxTokens?: number; format?: "rag" | "context" },
  ): Promise<PackedContext>;
}
