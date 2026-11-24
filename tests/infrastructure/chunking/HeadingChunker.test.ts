import { describe, it, expect } from "bun:test";
import { HeadingChunker } from "../../../src/infrastructure/chunking/HeadingChunker";
import { MockTokenEstimator } from "../../mocks/MockTokenEstimator";

describe("HeadingChunker", () => {
  it("splits Markdown by heading boundaries", async () => {
    const estimator = new MockTokenEstimator(20);
    const chunker = new HeadingChunker(100, estimator);
    const text = `# Heading One
Content for section one.

## Heading Two
Content for section two.

### Heading Three
Content for section three.`;

    const result = await chunker.chunk(text);

    expect(result.length).toBe(3);
    expect(result[0]!.strategy).toBe("heading");
  });

  it("returns one chunk per section that fits within max_tokens", async () => {
    const estimator = new MockTokenEstimator(30);
    const chunker = new HeadingChunker(100, estimator);
    const text = `# Intro
Welcome to the docs.

## Getting Started
Install and run.`;

    const result = await chunker.chunk(text);

    expect(result).toHaveLength(2);
    for (const chunk of result) {
      expect(chunk.strategy).toBe("heading");
    }
  });

  it("includes oversized sections as-is when no fallback is configured", async () => {
    // Each section estimate is 150 tokens, maxTokens=100
    // With no fallback, the chunker preserves content rather than losing it
    const estimator = new MockTokenEstimator(150);
    const chunker = new HeadingChunker(100, estimator);
    const text = `# Very Large Section
${"A".repeat(500)}
## Another Large Section
${"B".repeat(500)}`;

    const result = await chunker.chunk(text);

    expect(result).toHaveLength(2);
    expect(result[0]!.strategy).toBe("heading");
    expect(result[1]!.strategy).toBe("heading");
  });

  it("core_content is section body without the heading", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new HeadingChunker(100, estimator);
    const text = `# Title
Body content here.`;

    const result = await chunker.chunk(text);

    expect(result).toHaveLength(1);
    expect(result[0]!.core_content).toBe("Body content here.");
    expect(result[0]!.content).toContain("Body content here.");
  });

  it("handles text without headings as a single section", async () => {
    const estimator = new MockTokenEstimator(20);
    const chunker = new HeadingChunker(100, estimator);
    const text = "Just a plain paragraph with no headings.";

    const result = await chunker.chunk(text);

    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe(text);
  });

  it("handles empty text", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new HeadingChunker(100, estimator);
    const result = await chunker.chunk("");
    expect(result).toHaveLength(0);
  });

  it("correctly sets chunk_index and total_chunks", async () => {
    const estimator = new MockTokenEstimator(20);
    const chunker = new HeadingChunker(100, estimator);
    const text = `# One
Content A.

## Two
Content B.`;

    const result = await chunker.chunk(text);

    expect(result[0]!.chunk_index).toBe(0);
    expect(result[1]!.chunk_index).toBe(1);
    expect(result[0]!.total_chunks).toBe(2);
    expect(result[1]!.total_chunks).toBe(2);
  });

  it("has type 'markdown'", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new HeadingChunker(100, estimator);
    expect(chunker.type).toBe("markdown");
  });
});
