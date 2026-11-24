import type { SourceRepository } from "../ports/SourceRepository";
import type { SearchQuery, SearchResult } from "../types";

/**
 * Single ranking engine for IndeX search.
 *
 * The query embedding is owned by the caller (SearchUseCase) and passed in as
 * a precomputed vector — this service never embeds text itself. That keeps
 * vector work to exactly one call per query and makes the vector path explicit.
 *
 * - **Semantic**: ANN search with the supplied vector (cosine similarity).
 * - **Keyword**: FTS/BM25, normalized to [0, 1].
 * - **Hybrid**: semantic + keyword merged with `hybrid_weight`.
 * - **AST**: structural FTS from the file index.
 */
export class SearchService {
  private readonly hybridWeight: number;

  constructor(
    private readonly repo: SourceRepository,
    options?: { hybrid_weight?: number },
  ) {
    this.hybridWeight = options?.hybrid_weight ?? 0.7;
  }

  /**
   * Execute a search with a precomputed query vector.
   *
   * @param query  - Search query (mode, filters, top_k).
   * @param vector - Query embedding; required for semantic/hybrid.
   */
  async execute(query: SearchQuery, vector?: number[]): Promise<SearchResult[]> {
    switch (query.mode) {
      case "semantic":
        return this.semanticSearch(query, vector);
      case "keyword":
        return this.keywordSearch(query);
      case "hybrid":
        return this.hybridSearch(query, vector);
      case "ast":
        return this.astSearch(query);
    }
  }

  // ── Private mode implementations ──────────────────────────

  private async semanticSearch(
    query: SearchQuery,
    vector?: number[],
  ): Promise<SearchResult[]> {
    if (!hasVector(vector)) return [];

    const results = await this.repo.search({
      ...query,
      mode: "semantic",
      vector,
    });

    for (const result of results) {
      this.averageModelScores(result);
      result.score = clamp01(result.score);
    }

    return this.postFilter(results, query);
  }

  private async keywordSearch(query: SearchQuery): Promise<SearchResult[]> {
    const results = (await this.repo.search({ ...query, mode: "keyword" }))
      .filter((r) => r.score > 0);
    // Keep every match visible: scale to (0, 1] rather than min-max, which
    // would turn the weakest match into a zero score and filter it out.
    this.scaleScores(results, 0.01);
    return this.postFilter(results, query);
  }

  private async hybridSearch(
    query: SearchQuery,
    vector?: number[],
  ): Promise<SearchResult[]> {
    if (!hasVector(vector)) return [];

    const [semanticResults, rawKeywordResults] = await Promise.all([
      this.repo.search({ ...query, mode: "semantic", vector }),
      this.repo.search({ ...query, mode: "keyword" }),
    ]);
    const keywordResults = rawKeywordResults.filter((r) => r.score > 0);

    for (const result of semanticResults) {
      this.averageModelScores(result);
      result.score = clamp01(result.score);
    }

    // Normalize BM25 scores to [0, 1] before weighted merging.
    this.normalizeBM25(keywordResults);

    const merged = this.mergeHybrid(semanticResults, keywordResults);
    merged.sort((a, b) => b.score - a.score);
    const top = merged.slice(0, query.top_k);

    return this.postFilter(top, query);
  }

  private async astSearch(query: SearchQuery): Promise<SearchResult[]> {
    const results = (await this.repo.search({ ...query, mode: "ast" }))
      .filter((r) => r.score > 0);
    this.scaleScores(results, 0.01);
    return this.postFilter(results, query);
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

  /** Normalize the scores in-place via min-max scaling to [0, 1]. */
  private normalizeBM25(results: SearchResult[]): void {
    this.scaleScores(results, 0);
  }

  /**
   * Scale scores in-place to `[floor, 1]` preserving order. When all scores
   * are identical, non-zero scores become 1.
   */
  private scaleScores(results: SearchResult[], floor: number): void {
    if (results.length === 0) return;
    const scores = results.map((r) => r.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);

    if (max === min) {
      results.forEach((r) => (r.score = max > 0 ? 1 : 0));
      return;
    }

    const span = max - min;
    for (const r of results) {
      r.score = floor + (1 - floor) * ((r.score - min) / span);
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

function hasVector(vector?: number[]): vector is number[] {
  return Array.isArray(vector) && vector.length > 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
