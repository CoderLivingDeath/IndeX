import { describe, expect, test } from "bun:test";

import type { PackedContext, Deduplicator, Tokenizer, ContextPacker } from "../../../src/domain/systems/ContextPackagingSystem";

describe("PackedContext interface", () => {
  test("all fields are present", () => {
    const ctx: PackedContext = {
      markdown: "# Results\n- item 1",
      chunks_used: 3,
      total_tokens: 500,
      truncated: false,
      source_notes: ["file1.ts", "file2.ts"],
    };

    expect(typeof ctx.markdown).toBe("string");
    expect(typeof ctx.chunks_used).toBe("number");
    expect(typeof ctx.total_tokens).toBe("number");
    expect(typeof ctx.truncated).toBe("boolean");
    expect(Array.isArray(ctx.source_notes)).toBe(true);
  });

  test("truncated flag works", () => {
    const truncated: PackedContext = {
      markdown: "trimmed...",
      chunks_used: 10,
      total_tokens: 1000,
      truncated: true,
      source_notes: [],
    };
    expect(truncated.truncated).toBe(true);
  });
});

describe("Deduplicator interface", () => {
  test("all methods are present", () => {
    const dedup: Deduplicator = {
      deduplicate: async (results) => results,
    };
    expect(typeof dedup.deduplicate).toBe("function");
  });

  test("deduplicate returns SearchResult array", async () => {
    const dedup: Deduplicator = {
      deduplicate: async (results) => {
        // Simple dedup by source ID
        const seen = new Set<string>();
        return results.filter((r) => {
          if (seen.has(r.source.id)) return false;
          seen.add(r.source.id);
          return true;
        });
      },
    };

    const baseSource = {
      id: "id-1",
      chunk_id: "c1",
      source_id: "s1",
      type: "code" as const,
      title: "a.ts",
      content: "",
      tags: [],
      path: "/a.ts",
      file_blake3: "h1",
      semantic_blake3: "h2",
      chunk_index: 0,
      total_chunks: 1,
      embeddings: [],
      metadata: { kind: "code" as const, language: "ts" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };

    const results = await dedup.deduplicate([
      { source: { ...baseSource }, score: 0.9, match_type: "semantic" },
      { source: { ...baseSource }, score: 0.8, match_type: "keyword" },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]!.score).toBe(0.9);
  });
});

describe("Tokenizer interface", () => {
  test("all methods are present", () => {
    const tokenizer: Tokenizer = {
      count: async (text) => text.split(" ").length,
      truncate: async (text, max) => text.split(" ").slice(0, max).join(" "),
    };

    expect(typeof tokenizer.count).toBe("function");
    expect(typeof tokenizer.truncate).toBe("function");
  });

  test("count returns number", async () => {
    const tokenizer: Tokenizer = {
      count: async (text) => text.split(" ").length,
      truncate: async (text, max) => text,
    };

    const count = await tokenizer.count("hello world foo");
    expect(typeof count).toBe("number");
    expect(count).toBe(3);
  });

  test("truncate respects max tokens", async () => {
    const tokenizer: Tokenizer = {
      count: async (text) => text.split(" ").length,
      truncate: async (text, max) =>
        text.split(" ").slice(0, max).join(" "),
    };

    const truncated = await tokenizer.truncate("a b c d e", 3);
    expect(truncated).toBe("a b c");
  });
});

describe("ContextPacker interface", () => {
  test("all methods are present", () => {
    const packer: ContextPacker = {
      pack: async (results, options) => ({
        markdown: results.map((r) => r.source.content).join("\n"),
        chunks_used: results.length,
        total_tokens: 0,
        truncated: false,
        source_notes: [],
      }),
    };

    expect(typeof packer.pack).toBe("function");
  });

  test("pack accepts optional maxTokens", async () => {
    const packer: ContextPacker = {
      pack: async (results, options) => ({
        markdown: "packed content",
        chunks_used: results.length,
        total_tokens: options?.maxTokens ?? 0,
        truncated: false,
        source_notes: [],
      }),
    };

    const result = await packer.pack([], { maxTokens: 2000 });
    expect(result.total_tokens).toBe(2000);
  });

  test("pack works without options", async () => {
    const packer: ContextPacker = {
      pack: async (results) => ({
        markdown: "default",
        chunks_used: 0,
        total_tokens: 0,
        truncated: false,
        source_notes: [],
      }),
    };

    const result = await packer.pack([]);
    expect(result.markdown).toBe("default");
    expect(result.truncated).toBe(false);
  });
});
