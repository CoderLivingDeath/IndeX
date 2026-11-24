import { describe, it, expect } from "bun:test";
import { ChunkerFactory } from "../../../src/infrastructure/chunking/ChunkerFactory";
import { MockTokenEstimator } from "../../mocks/MockTokenEstimator";

describe("ChunkerFactory", () => {
  it("createPipeline builds ordered fallback chain from strategy names", async () => {
    const estimator = new MockTokenEstimator(10);
    const factory = new ChunkerFactory(500, estimator);
    const pipeline = factory.createPipeline([
      "heading",
      "paragraph",
      "sentence",
      "overflow",
    ]);

    expect(pipeline.chunkers).toHaveLength(4);
    expect(pipeline.chunkers[0]!.constructor.name).toBe("HeadingChunker");
    expect(pipeline.chunkers[1]!.constructor.name).toBe("ParagraphChunker");
    expect(pipeline.chunkers[2]!.constructor.name).toBe("SentenceChunker");
    expect(pipeline.chunkers[3]!.constructor.name).toBe("OverflowChunker");
  });

  it("pipeline routes markdown through heading chain successfully", async () => {
    const estimator = new MockTokenEstimator(10);
    const factory = new ChunkerFactory(500, estimator);
    const pipeline = factory.createPipeline([
      "heading",
      "paragraph",
      "sentence",
      "overflow",
    ]);

    const text = `# Heading
Some content here.

## Subheading
More content.`;
    const result = await pipeline.chunk(text, "markdown");

    expect(result.length).toBeGreaterThan(0);
    // Should use heading strategy since headings exist
    expect(result[0]!.strategy).toBe("heading");
  });

  it("pipeline routes code through code chunker", async () => {
    const estimator = new MockTokenEstimator(10);
    const factory = new ChunkerFactory(500, estimator);
    const pipeline = factory.createPipeline([
      "heading",
      "paragraph",
      "sentence",
      "overflow",
      "code",
    ]);

    const code = `function foo() { return 1; }
function bar() { return 2; }`;
    const result = await pipeline.chunk(code, "code");

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.strategy).toBe("code");
  });

  it("pipeline routes generic type through overflow", async () => {
    const estimator = new MockTokenEstimator(100);
    const factory = new ChunkerFactory(50, estimator);
    const pipeline = factory.createPipeline(["overflow"]);

    const text = "A".repeat(200);
    const result = await pipeline.chunk(text, "generic");

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.strategy).toBe("overflow");
  });

  it("merges consecutive chunks below 50 tokens with previous chunk", async () => {
    // 20 sentences, each estimated as 5 tokens by MockTokenEstimator
    // maxTokens=15 → ~3 sentences per raw chunk, each with size_tokens=5 (mock)
    // All raw chunks are < 50, so they should be merged into fewer chunks
    const estimator = new MockTokenEstimator(5);
    const factory = new ChunkerFactory(15, estimator);
    const pipeline = factory.createPipeline(["sentence", "overflow"]);

    const text = Array.from({ length: 20 }, (_, i) => `Sentence ${i + 1}.`).join(" ");

    // Get raw chunks (before merge)
    const rawChunker = pipeline.chunkers[0]!;
    const rawResult = await rawChunker.chunk(text);

    // Get pipeline chunks (with merge/post-process)
    const mergedResult = await pipeline.chunk(text, "markdown");

    // Merge should reduce chunk count
    expect(mergedResult.length).toBeLessThan(rawResult.length);

    // Merged chunks reflect real estimation (mock returns 5 for any content)
    for (const chunk of mergedResult) {
      expect(chunk.size_tokens).toBeGreaterThanOrEqual(1);
    }
  });

  it("applies 32-token overlap on content but not core_content", async () => {
    const estimator = new MockTokenEstimator(30);
    const factory = new ChunkerFactory(70, estimator);
    const pipeline = factory.createPipeline(["sentence", "overflow"]);

    const text =
      "This is the first sentence here. This is the second sentence here. " +
      "This is the third sentence here. This is the fourth sentence here. " +
      "This is the fifth sentence here.";

    const result = await pipeline.chunk(text, "markdown");

    // With maxTokens=70, 5 sentences × 30 tokens = 150 → ~2-3 chunks
    expect(result.length).toBeGreaterThan(1);

    // Verify overlap exists in content but not in core_content
    const secondChunkContent = result[1]!.content;
    const secondChunkCore = result[1]!.core_content;

    expect(secondChunkContent.length).toBeGreaterThan(secondChunkCore.length);
    expect(secondChunkContent).toContain(secondChunkCore);
  });

  it("handles empty text", async () => {
    const estimator = new MockTokenEstimator(10);
    const factory = new ChunkerFactory(500, estimator);
    const pipeline = factory.createPipeline(["heading", "overflow"]);

    const result = await pipeline.chunk("", "markdown");
    expect(result).toHaveLength(0);
  });
});
