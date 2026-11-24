import { describe, expect, test } from "bun:test";

import type { SourceRepository } from "../../../src/domain/ports/SourceRepository";
import type {
  SearchQuery,
  SearchResult,
  SourceData,
  SourceType,
} from "../../../src/domain/types";
import { MockSourceRepository } from "../../mocks/MockSourceRepository";
import { SearchService } from "../../../src/domain/services/SearchService";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeSourceData(overrides: Partial<SourceData> & { id: string; content: string }): SourceData {
  const now = new Date().toISOString();
  const { id, content, ...rest } = overrides;
  return {
    id,
    chunk_id: `chunk-${id}`,
    source_id: `src-${id}`,
    type: "generic" as SourceType,
    title: `file-${id}.txt`,
    content,
    tags: rest.tags ?? [],
    path: `/fixtures/file-${id}.txt`,
    file_blake3: `blake3-${id}`,
    semantic_blake3: `sem-${id}`,
    chunk_index: 0,
    total_chunks: 1,
    embeddings: [],
    metadata: rest.metadata ?? { kind: "generic", encoding: "utf-8" },
    created_at: now,
    updated_at: now,
    ...rest,
  };
}

async function seedRepo(
  repo: MockSourceRepository,
  contents: { content: string; tags?: string[]; type?: SourceType }[],
): Promise<SourceData[]> {
  const sources = contents.map((c, i) =>
    makeSourceData({
      id: `doc-${i}`,
      content: c.content,
      tags: c.tags ?? [],
      type: c.type ?? "generic",
    }),
  );
  await repo.upsertBatch(sources);
  return sources;
}

/** Minimal repository whose search results are supplied by a callback. */
function fakeRepo(
  handler: (query: SearchQuery) => SearchResult[],
): SourceRepository {
  return {
    search: async (query: SearchQuery) => handler(query),
  } as unknown as SourceRepository;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("SearchService", () => {
  // ── Semantic mode ──────────────────────────────────────────

  describe("semantic search", () => {
    test("passes the query vector to the repository", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [{ content: "the quick brown fox" }]);

      let capturedQuery: SearchQuery | null = null;
      const originalSearch = repo.search.bind(repo);
      repo.search = async (q: SearchQuery) => {
        capturedQuery = q;
        return originalSearch(q);
      };

      const service = new SearchService(repo);
      const results = await service.execute(
        { text: "quick brown", mode: "semantic", top_k: 10 },
        [1, 0, 0],
      );

      expect(capturedQuery).not.toBeNull();
      expect(capturedQuery!.mode).toBe("semantic");
      expect(capturedQuery!.vector).toEqual([1, 0, 0]);
      expect(results.length).toBeGreaterThan(0);
    });

    test("returns empty results without a vector and does not call the repo", async () => {
      let called = false;
      const repo = fakeRepo(() => {
        called = true;
        return [];
      });

      const service = new SearchService(repo);
      const results = await service.execute({
        text: "anything",
        mode: "semantic",
        top_k: 10,
      });

      expect(results).toEqual([]);
      expect(called).toBe(false);
    });

    test("averages model_scores when present", async () => {
      const repo = fakeRepo(() => [
        {
          source: makeSourceData({ id: "m1", content: "target" }),
          score: 0.1,
          match_type: "semantic",
          model_scores: { "model-a": 0.8, "model-b": 0.6 },
        },
      ]);

      const service = new SearchService(repo);
      const results = await service.execute(
        { text: "target", mode: "semantic", top_k: 10 },
        [1],
      );

      expect(results).toHaveLength(1);
      expect(results[0]!.score).toBeCloseTo(0.7, 5);
    });
  });

  // ── Keyword mode ───────────────────────────────────────────

  describe("keyword search", () => {
    test("routes to repo with keyword mode", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "typescript is great" },
        { content: "python is also great" },
      ]);

      let capturedMode = "";
      const originalSearch = repo.search.bind(repo);
      repo.search = async (q: SearchQuery) => {
        capturedMode = q.mode;
        return originalSearch(q);
      };

      const service = new SearchService(repo);
      await service.execute({ text: "great", mode: "keyword", top_k: 10 });

      expect(capturedMode).toBe("keyword");
    });

    test("returns matches scored in (0, 1]", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "nodejs typescript express" },
        { content: "python django flask" },
        { content: "typescript react nodejs" },
      ]);

      const service = new SearchService(repo);
      const results = await service.execute({
        text: "typescript",
        mode: "keyword",
        top_k: 10,
      });

      expect(results.length).toBe(2);
      for (const r of results) {
        expect(r.source.content).toMatch(/typescript/);
        expect(r.score).toBeGreaterThan(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    });
  });

  // ── AST mode ─────────────────────────────────────────────

  describe("ast search", () => {
    test("routes to repo with ast mode and keeps the ast match type", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [{ content: "import zod from 'zod'" }]);

      let capturedMode = "";
      const originalSearch = repo.search.bind(repo);
      repo.search = async (q: SearchQuery) => {
        capturedMode = q.mode;
        return originalSearch(q);
      };

      const service = new SearchService(repo);
      const results = await service.execute({
        text: "zod",
        mode: "ast",
        top_k: 10,
      });

      expect(capturedMode).toBe("ast");
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.match_type).toBe("ast");
      }
    });
  });

  // ── Hybrid mode ────────────────────────────────────────────

  describe("hybrid search", () => {
    test("merges semantic and keyword results with weighted scoring", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "the quick brown fox" },
        { content: "jumps over the lazy dog" },
        { content: "quick brown rabbit" },
      ]);

      const service = new SearchService(repo, { hybrid_weight: 0.7 });
      const results = await service.execute(
        { text: "quick brown", mode: "hybrid", top_k: 10 },
        [1, 0, 0],
      );

      expect(results.length).toBe(2);
      for (const r of results) {
        expect(r.match_type).toBe("hybrid");
        expect(r.score).toBeGreaterThan(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    });

    test("returns empty results without a vector", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [{ content: "quick brown fox" }]);

      const service = new SearchService(repo);
      const results = await service.execute({
        text: "quick brown",
        mode: "hybrid",
        top_k: 10,
      });

      expect(results).toEqual([]);
    });

    test("uses hybrid_weight from options", async () => {
      const source = makeSourceData({ id: "weighted", content: "weighted" });
      const repo = fakeRepo((query) => {
        if (query.mode === "semantic") {
          return [{ source, score: 1, match_type: "semantic" }];
        }
        if (query.mode === "keyword") {
          return [{ source, score: 1, match_type: "keyword" }];
        }
        return [];
      });

      const service = new SearchService(repo, { hybrid_weight: 0.25 });
      const results = await service.execute(
        { text: "weighted", mode: "hybrid", top_k: 10 },
        [1],
      );

      // 0.25 * semantic + 0.75 * keyword = 1.0
      expect(results).toHaveLength(1);
      expect(results[0]!.score).toBeCloseTo(1, 5);
      expect(results[0]!.model_scores).toEqual({ semantic: 1, keyword: 1 });
    });

    test("uses default hybrid_weight of 0.7 when keyword leg is empty", async () => {
      const source = makeSourceData({ id: "sem-only", content: "only semantic" });
      const repo = fakeRepo((query) =>
        query.mode === "semantic"
          ? [{ source, score: 1, match_type: "semantic" }]
          : [],
      );

      const service = new SearchService(repo);
      const results = await service.execute(
        { text: "semantic", mode: "hybrid", top_k: 10 },
        [1],
      );

      expect(results).toHaveLength(1);
      expect(results[0]!.score).toBeCloseTo(0.7, 5);
    });
  });

  // ── Post-filtering ─────────────────────────────────────────

  describe("post-filtering", () => {
    test("filters results by tags", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "alpha content", tags: ["important"] },
        { content: "beta content", tags: ["archived"] },
        { content: "gamma content", tags: ["important", "urgent"] },
      ]);

      const service = new SearchService(repo);
      const results = await service.execute({
        text: "content",
        mode: "keyword",
        top_k: 10,
        tags: ["important"],
      });

      expect(results.length).toBe(2);
      for (const r of results) {
        expect(r.source.tags).toContain("important");
      }
    });

    test("filters results by source_type", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "code stuff", type: "code" as SourceType },
        { content: "markdown stuff", type: "markdown" as SourceType },
        { content: "generic stuff", type: "generic" as SourceType },
      ]);

      const service = new SearchService(repo);
      const results = await service.execute({
        text: "stuff",
        mode: "keyword",
        top_k: 10,
        source_types: ["code"],
      });

      expect(results.length).toBe(1);
      expect(results[0]!.source.type).toBe("code");
    });

    test("filters results below min_score", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [{ content: "hello world" }]);

      const service = new SearchService(repo);
      const results = await service.execute({
        text: "hello",
        mode: "keyword",
        top_k: 10,
        min_score: 0.99,
      });

      expect(results).toEqual([]);
    });
  });

  // ── Empty index ────────────────────────────────────────────

  describe("empty index", () => {
    test("returns empty array when index has no data", async () => {
      const repo = new MockSourceRepository();
      const service = new SearchService(repo);

      const results = await service.execute(
        { text: "anything", mode: "semantic", top_k: 10 },
        [1, 2, 3],
      );

      expect(results).toEqual([]);
    });
  });
});
