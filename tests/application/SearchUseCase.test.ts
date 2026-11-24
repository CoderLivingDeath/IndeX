// ---------------------------------------------------------------------------
// SearchUseCase — vector handoff and delegation tests
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeAll } from "bun:test";

import type { SearchSystems } from "../../src/application/di/Systems";
import type { Embedder, Embedding } from "../../src/domain/systems/EmbeddingSystem";
import type { SourceData } from "../../src/domain/types";
import { MockSourceRepository } from "../mocks/MockSourceRepository";
import { SearchUseCase } from "../../src/application/SearchUseCase";
import { SearchService } from "../../src/domain/services/SearchService";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeSourceData(
  content: string,
  overrides: Partial<SourceData> = {},
): SourceData {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    chunk_id: crypto.randomUUID(),
    source_id: crypto.randomUUID(),
    type: "markdown",
    title: "test",
    content,
    tags: ["docs"],
    path: "/test/file.md",
    file_blake3: "mock-hash",
    semantic_blake3: "mock-semantic-hash",
    chunk_index: 0,
    total_chunks: 1,
    embeddings: [],
    metadata: { kind: "markdown" },
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

class SpyEmbedder implements Embedder {
  readonly model = "spy-model";
  readonly dimensions = 2;
  calls = 0;
  texts: string[] = [];

  async embed(text: string): Promise<Embedding> {
    this.calls++;
    this.texts.push(text);
    return {
      vector: [0.1, 0.2],
      model: this.model,
      dimensions: this.dimensions,
      tokens_in: 1,
    };
  }

  async embedBatch(texts: string[]): Promise<Embedding[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("SearchUseCase", () => {
  let repo: MockSourceRepository;
  let embedder: SpyEmbedder;
  let useCase: SearchUseCase;

  beforeAll(async () => {
    repo = new MockSourceRepository();
    await repo.upsertBatch([
      makeSourceData("The quick brown fox jumps over the lazy dog", {
        path: "/test/animals.md",
        tags: ["animals"],
      }),
      makeSourceData("Python is a programming language used for web development", {
        path: "/test/python.md",
        type: "code",
        tags: ["code", "python"],
      }),
      makeSourceData("JavaScript is a language for building web applications", {
        path: "/test/javascript.md",
        type: "code",
        tags: ["code", "javascript"],
      }),
      makeSourceData("Machine learning algorithms learn from data", {
        path: "/test/ml.md",
        tags: ["ai", "ml"],
      }),
    ]);

    embedder = new SpyEmbedder();
    const ranker = new SearchService(repo, { hybrid_weight: 0.7 });

    const systems: SearchSystems = {
      embedder,
      ranker,
      logger: mockLogger,
    };

    useCase = new SearchUseCase(systems);
  });

  test("hybrid search returns ranked results", async () => {
    const results = await useCase.execute("fox", { mode: "hybrid" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.source.content.includes("fox"))).toBe(true);
  });

  test("semantic search returns results with semantic match type", async () => {
    const results = await useCase.execute("programming", {
      mode: "semantic",
      top_k: 5,
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.match_type).toBe("semantic");
    }
  });

  test("keyword search returns results", async () => {
    const results = await useCase.execute("language", { mode: "keyword" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.match_type).toBe("keyword");
    }
  });

  test("mode switching produces the correct match_type", async () => {
    const keyword = await useCase.execute("data", { mode: "keyword" });
    for (const r of keyword) expect(r.match_type).toBe("keyword");

    const hybrid = await useCase.execute("data", { mode: "hybrid" });
    for (const r of hybrid) expect(r.match_type).toBe("hybrid");

    const ast = await useCase.execute("data", { mode: "ast" });
    for (const r of ast) expect(r.match_type).toBe("ast");
  });

  test("embeds the query exactly once for vector modes", async () => {
    embedder.calls = 0;
    await useCase.execute("fox", { mode: "semantic" });
    expect(embedder.calls).toBe(1);

    embedder.calls = 0;
    await useCase.execute("fox", { mode: "hybrid" });
    expect(embedder.calls).toBe(1);

    embedder.calls = 0;
    await useCase.execute("fox", { mode: "keyword" });
    expect(embedder.calls).toBe(0);

    embedder.calls = 0;
    await useCase.execute("fox", { mode: "ast" });
    expect(embedder.calls).toBe(0);
  });

  test("forwards tags, source_types, and min_score to the ranking engine", async () => {
    let capturedQuery: unknown = null;
    let capturedVector: unknown = null;

    const fakeRanker = {
      execute: async (query: unknown, vector?: number[]) => {
        capturedQuery = query;
        capturedVector = vector;
        return [];
      },
    } as unknown as SearchService;

    const forwardingUseCase = new SearchUseCase({
      embedder: new SpyEmbedder(),
      ranker: fakeRanker,
      logger: mockLogger,
    });

    await forwardingUseCase.execute("query", {
      mode: "semantic",
      top_k: 3,
      tags: ["devops"],
      source_types: ["code"],
      min_score: 0.5,
    });

    expect(capturedQuery).toMatchObject({
      text: "query",
      mode: "semantic",
      top_k: 3,
      tags: ["devops"],
      source_types: ["code"],
      min_score: 0.5,
    });
    expect(capturedVector).toEqual([0.1, 0.2]);
  });

  test("empty query returns empty results without embedding", async () => {
    embedder.calls = 0;
    const results = await useCase.execute("", { mode: "hybrid" });
    expect(results).toHaveLength(0);
    expect(embedder.calls).toBe(0);
  });
});
