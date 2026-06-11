import { describe, expect, test } from "bun:test";

import type { SourceRepository } from "../../../src/domain/ports/SourceRepository";
import type { Embedder } from "../../../src/domain/systems/EmbeddingSystem";
import type {
  SearchQuery,
  SearchResult,
  SourceData,
  SourceType,
} from "../../../src/domain/types";
import { MockEmbedder } from "../../mocks/MockEmbedder";
import { MockSourceRepository } from "../../mocks/MockSourceRepository";
import { SearchService } from "../../../src/domain/services/SearchService";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeSourceData(overrides: Partial<SourceData> & { id: string; content: string }): SourceData {
  const now = new Date().toISOString();
  return {
    id: overrides.id,
    chunk_id: `chunk-${overrides.id}`,
    source_id: `src-${overrides.id}`,
    type: "generic" as SourceType,
    title: `file-${overrides.id}.txt`,
    content: overrides.content,
    tags: overrides.tags ?? [],
    path: `/fixtures/file-${overrides.id}.txt`,
    file_blake3: `blake3-${overrides.id}`,
    semantic_blake3: `sem-${overrides.id}`,
    chunk_index: 0,
    total_chunks: 1,
    embeddings: [],
    metadata: overrides.metadata ?? { kind: "generic", encoding: "utf-8" },
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

/** Seed a MockSourceRepository with the given content strings, returning an array of SourceData. */
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

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("SearchService", () => {
  // ── Semantic mode ──────────────────────────────────────────

  describe("semantic search", () => {
    test("routes to repo with semantic mode", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "the quick brown fox" },
        { content: "jumps over the lazy dog" },
      ]);

      let capturedQuery: SearchQuery | null = null;
      const originalSearch = repo.search.bind(repo);
      repo.search = async (q: SearchQuery) => {
        capturedQuery = q;
        return originalSearch(q);
      };

      const embedder = new MockEmbedder("sem-model", 64);
      const service = new SearchService(embedder, repo);

      const results = await service.search({
        text: "quick brown",
        mode: "semantic",
        top_k: 10,
      });

      expect(capturedQuery).not.toBeNull();
      expect(capturedQuery!.mode).toBe("semantic");
      expect(results.length).toBeGreaterThan(0);
    });

    test("calls embedder with query text", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [{ content: "anything" }]);

      let embeddedText = "";
      const embedder: Embedder = {
        model: "spy",
        dimensions: 4,
        embed: async (text: string) => {
          embeddedText = text;
          return { vector: [0, 0, 0, 0], model: "spy", dimensions: 4, tokens_in: 1 };
        },
      };

      const service = new SearchService(embedder, repo);
      await service.search({ text: "query-text", mode: "semantic", top_k: 10 });

      expect(embeddedText).toBe("query-text");
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

      const service = new SearchService(new MockEmbedder("k", 4), repo);
      await service.search({ text: "great", mode: "keyword", top_k: 10 });

      expect(capturedMode).toBe("keyword");
    });

    test("returns results scored by TF overlap", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "nodejs typescript express" },
        { content: "python django flask" },
        { content: "typescript react nodejs" },
      ]);

      const service = new SearchService(new MockEmbedder("k", 4), repo);
      const results = await service.search({
        text: "typescript",
        mode: "keyword",
        top_k: 10,
      });

      // docs containing "typescript" returned; doc with no match filtered out
      expect(results.length).toBe(2);
      for (const r of results) {
        expect(r.source.content).toMatch(/typescript/);
      }
    });
  });

  // ── AST mode ─────────────────────────────────────────────

  describe("ast search", () => {
    test("routes to repo with ast mode", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "some file content" },
      ]);

      let capturedMode = "";
      const originalSearch = repo.search.bind(repo);
      repo.search = async (q: SearchQuery) => {
        capturedMode = q.mode;
        return originalSearch(q);
      };

      const service = new SearchService(new MockEmbedder("k", 4), repo);
      await service.search({ text: "import:zod", mode: "ast", top_k: 10 });

      expect(capturedMode).toBe("ast");
    });

    test("returns results with ast match_type", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "import zod from 'zod'" },
      ]);

      const service = new SearchService(new MockEmbedder("k", 4), repo);
      const results = await service.search({ text: "zod", mode: "ast", top_k: 10 });

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

      const embedder: Embedder = {
        model: "hybrid-model",
        dimensions: 8,
        embed: async () => ({
          vector: [0, 0, 0, 0, 0, 0, 0, 0],
          model: "hybrid-model",
          dimensions: 8,
          tokens_in: 1,
        }),
      };

      const service = new SearchService(embedder, repo, { hybrid_weight: 0.7 });

      const results = await service.search({
        text: "quick brown",
        mode: "hybrid",
        top_k: 10,
      });

      expect(results.length).toBe(2); // doc with no match filtered out
      for (const r of results) {
        expect(r.match_type).toBe("hybrid");
        // score should be weighted combination
        expect(r.score).toBeGreaterThan(0);
      }
    });

    test("normalizes BM25 keyword scores before merging", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "aaaa bbbb cccc dddd" }, // score = 0 / 4 = 0 (no match)
        { content: "query word here" }, // score for "query": 1 / 4 = 0.25
        { content: "query query query query word" }, // score for "query": 1 / 5 = 0.2
      ]);

      const embedder: Embedder = {
        model: "m",
        dimensions: 2,
        embed: async () => ({
          vector: [0, 0],
          model: "m",
          dimensions: 2,
          tokens_in: 1,
        }),
      };

      const service = new SearchService(embedder, repo, { hybrid_weight: 0.5 });

      const results = await service.search({
        text: "query",
        mode: "hybrid",
        top_k: 10,
      });

      // Non-matching doc (score 0) filtered out; 2 relevant results remain
      expect(results.length).toBe(2);
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
      }
    });

    test("uses default hybrid_weight of 0.7", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "test document content here" },
      ]);

      const embedder: Embedder = {
        model: "m",
        dimensions: 2,
        embed: async () => ({
          vector: [0, 0],
          model: "m",
          dimensions: 2,
          tokens_in: 1,
        }),
      };

      const service = new SearchService(embedder, repo);
      const results = await service.search({
        text: "test",
        mode: "hybrid",
        top_k: 10,
      });

      expect(results.length).toBe(1);
      expect(results[0]!.match_type).toBe("hybrid");
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

      const service = new SearchService(new MockEmbedder("m", 4), repo);
      const results = await service.search({
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

      const service = new SearchService(new MockEmbedder("m", 4), repo);
      const results = await service.search({
        text: "stuff",
        mode: "keyword",
        top_k: 10,
        source_types: ["code"],
      });

      expect(results.length).toBe(1);
      expect(results[0]!.source.type).toBe("code");
    });
  });

  // ── Multi-model averaging ──────────────────────────────────

  describe("multi-model averaging", () => {
    test("averages model_scores for semantic results", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "target document" },
      ]);

      // Override search to return results with model_scores
      const originalSearch = repo.search.bind(repo);
      repo.search = async (q: SearchQuery) => {
        const base = await originalSearch(q);
        return base.map((r) => ({
          ...r,
          model_scores: { "model-a": 0.8, "model-b": 0.6 },
        }));
      };

      const service = new SearchService(
        new MockEmbedder("m", 4),
        repo,
      );

      const results = await service.search({
        text: "target",
        mode: "semantic",
        top_k: 10,
      });

      // Average of 0.8 and 0.6 = 0.7
      for (const r of results) {
        expect(r.score).toBe(0.7);
      }
    });
  });

  // ── Empty index ────────────────────────────────────────────

  describe("empty index", () => {
    test("returns empty array when index has no data", async () => {
      const repo = new MockSourceRepository();
      const service = new SearchService(new MockEmbedder("m", 4), repo);

      const results = await service.search({
        text: "anything",
        mode: "semantic",
        top_k: 10,
      });

      expect(results).toEqual([]);
    });
  });
});
