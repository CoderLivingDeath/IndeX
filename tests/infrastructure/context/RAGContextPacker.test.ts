import { describe, it, expect } from "bun:test";
import { RAGContextPacker } from "../../../src/infrastructure/context/RAGContextPacker";
import { MockDeduplicator } from "../../mocks/MockDeduplicator";
import { MockTokenizer } from "../../mocks/MockTokenizer";
import type { SearchResult } from "../../../src/domain/types";
import type { Deduplicator, Tokenizer } from "../../../src/domain/systems/ContextPackagingSystem";

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
      path: `src/${semantic_blake3}.ts`,
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

describe("RAGContextPacker", () => {
  it("full pipeline: dedup → sort by score desc → greedy-fit → format as Markdown", async () => {
    const dedup = new MockDeduplicator(true);
    const tokenizer = new MockTokenizer(1);
    const packer = new RAGContextPacker(dedup, tokenizer);

    const results: SearchResult[] = [
      makeResult("hash-a", 0.3),
      makeResult("hash-b", 0.9),
      makeResult("hash-c", 0.6),
    ];

    const packed = await packer.pack(results, { maxTokens: 100 });

    expect(packed.chunks_used).toBe(3);
    expect(packed.truncated).toBe(false);
    expect(packed.total_tokens).toBe(9); // "Content for hash-X" = 3 words each x 3 = 9

    // Order by score descending
    const lines = packed.markdown.split("\n");
    expect(lines[0]).toBe("### Source: src/hash-b.ts");
    expect(lines[2]).toBe("### Source: src/hash-c.ts");
    expect(lines[4]).toBe("### Source: src/hash-a.ts");
  });

  it("sets truncated=true when results exceed maxTokens", async () => {
    const dedup = new MockDeduplicator(true);
    const tokenizer = new MockTokenizer(50); // each word = 50 tokens
    const packer = new RAGContextPacker(dedup, tokenizer);

    const results: SearchResult[] = [
      makeResult("hash-a", 0.3),
      makeResult("hash-b", 0.9),
      makeResult("hash-c", 0.6),
    ];

    const packed = await packer.pack(results, { maxTokens: 200 });

    // Each result: 3 words * 50 = 150 tokens
    // Top result (hash-b, 0.9): 150 ≤ 200 ✓ → included
    // Next (hash-c, 0.6): 150 + 150 = 300 > 200 ✗ → excluded
    // chunks_used=1, truncated=true
    expect(packed.chunks_used).toBe(1);
    expect(packed.truncated).toBe(true);
    expect(packed.markdown).toContain("hash-b");
    expect(packed.markdown).not.toContain("hash-c");
    expect(packed.markdown).not.toContain("hash-a");
  });

  it("source_notes contains unique paths from included chunks", async () => {
    const dedup = new MockDeduplicator(true);
    const tokenizer = new MockTokenizer(1);
    const packer = new RAGContextPacker(dedup, tokenizer);

    const results: SearchResult[] = [
      makeResult("hash-a", 0.9, { path: "src/file-a.ts" }),
      makeResult("hash-b", 0.8, { path: "src/file-b.ts" }),
      makeResult("hash-c", 0.7, { path: "src/file-a.ts" }), // same path as hash-a
    ];

    const packed = await packer.pack(results, { maxTokens: 1000 });

    expect(packed.source_notes).toContain("src/file-a.ts");
    expect(packed.source_notes).toContain("src/file-b.ts");
    expect(packed.source_notes).toHaveLength(2);
  });

  it('format "rag" includes system prompt and <context> tags', async () => {
    const dedup = new MockDeduplicator(true);
    const tokenizer = new MockTokenizer(1);
    const packer = new RAGContextPacker(dedup, tokenizer);

    const results: SearchResult[] = [
      makeResult("hash-a", 0.9),
    ];

    const packed = await packer.pack(results, { maxTokens: 1000, format: "rag" });

    expect(packed.markdown).toStartWith(
      "You are a helpful assistant. Use the following context to answer the user's question.",
    );
    expect(packed.markdown).toContain("<context>");
    expect(packed.markdown).toContain("</context>");
    // Content between tags
    expect(packed.markdown).toContain("### Source: src/hash-a.ts");
  });

  it('format "context" is plain Markdown without system prompt', async () => {
    const dedup = new MockDeduplicator(true);
    const tokenizer = new MockTokenizer(1);
    const packer = new RAGContextPacker(dedup, tokenizer);

    const results: SearchResult[] = [
      makeResult("hash-a", 0.9),
    ];

    const packed = await packer.pack(results, { maxTokens: 1000, format: "context" });

    // Should NOT contain system prompt
    expect(packed.markdown).not.toContain("You are a helpful assistant");
    // Should NOT contain context tags
    expect(packed.markdown).not.toContain("<context>");
    expect(packed.markdown).not.toContain("</context>");
    // Should contain the source header
    expect(packed.markdown).toContain("### Source: src/hash-a.ts");
  });

  it("default format is context (plain Markdown)", async () => {
    const dedup = new MockDeduplicator(true);
    const tokenizer = new MockTokenizer(1);
    const packer = new RAGContextPacker(dedup, tokenizer);

    const results: SearchResult[] = [
      makeResult("hash-a", 0.9),
    ];

    const packed = await packer.pack(results);

    // Should NOT contain system prompt (default is "context")
    expect(packed.markdown).not.toContain("You are a helpful assistant");
    expect(packed.markdown).toContain("### Source: src/hash-a.ts");
  });

  it("empty results returns valid PackedContext with 0 chunks", async () => {
    const dedup = new MockDeduplicator(true);
    const tokenizer = new MockTokenizer(1);
    const packer = new RAGContextPacker(dedup, tokenizer);

    const packed = await packer.pack([], { maxTokens: 1000 });

    expect(packed.chunks_used).toBe(0);
    expect(packed.total_tokens).toBe(0);
    expect(packed.truncated).toBe(false);
    expect(packed.source_notes).toEqual([]);
    expect(packed.markdown).toBe("");
  });

  it("uses injectable Deduplicator — deduplicate is called and duplicates removed", async () => {
    const dedup = new MockDeduplicator(true); // enabled
    const tokenizer = new MockTokenizer(1);
    const packer = new RAGContextPacker(dedup, tokenizer);

    const results: SearchResult[] = [
      makeResult("hash-a", 0.9),
      makeResult("hash-b", 0.8),
      makeResult("hash-a", 0.7), // duplicate of hash-a, lower score
    ];

    const packed = await packer.pack(results, { maxTokens: 1000 });

    // Only 2 unique results (hash-a with score 0.9, hash-b with score 0.8)
    expect(packed.chunks_used).toBe(2);
    expect(packed.markdown).toContain("hash-b");
    expect(packed.markdown).not.toContain("hash-a with score 0.7"); // lower score not included
  });
});
