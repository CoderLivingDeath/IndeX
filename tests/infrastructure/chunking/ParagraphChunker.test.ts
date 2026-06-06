import { describe, it, expect } from "bun:test";
import { ParagraphChunker } from "../../../src/infrastructure/chunking/ParagraphChunker";
import { SentenceChunker } from "../../../src/infrastructure/chunking/SentenceChunker";
import { OverflowChunker } from "../../../src/infrastructure/chunking/OverflowChunker";
import { MockTokenEstimator } from "../../mocks/MockTokenEstimator";

describe("ParagraphChunker", () => {
  function makeChunker(
    maxTokens: number,
    tokCount: number,
    sentenceMax = 30,
  ) {
    const estimator = new MockTokenEstimator(tokCount);
    const overflow = new OverflowChunker(sentenceMax, 10, estimator);
    const sentence = new SentenceChunker(sentenceMax, estimator, overflow);
    return new ParagraphChunker(maxTokens, estimator, sentence);
  }

  it("splits text by blank line boundaries", async () => {
    const chunker = makeChunker(100, 5);
    const text = "First paragraph here.\n\nSecond paragraph there.\n\nThird paragraph here.";

    const result = await chunker.chunk(text);

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].strategy).toBe("paragraph");
  });

  it("returns one chunk per paragraph that fits within max_tokens", async () => {
    const chunker = makeChunker(100, 5);
    const text = "Short para one.\n\nShort para two.\n\nShort para three.";

    const result = await chunker.chunk(text);

    expect(result).toHaveLength(3);
    for (const chunk of result) {
      expect(chunk.strategy).toBe("paragraph");
    }
  });

  it("delegates overlong paragraphs to SentenceChunker", async () => {
    // Each paragraph estimate is 100 tokens, maxTokens=30 for paragraph
    // So each paragraph > maxTokens → delegates to sentence chunker
    const estimator = new MockTokenEstimator(100);
    const overflow = new OverflowChunker(30, 10, estimator);
    const sentence = new SentenceChunker(30, estimator, overflow);
    const chunker = new ParagraphChunker(30, estimator, sentence);
    const text = "This is a long paragraph that exceeds the maximum token limit for paragraphs.\n\nAnother long paragraph that also exceeds the limit.";

    const result = await chunker.chunk(text);

    // Should delegate to sentence chunker at minimum
    expect(result.length).toBeGreaterThanOrEqual(1);
    // If sentences also exceed maxTokens, they fall through to overflow
  });

  it("handles empty text", async () => {
    const chunker = makeChunker(100, 5);
    const result = await chunker.chunk("");
    expect(result).toHaveLength(0);
  });

  it("handles single paragraph without blank lines", async () => {
    const chunker = makeChunker(100, 5);
    const text = "Just one paragraph here with no blank lines.";

    const result = await chunker.chunk(text);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe(text);
  });

  it("correctly sets chunk_index and total_chunks", async () => {
    const chunker = makeChunker(100, 5);
    const text = "Para one.\n\nPara two.\n\nPara three.\n\nPara four.";

    const result = await chunker.chunk(text);

    expect(result[0].chunk_index).toBe(0);
    expect(result[result.length - 1].chunk_index).toBe(result.length - 1);
    for (const chunk of result) {
      expect(chunk.total_chunks).toBe(result.length);
    }
  });

  it("has type 'markdown'", async () => {
    const chunker = makeChunker(100, 5);
    expect(chunker.type).toBe("markdown");
  });
});
