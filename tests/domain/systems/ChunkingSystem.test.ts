import { describe, expect, test } from "bun:test";

import type { Chunk, Chunker, ChunkerPipeline } from "../../../src/domain/systems/ChunkingSystem";
import type { SourceType } from "../../../src/domain/types";

describe("Chunk interface", () => {
  test("all fields are present", () => {
    const chunk: Chunk = {
      content: "function foo() {}",
      core_content: "function foo() {}",
      chunk_index: 0,
      total_chunks: 2,
      strategy: "token",
      size_tokens: 50,
    };

    expect(chunk.content).toBeDefined();
    expect(chunk.core_content).toBeDefined();
    expect(typeof chunk.chunk_index).toBe("number");
    expect(typeof chunk.total_chunks).toBe("number");
    expect(typeof chunk.strategy).toBe("string");
    expect(typeof chunk.size_tokens).toBe("number");
  });

  test("chunk_index is within range", () => {
    const chunk: Chunk = {
      content: "part 2",
      core_content: "part 2",
      chunk_index: 1,
      total_chunks: 3,
      strategy: "sentence",
      size_tokens: 30,
    };
    expect(chunk.chunk_index).toBeGreaterThanOrEqual(0);
    expect(chunk.chunk_index).toBeLessThan(chunk.total_chunks);
  });
});

describe("Chunker interface", () => {
  test("all members are present", () => {
    const chunker: Chunker = {
      type: "code" as SourceType,
      chunk: async (text: string) => [
        { content: text, core_content: text, chunk_index: 0, total_chunks: 1, strategy: "token", size_tokens: text.length },
      ],
    };

    expect(typeof chunker.chunk).toBe("function");
    expect(chunker.type).toBe("code");
  });

  test("chunk returns array of Chunk", async () => {
    const chunker: Chunker = {
      type: "markdown" as SourceType,
      chunk: async (text: string) => [
        {
          content: text,
          core_content: text,
          chunk_index: 0,
          total_chunks: 1,
          strategy: "heading",
          size_tokens: 100,
        },
      ],
    };

    const result = await chunker.chunk("# Heading\nContent");
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toContain("Heading");
  });
});

describe("ChunkerPipeline interface", () => {
  test("all members are present", () => {
    const pipeline: ChunkerPipeline = {
      chunkers: [],
      chunk: async (text: string, type: SourceType) => [],
    };

    expect(Array.isArray(pipeline.chunkers)).toBe(true);
    expect(typeof pipeline.chunk).toBe("function");
  });

  test("chunk method accepts text and type", async () => {
    const pipeline: ChunkerPipeline = {
      chunkers: [],
      chunk: async (text: string, type: SourceType) => [
        { content: text, core_content: text, chunk_index: 0, total_chunks: 1, strategy: "token", size_tokens: 10 },
      ],
    };

    const result = await pipeline.chunk("hello world", "code");
    expect(result).toHaveLength(1);
  });
});
