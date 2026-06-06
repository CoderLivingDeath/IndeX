import { describe, it, expect } from "bun:test";
import { OverflowChunker } from "../../../src/infrastructure/chunking/OverflowChunker";
import { MockTokenEstimator } from "../../mocks/MockTokenEstimator";

describe("OverflowChunker", () => {
  it("splits text at token boundary closest to max_tokens", async () => {
    // MockTokenEstimator(250) for 300 char text => charsPerToken ≈ 1.2
    // maxTokens=50 => chunkSize ≈ 60 chars => ~5 chunks
    const estimator = new MockTokenEstimator(250);
    const chunker = new OverflowChunker(50, 20, estimator);
    const text = "A".repeat(300);

    const result = await chunker.chunk(text);

    expect(result.length).toBeGreaterThan(1);
    expect(result[0].strategy).toBe("overflow");

    // Concatenated content should equal original
    const reconstructed = result.map((c) => c.content).join("");
    expect(reconstructed).toBe(text);
  });

  it("each chunk has at least min_tokens", async () => {
    // MockTokenEstimator(250) for 300 char text => charsPerToken ≈ 1.2
    // minTokens=20 => minChunkSize ≈ 24 chars
    const estimator = new MockTokenEstimator(250);
    const chunker = new OverflowChunker(50, 20, estimator);
    const text = "A".repeat(300);

    const result = await chunker.chunk(text);

    for (const chunk of result) {
      expect(chunk.size_tokens).toBeGreaterThanOrEqual(20);
    }
  });

  it("returns single chunk if text fits within max_tokens", async () => {
    const estimator = new MockTokenEstimator(30);
    const chunker = new OverflowChunker(200, 50, estimator);
    const text = "Short text";

    const result = await chunker.chunk(text);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe(text);
  });

  it("has type 'generic'", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new OverflowChunker(200, 50, estimator);
    expect(chunker.type).toBe("generic");
  });

  it("correctly sets chunk_index and total_chunks", async () => {
    const estimator = new MockTokenEstimator(250);
    const chunker = new OverflowChunker(50, 20, estimator);
    const text = "A".repeat(300);

    const result = await chunker.chunk(text);

    expect(result[0].chunk_index).toBe(0);
    expect(result[result.length - 1].chunk_index).toBe(result.length - 1);
    for (const chunk of result) {
      expect(chunk.total_chunks).toBe(result.length);
    }
  });

  it("handles empty text", async () => {
    const estimator = new MockTokenEstimator(0);
    const chunker = new OverflowChunker(200, 50, estimator);
    const result = await chunker.chunk("");
    expect(result).toHaveLength(0);
  });

  it("handles single-line text", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new OverflowChunker(200, 50, estimator);
    const result = await chunker.chunk("Just one line");
    expect(result).toHaveLength(1);
  });
});
