// ---------------------------------------------------------------------------
// SearchUseCase — Phase 9
//
// Embeds the query exactly once and delegates ranking to SearchService.
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

    const mode = options?.mode ?? "hybrid";
    const searchQuery: SearchQuery = {
      text: query,
      mode,
      top_k: options?.top_k ?? 10,
    };

    // exactOptionalPropertyTypes: only attach defined filters.
    if (options?.tags !== undefined) searchQuery.tags = options.tags;
    if (options?.source_types !== undefined) {
      searchQuery.source_types = options.source_types;
    }
    if (options?.min_score !== undefined) searchQuery.min_score = options.min_score;

    this.systems.logger.info(
      `Searching with mode="${mode}" query="${query}" top_k=${searchQuery.top_k}`,
    );

    // Embed exactly once for the modes that need vector search.
    let vector: number[] | undefined;
    if (mode === "semantic" || mode === "hybrid") {
      const embedding = await this.systems.embedder.embed(query);
      vector = embedding.vector;
    }

    const results = await this.systems.ranker.execute(searchQuery, vector);

    this.systems.logger.info(`Search returned ${results.length} results`);

    return results;
  }
}
