import { describe, it, expect } from "bun:test";
import { BLAKE3Deduplicator } from "../../../src/infrastructure/context/BLAKE3Deduplicator";
import type { SearchResult } from "../../../src/domain/types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeResult(
  semantic_blake3: string,
  score: number,
  overrides: Partial<SearchResult["source"]> = {},
): SearchResult {
  return {
    source: {
      id: `id-${semantic_blake3}`,
      chunk_id: `c-${semantic_blake3}`,
      source_id: `s-${semantic_blake3}`,
      type: "code",
      title: "Test",
      content: `Content for ${semantic_blake3}`,
      tags: [],
      path: `${semantic_blake3}.ts`,
      file_blake3: "",
      semantic_blake3,
      chunk_index: 0,
      total_chunks: 1,
      embeddings: [],
      metadata: { kind: "generic" as const, encoding: "utf-8" },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    },
    score,
    match_type: "semantic",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BLAKE3Deduplicator", () => {
  const dedup = new BLAKE3Deduplicator();

  it("deduplicates by semantic_blake3 — keeps only one entry per hash", async () => {
    const results: SearchResult[] = [
      makeResult("hash-a", 0.9),
      makeResult("hash-b", 0.8),
      makeResult("hash-a", 0.7), // duplicate of hash-a
    ];

    const output = await dedup.deduplicate(results);

    expect(output).toHaveLength(2);
    const hashes = output.map((r) => r.source.semantic_blake3);
    expect(hashes).toEqual(["hash-a", "hash-b"]);
  });

  it("keeps the entry with the highest score when duplicates exist", async () => {
    const results: SearchResult[] = [
      makeResult("hash-a", 0.5),
      makeResult("hash-a", 0.9),
      makeResult("hash-a", 0.7),
    ];

    const output = await dedup.deduplicate(results);

    expect(output).toHaveLength(1);
    expect(output[0]!.score).toBe(0.9);
    expect(output[0]!.source.semantic_blake3).toBe("hash-a");
  });

  it("preserves original order of first occurrence for each unique hash", async () => {
    const results: SearchResult[] = [
      makeResult("hash-c", 0.3),
      makeResult("hash-a", 0.9),
      makeResult("hash-b", 0.8),
      makeResult("hash-a", 0.95), // duplicate, higher score but later
    ];

    const output = await dedup.deduplicate(results);

    // hash-c appears first, then hash-a (first occurrence at index 1),
    // then hash-b (first occurrence at index 2)
    expect(output).toHaveLength(3);
    expect(output[0]!.source.semantic_blake3).toBe("hash-c");
    expect(output[1]!.source.semantic_blake3).toBe("hash-a");
    expect(output[2]!.source.semantic_blake3).toBe("hash-b");

    // hash-a should have the max score (0.95, from the later occurrence)
    const hashA = output.find((r) => r.source.semantic_blake3 === "hash-a")!;
    expect(hashA.score).toBe(0.95);
  });

  it("does not mutate the input array (no side effects)", async () => {
    const results: SearchResult[] = [
      makeResult("hash-a", 0.9),
      makeResult("hash-b", 0.8),
    ];
    const snapshot = [...results];

    await dedup.deduplicate(results);

    expect(results).toHaveLength(snapshot.length);
    expect(results[0]!.source.semantic_blake3).toBe(snapshot[0]!.source.semantic_blake3);
    expect(results[1]!.source.semantic_blake3).toBe(snapshot[1]!.source.semantic_blake3);
  });

  it("returns empty array for empty input", async () => {
    const output = await dedup.deduplicate([]);
    expect(output).toEqual([]);
  });

  it("passes through a single result unchanged", async () => {
    const result = makeResult("hash-single", 0.95);
    const output = await dedup.deduplicate([result]);

    expect(output).toHaveLength(1);
    expect(output[0]!.source.semantic_blake3).toBe("hash-single");
    expect(output[0]!.score).toBe(0.95);
  });

  it("handles all unique entries correctly (no duplicates)", async () => {
    const results: SearchResult[] = [
      makeResult("hash-1", 0.9),
      makeResult("hash-2", 0.8),
      makeResult("hash-3", 0.7),
    ];

    const output = await dedup.deduplicate(results);

    expect(output).toHaveLength(3);
    expect(output[0]!.source.semantic_blake3).toBe("hash-1");
    expect(output[1]!.source.semantic_blake3).toBe("hash-2");
    expect(output[2]!.source.semantic_blake3).toBe("hash-3");
  });
});
