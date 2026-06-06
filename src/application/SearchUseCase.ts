// ---------------------------------------------------------------------------
// SearchUseCase — Phase 9
//
// Searches the indexed repository with three-mode support (semantic, keyword,
// hybrid).  Delegates directly to `SourceRepository.search()` and optionally
// packs results for LLM consumption via `ContextPacker`.
// ---------------------------------------------------------------------------

import type { SearchSystems } from "./di/Systems";
import type { SearchQuery, SearchResult } from "../domain/types";

/**
 * Application-level use case for searching the indexed knowledge base.
 */
export class SearchUseCase {
  constructor(private readonly systems: SearchSystems) {}

  /**
   * Execute a search query against the indexed repository.
   *
   * @param query   - The natural-language or keyword search string.
   * @param options - Optional overrides for mode, top_k, tags, source_types.
   * @returns An array of `SearchResult` items sorted by relevance.
   */
  async execute(
    query: string,
    options?: Partial<SearchQuery>,
  ): Promise<SearchResult[]> {
    // Empty query yields no results
    if (!query || query.trim().length === 0) {
      return [];
    }

    const searchQuery: SearchQuery = {
      text: query,
      mode: options?.mode ?? "hybrid",
      top_k: options?.top_k ?? 10,
      tags: options?.tags,
      source_types: options?.source_types,
    };

    this.systems.logger.info(
      `Searching with mode="${searchQuery.mode}" query="${query}" top_k=${searchQuery.top_k}`,
    );

    // For semantic/hybrid modes embed the query text so the downstream repo
    // can use the vector representation
    if (searchQuery.mode === "semantic" || searchQuery.mode === "hybrid") {
      await this.systems.embedder.embed(query);
    }

    const results = await this.systems.repo.search(searchQuery);

    this.systems.logger.info(`Search returned ${results.length} results`);

    return results;
  }
}
