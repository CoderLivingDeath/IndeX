// ---------------------------------------------------------------------------
// SearchUseCase — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { SearchSystems } from "../../src/application/di/Systems";
import type { ContextPacker } from "../../src/domain/systems/ContextPackagingSystem";
import type { SourceData } from "../../src/domain/types";
import { MockEmbedder } from "../mocks/MockEmbedder";
import { MockSourceRepository } from "../mocks/MockSourceRepository";
import { SearchUseCase } from "../../src/application/SearchUseCase";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "search-usecase-test-"));
}

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

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("SearchUseCase", () => {
  describe("execute", () => {
    let repo: MockSourceRepository;
    let useCase: SearchUseCase;

    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    const mockPacker: ContextPacker = {
      pack: async (results) => ({
        markdown: results.map((r) => r.source.content).join("\n"),
        chunks_used: results.length,
        total_tokens: 100,
        truncated: false,
        source_notes: [],
      }),
    };

    beforeAll(async () => {
      repo = new MockSourceRepository();
      // Seed some test data
      await repo.upsertBatch([
        makeSourceData("The quick brown fox jumps over the lazy dog", {
          path: "/test/animals.md",
          type: "markdown",
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
          type: "markdown",
          tags: ["ai", "ml"],
        }),
      ]);

      const mockEmbedder = new MockEmbedder("test-model", 128);

      const systems: SearchSystems = {
        embedder: mockEmbedder,
        repo,
        packer: mockPacker,
        logger: mockLogger,
      };

      useCase = new SearchUseCase(systems);
    });

    // ── test 1: hybrid mode ──────────────────────────────────────
    test('execute("fox", { mode: "hybrid" }) returns search results', async () => {
      const results = await useCase.execute("fox", { mode: "hybrid" });
      expect(results.length).toBeGreaterThan(0);
      // The result should be relevant to "fox"
      expect(results.some((r) => r.source.content.includes("fox"))).toBe(true);
    });

    // ── test 2: semantic mode ────────────────────────────────────
    test('execute("programming", { mode: "semantic" }) works', async () => {
      const results = await useCase.execute("programming", {
        mode: "semantic",
        top_k: 5,
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    // ── test 3: keyword mode ─────────────────────────────────────
    test('execute("language", { mode: "keyword" }) works', async () => {
      const results = await useCase.execute("language", { mode: "keyword" });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    // ── test 4: mode switching ───────────────────────────────────
    test("mode switching produces results with correct match_type", async () => {
      const semantic = await useCase.execute("data", { mode: "semantic" });
      for (const r of semantic) {
        expect(r.match_type).toBe("semantic");
      }

      const keyword = await useCase.execute("data", { mode: "keyword" });
      for (const r of keyword) {
        expect(r.match_type).toBe("keyword");
      }

      const hybrid = await useCase.execute("data", { mode: "hybrid" });
      for (const r of hybrid) {
        expect(r.match_type).toBe("hybrid");
      }
    });

    // ── test 5: empty query handling ─────────────────────────────
    test("empty query returns empty results", async () => {
      const results = await useCase.execute("", { mode: "hybrid" });
      expect(results).toHaveLength(0);
    });
  });
});
