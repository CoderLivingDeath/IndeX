import type { Embedder } from "../systems/EmbeddingSystem";
import type { SourceRepository } from "../ports/SourceRepository";
import type { SearchQuery, SearchResult } from "../types";

/**
 * Three-mode search service: semantic (ANN), keyword (FTS/BM25), and hybrid.
 *
 * - **Semantic**: embeds the query, then delegates to `repo.search()` with
 *   mode `"semantic"`. If results carry `model_scores` they are averaged.
 * - **Keyword**: delegates directly to `repo.search()` with mode `"keyword"`.
 * - **Hybrid**: runs both modes, normalizes BM25 scores to [0,1], and merges
 *   via weighted sum controlled by `hybrid_weight`.
 *
 * All modes apply post-filtering by `tags` and `source_types` when specified.
 */
export class SearchService {
  private readonly hybridWeight: number;

  constructor(
    private readonly embedder: Embedder,
    private readonly repo: SourceRepository,
    options?: { hybrid_weight?: number },
  ) {
    this.hybridWeight = options?.hybrid_weight ?? 0.7;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    switch (query.mode) {
      case "semantic":
        return this.semanticSearch(query);
      case "keyword":
        return this.keywordSearch(query);
      case "hybrid":
        return this.hybridSearch(query);
    }
  }

  // ── Private mode implementations ──────────────────────────

  private async semanticSearch(query: SearchQuery): Promise<SearchResult[]> {
    // Embed the query text (triggers multi-model scoring path)
    await this.embedder.embed(query.text);

    const results = await this.repo.search({ ...query, mode: "semantic" });

    // Average model_scores when multiple models produced results
    for (const result of results) {
      this.averageModelScores(result);
    }

    return this.postFilter(results, query);
  }

  private async keywordSearch(query: SearchQuery): Promise<SearchResult[]> {
    const results = await this.repo.search({ ...query, mode: "keyword" });
    return this.postFilter(results, query);
  }

  private async hybridSearch(query: SearchQuery): Promise<SearchResult[]> {
    // Embed the query (consumed by the semantic leg)
    await this.embedder.embed(query.text);

    const [semanticResults, keywordResults] = await Promise.all([
      this.repo.search({ ...query, mode: "semantic" }),
      this.repo.search({ ...query, mode: "keyword" }),
    ]);

    // Average model_scores for semantic results
    for (const r of semanticResults) {
      this.averageModelScores(r);
    }

    // Normalise BM25 scores to [0, 1]
    this.normalizeBM25(keywordResults);

    // Weighted merge: final = w * semantic + (1-w) * keyword
    const merged = this.mergeHybrid(semanticResults, keywordResults);

    // Sort by final score descending, limit to top_k
    merged.sort((a, b) => b.score - a.score);
    const top = merged.slice(0, query.top_k);

    return this.postFilter(top, query);
  }

  // ── Helpers ────────────────────────────────────────────────

  /**
   * If the result carries `model_scores`, replace `score` with their average.
   */
  private averageModelScores(result: SearchResult): void {
    if (
      result.model_scores &&
      Object.keys(result.model_scores).length > 0
    ) {
      const scores = Object.values(result.model_scores);
      result.score = scores.reduce((a, b) => a + b, 0) / scores.length;
    }
  }

  /** Normalize the `score` array in-place via min-max scaling to [0, 1]. */
  private normalizeBM25(results: SearchResult[]): void {
    if (results.length === 0) return;
    const scores = results.map((r) => r.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    if (max === min) {
      // All scores identical — set all to 1 (they are equally relevant)
      results.forEach((r) => (r.score = 1));
      return;
    }
    for (const r of results) {
      r.score = (r.score - min) / (max - min);
    }
  }

  /**
   * Merge semantic and keyword results.
   *
   * - When the same source appears in both legs the final score is
   *   `hybridWeight * semanticScore + (1 - hybridWeight) * keywordScore`.
   * - Sources that appear in only one leg are included with the weighted
   *   contribution from that leg alone.
   */
  private mergeHybrid(
    semantic: SearchResult[],
    keyword: SearchResult[],
  ): SearchResult[] {
    const map = new Map<string, SearchResult>();

    for (const r of semantic) {
      map.set(r.source.id, {
        ...r,
        score: r.score * this.hybridWeight,
        match_type: "hybrid",
        model_scores: { ...(r.model_scores ?? {}), semantic: r.score },
      });
    }

    for (const r of keyword) {
      const existing = map.get(r.source.id);
      const kwScore = r.score * (1 - this.hybridWeight);
      if (existing) {
        existing.score += kwScore;
        existing.model_scores = {
          ...(existing.model_scores ?? {}),
          keyword: r.score,
        };
      } else {
        map.set(r.source.id, {
          ...r,
          score: kwScore,
          match_type: "hybrid",
          model_scores: { keyword: r.score },
        });
      }
    }

    return Array.from(map.values());
  }

  /** Apply optional tag / source_type / min_score filters after core scoring. */
  private postFilter(
    results: SearchResult[],
    query: SearchQuery,
  ): SearchResult[] {
    return results.filter((r) => {
      // Exclude non-matching results
      if (r.score <= 0) return false;
      if (query.min_score !== undefined && r.score < query.min_score) return false;
      if (query.tags?.length) {
        if (!query.tags.some((t) => r.source.tags.includes(t))) return false;
      }
      if (query.source_types?.length) {
        if (!query.source_types.includes(r.source.type)) return false;
      }
      return true;
    });
  }
}
