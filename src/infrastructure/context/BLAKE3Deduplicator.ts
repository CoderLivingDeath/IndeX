import type { SearchResult } from "../../domain/types";
import type { Deduplicator } from "../../domain/systems/ContextPackagingSystem";

/**
 * O(n) deduplicator that keeps the highest-scoring entry per `semantic_blake3`.
 *
 * - Uses a `Map<semantic_blake3, { result, index }>` to track best entry per hash
 *   while preserving original order of first occurrence.
 * - Does **not** mutate the input array.
 */
export class BLAKE3Deduplicator implements Deduplicator {
  async deduplicate(results: SearchResult[]): Promise<SearchResult[]> {
    // Map: semantic_blake3 -> { best result seen, first occurrence index }
    const seen = new Map<string, { result: SearchResult; firstIndex: number }>();

    for (let i = 0; i < results.length; i++) {
      const candidate = results[i]!;
      const hash = candidate.source.semantic_blake3;
      const existing = seen.get(hash);

      if (!existing) {
        // First time seeing this hash — store it
        seen.set(hash, { result: candidate, firstIndex: i });
      } else if (candidate.score > existing.result.score) {
        // Same hash, higher score — replace keeping original firstIndex
        seen.set(hash, { result: candidate, firstIndex: existing.firstIndex });
      }
      // Same hash, lower or equal score — skip
    }

    // Sort back into original order and extract results
    return Array.from(seen.values())
      .sort((a, b) => a.firstIndex - b.firstIndex)
      .map((entry) => entry.result);
  }
}
