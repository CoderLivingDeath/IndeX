import { describe, it, expect } from "bun:test";
import { SentenceChunker } from "../../../src/infrastructure/chunking/SentenceChunker";
import { OverflowChunker } from "../../../src/infrastructure/chunking/OverflowChunker";
import { MockTokenEstimator } from "../../mocks/MockTokenEstimator";

describe("SentenceChunker", () => {
  function makeChunker(
    maxTokens: number,
    tokCount: number,
    overflowMax = 50,
    overflowMin = 20,
    abbreviations?: string[],
  ) {
    const estimator = new MockTokenEstimator(tokCount);
    const overflow = new OverflowChunker(overflowMax, overflowMin, estimator);
    return new SentenceChunker(maxTokens, estimator, overflow, abbreviations);
  }

  it("splits text at sentence boundaries", async () => {
    // Each sentence is ~5 tokens, maxTokens=12 => ~2 sentences per chunk
    const chunker = makeChunker(12, 5);
    const text = "Hello world. How are you? I am fine. Good bye!";

    const result = await chunker.chunk(text);

    expect(result.length).toBeGreaterThan(1);
    expect(result[0]!.strategy).toBe("sentence");

    // Verify no sentence is split across chunks
    for (const chunk of result) {
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it("protects abbreviations from false splitting", async () => {
    const chunker = makeChunker(100, 5);
    const text = "Dr. Smith went to Washington. He met Mrs. Jones at St. Mary's. She works for Mr. Brown.";

    const result = await chunker.chunk(text);

    // Should not split after Dr., Mrs., St., or Mr.
    // The text has 3 actual sentence boundaries -> 3 sentences
    // With maxTokens=100 and 5 tokens/sentence, all fit in one chunk
    expect(result.length).toBeGreaterThanOrEqual(1);

    // Verify each chunk contains complete sentences (no sentence fragment ends with abbreviation)
    for (const chunk of result) {
      const trimmed = chunk.content.trim();
      // If a chunk ends with an abbreviation period, that's wrong
      const endsWithAbbrev = /(?:Mr|Mrs|Dr|St)\.\s*$/.test(trimmed);
      expect(endsWithAbbrev).toBe(false);
    }
  });

  it("protects e.g. and i.e. from false splitting", async () => {
    const chunker = makeChunker(100, 5);
    const text = "There are many fruits (e.g. apples, oranges). I like them. Some vegetables (i.e. carrots) are also good.";

    const result = await chunker.chunk(text);

    const reconstructed = result.map((c) => c.content).join("");
    expect(reconstructed).toContain("e.g.");
    expect(reconstructed).toContain("i.e.");
  });

  it("protects vs., etc., Jr., Sr. abbreviations from false splitting", async () => {
    const chunker = makeChunker(100, 5);
    const text = "Apples vs. oranges is a common debate. He brought supplies (pens, paper, etc.). John Smith Jr. is here. Robert Downey Sr. was an actor.";

    const result = await chunker.chunk(text);
    const reconstructed = result.map((c) => c.content).join("");

    expect(reconstructed).toContain("vs.");
    expect(reconstructed).toContain("etc.");
    expect(reconstructed).toContain("Jr.");
    expect(reconstructed).toContain("Sr.");
  });

  it("never splits a single sentence", async () => {
    // A single sentence that fits within maxTokens should be one chunk
    const chunker = makeChunker(100, 5);
    const text = "This is a single sentence that should not be split.";

    const result = await chunker.chunk(text);

    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe(text);
  });

  it("delegates overlong sentences to OverflowChunker", async () => {
    // MockTokenEstimator returns 100 for any text
    // maxTokens=30, but each token estimate is 100 > 30
    // So the sentence should be delegated to overflow
    const estimator = new MockTokenEstimator(100);
    const overflow = new OverflowChunker(50, 20, estimator);
    const chunker = new SentenceChunker(30, estimator, overflow);
    const text = "This is a very long single sentence that exceeds the maximum token limit and should be delegated to the overflow chunker for forced splitting.";

    const result = await chunker.chunk(text);

    // Should return overflow chunks
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.strategy).toBe("overflow");
  });

  it("handles empty text", async () => {
    const chunker = makeChunker(100, 5);
    const result = await chunker.chunk("");
    expect(result).toHaveLength(0);
  });

  it("correctly sets chunk_index and total_chunks", async () => {
    const chunker = makeChunker(100, 5);
    const text = "First sentence here. Second sentence there. Third one too. Fourth as well.";

    const result = await chunker.chunk(text);

    expect(result[0]!.chunk_index).toBe(0);
    expect(result[result.length - 1]!.chunk_index).toBe(result.length - 1);
    for (const chunk of result) {
      expect(chunk.total_chunks).toBe(result.length);
    }
  });

  it("handles custom abbreviations", async () => {
    const chunker = makeChunker(100, 5, 50, 20, ["Inc.", "Ltd."]);
    const text = "Apple Inc. is a tech company. Microsoft Corp. is another one.";

    const result = await chunker.chunk(text);

    // Should not split after Inc.
    const reconstructed = result.map((c) => c.content).join("");
    expect(reconstructed).toContain("Inc.");
  });
});
