import type { Deduplicator } from "../../src/domain/systems/ContextPackagingSystem";
import type { SearchResult } from "../../src/domain/types";

/**
 * A mock deduplicator that optionally deduplicates by semantic_blake3.
 * When enabled (default), keeps the entry with highest score.
 * Can be disabled to test pipeline behaviour without dedup.
 */
export class MockDeduplicator implements Deduplicator {
  private readonly enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  async deduplicate(results: SearchResult[]): Promise<SearchResult[]> {
    if (!this.enabled) return results;

    const seen = new Map<string, SearchResult>();
    for (const result of results) {
      const hash = result.source.semantic_blake3;
      const existing = seen.get(hash);
      if (!existing || result.score > existing.score) {
        seen.set(hash, result);
      }
    }
    return Array.from(seen.values());
  }
}
