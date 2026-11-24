import { describe, it, expect, beforeEach } from "bun:test";
import * as lancedb from "@lancedb/lancedb";

import type { SourceData, SearchQuery, IndexStats } from "../../../src/domain/types";
import type { FileIndex } from "../../../src/domain/ast";
import type { SourceRepository } from "../../../src/domain/ports/SourceRepository";
import { LanceDbSourceRepository } from "../../../src/infrastructure/lancedb/LanceDbSourceRepository";
import type { Import, Export, SymbolDetail, Relationship } from "../../../src/domain/ast";

/**
 * Build a minimal SourceData with sensible defaults for testing.
 */
function makeSourceData(overrides: Partial<SourceData> & { id: string }): SourceData {
  return {
    chunk_id: overrides.chunk_id ?? `chunk-${overrides.id}`,
    source_id: overrides.source_id ?? `src-${overrides.id}`,
    type: overrides.type ?? "code",
    title: overrides.title ?? `Title ${overrides.id}`,
    content: overrides.content ?? `Content for ${overrides.id}`,
    tags: overrides.tags ?? [],
    path: overrides.path ?? `/test/file-${overrides.id}.ts`,
    file_blake3: overrides.file_blake3 ?? `blake3-file-${overrides.id}`,
    semantic_blake3: overrides.semantic_blake3 ?? `blake3-sem-${overrides.id}`,
    chunk_index: overrides.chunk_index ?? 0,
    total_chunks: overrides.total_chunks ?? 1,
    embeddings: overrides.embeddings ?? [],
    metadata: overrides.metadata ?? { kind: "code", language: "typescript" },
    created_at: overrides.created_at ?? "2026-06-01T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Build a minimal FileIndex for testing.
 */
function makeFileIndex(overrides: Partial<FileIndex> & { path: string }): FileIndex {
  return {
    file_blake3: overrides.file_blake3 ?? "blake3-file-idx",
    language: overrides.language ?? "typescript",
    imports: overrides.imports ?? [],
    exports: overrides.exports ?? [],
    symbols: overrides.symbols ?? [],
    relationships: overrides.relationships ?? [],
    last_parsed: overrides.last_parsed ?? "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("LanceDbSourceRepository", () => {
  let repo: SourceRepository;

  beforeEach(async () => {
    // Fresh in-memory LanceDB for each test
    repo = new LanceDbSourceRepository("memory://");
    await (repo as LanceDbSourceRepository).connect();
  });

  // ── Sources table CRUD ──────────────────────────────────────

  describe("sources table CRUD", () => {
    it("upsert → getById returns the data", async () => {
      const data = makeSourceData({ id: "s1" });
      await repo.upsert(data);

      const result = await repo.getById("s1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("s1");
      expect(result!.content).toBe("Content for s1");
    });

    it("upsert → getByPath returns all chunks for that path", async () => {
      const chunk1 = makeSourceData({ id: "c1", path: "/shared.ts", chunk_index: 0, total_chunks: 2 });
      const chunk2 = makeSourceData({ id: "c2", path: "/shared.ts", chunk_index: 1, total_chunks: 2 });

      await repo.upsert(chunk1);
      await repo.upsert(chunk2);

      const results = await repo.getByPath("/shared.ts");
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.id).sort()).toEqual(["c1", "c2"]);
    });

    it("upsert multiple chunks → getByPath returns all", async () => {
      const data1 = makeSourceData({ id: "a1", path: "/multi.ts", chunk_index: 0 });
      const data2 = makeSourceData({ id: "a2", path: "/multi.ts", chunk_index: 1 });
      const data3 = makeSourceData({ id: "a3", path: "/multi.ts", chunk_index: 2 });

      await repo.upsert(data1);
      await repo.upsert(data2);
      await repo.upsert(data3);

      const results = await repo.getByPath("/multi.ts");
      expect(results).toHaveLength(3);
    });

    it("upsertBatch → getById for each", async () => {
      const allData = [
        makeSourceData({ id: "b1", path: "/batch.ts" }),
        makeSourceData({ id: "b2", path: "/batch.ts" }),
        makeSourceData({ id: "b3", path: "/other.ts" }),
      ];

      await repo.upsertBatch(allData);

      const r1 = await repo.getById("b1");
      const r2 = await repo.getById("b2");
      const r3 = await repo.getById("b3");

      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      expect(r3).not.toBeNull();
    });

    it("delete → getById returns null after", async () => {
      const data = makeSourceData({ id: "d1" });
      await repo.upsert(data);

      const before = await repo.getById("d1");
      expect(before).not.toBeNull();

      await repo.delete("d1");

      const after = await repo.getById("d1");
      expect(after).toBeNull();
    });

    it("deleteByPath → getByPath returns [] after", async () => {
      await repo.upsert(makeSourceData({ id: "e1", path: "/delete-path.ts" }));
      await repo.upsert(makeSourceData({ id: "e2", path: "/delete-path.ts" }));
      await repo.upsert(makeSourceData({ id: "e3", path: "/keep.ts" }));

      await repo.deleteByPath("/delete-path.ts");

      const removed = await repo.getByPath("/delete-path.ts");
      expect(removed).toHaveLength(0);

      // Other paths remain
      const kept = await repo.getByPath("/keep.ts");
      expect(kept).toHaveLength(1);
    });
  });

  // ── Multi-column embeddings ────────────────────────────────

  describe("embeddings", () => {
    it("hasModelEmbedding returns true for entries with embeddings", async () => {
      const withEmb = makeSourceData({ id: "emb1", embeddings: [0.1, 0.2, 0.3] });
      const withoutEmb = makeSourceData({ id: "emb2", embeddings: [] });

      await repo.upsert(withEmb);
      await repo.upsert(withoutEmb);

      expect(await repo.hasModelEmbedding("emb1")).toBe(true);
      expect(await repo.hasModelEmbedding("emb2")).toBe(false);
    });

    it("hasSemanticBlake3 returns true when hash exists", async () => {
      const data = makeSourceData({ id: "h1", semantic_blake3: "my-unique-hash-abc" });
      await repo.upsert(data);

      expect(await repo.hasSemanticBlake3("my-unique-hash-abc")).toBe(true);
      expect(await repo.hasSemanticBlake3("nonexistent-hash")).toBe(false);
    });

    it("hasSemanticBlake3 returns false for missing hash when table has data", async () => {
      await repo.upsert(makeSourceData({ id: "h2", semantic_blake3: "hash-1" }));
      await repo.upsert(makeSourceData({ id: "h3", semantic_blake3: "hash-2" }));

      expect(await repo.hasSemanticBlake3("hash-1")).toBe(true);
      expect(await repo.hasSemanticBlake3("hash-3")).toBe(false);
    });
  });

  // ── File Index CRUD ────────────────────────────────────────

  describe("file_index CRUD", () => {
    it("upsertFileIndex → getFileIndex returns it", async () => {
      const imports: Import[] = [{ source: "fs", specifiers: ["readFile"], kind: "named" }];
      const exports: Export[] = [{ name: "myFunc", kind: "named" }];
      const symbols: SymbolDetail[] = [
        { kind: "function", name: "myFunc", signature: "myFunc(): void", startPosition: { line: 1, column: 0 }, endPosition: { line: 5, column: 1 } },
      ];
      const relationships: Relationship[] = [{ type: "imports", source: "index.ts", target: "fs" }];

      const idx = makeFileIndex({
        path: "/index.ts",
        file_blake3: "abc123",
        language: "typescript",
        imports,
        exports,
        symbols,
        relationships,
      });

      await repo.upsertFileIndex(idx);

      const result = await repo.getFileIndex("/index.ts");
      expect(result).not.toBeNull();
      expect(result!.path).toBe("/index.ts");
      expect(result!.file_blake3).toBe("abc123");
      expect(result!.language).toBe("typescript");
      expect(result!.imports).toEqual(imports);
      expect(result!.exports).toEqual(exports);
      expect(result!.symbols).toEqual(symbols);
      expect(result!.relationships).toEqual(relationships);
    });

    it("getFileIndex returns null for missing path", async () => {
      const result = await repo.getFileIndex("/nonexistent.ts");
      expect(result).toBeNull();
    });

    it("deleteFileIndex → getFileIndex returns null", async () => {
      const idx = makeFileIndex({ path: "/temp.ts" });
      await repo.upsertFileIndex(idx);

      const before = await repo.getFileIndex("/temp.ts");
      expect(before).not.toBeNull();

      await repo.deleteFileIndex("/temp.ts");

      const after = await repo.getFileIndex("/temp.ts");
      expect(after).toBeNull();
    });

    it("getFileBlake3ByPath returns correct hash", async () => {
      await repo.upsert(makeSourceData({ id: "f1", path: "/file-a.ts", file_blake3: "hash-a" }));
      await repo.upsert(makeSourceData({ id: "f2", path: "/file-b.ts", file_blake3: "hash-b" }));

      expect(await repo.getFileBlake3ByPath("/file-a.ts")).toBe("hash-a");
      expect(await repo.getFileBlake3ByPath("/file-b.ts")).toBe("hash-b");
      expect(await repo.getFileBlake3ByPath("/missing.ts")).toBeNull();
    });
  });

  // ── Search ─────────────────────────────────────────────────

  describe("search", () => {
    it("performs keyword search returning relevant results", async () => {
      await repo.upsert(makeSourceData({ id: "q1", content: "The quick brown fox", path: "/fox.ts" }));
      await repo.upsert(makeSourceData({ id: "q2", content: "Jumping over the lazy dog", path: "/dog.ts" }));
      await repo.upsert(makeSourceData({ id: "q3", content: "Foxes are quick animals", path: "/foxes.ts" }));

      const query: SearchQuery = {
        text: "fox",
        mode: "keyword",
        top_k: 10,
      };

      const results = await repo.search(query);
      // At least the two entries with "fox" should be returned
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("search respects source_types filter", async () => {
      await repo.upsert(makeSourceData({ id: "t1", content: "code content", type: "code", path: "/a.ts" }));
      await repo.upsert(makeSourceData({ id: "t2", content: "markdown doc", type: "markdown", path: "/a.md" }));

      const query: SearchQuery = {
        text: "content",
        mode: "keyword",
        top_k: 10,
        source_types: ["code"],
      };

      const results = await repo.search(query);
      expect(results.every((r) => r.source.type === "code")).toBe(true);
    });

    it("search respects top_k limit", async () => {
      for (let i = 0; i < 10; i++) {
        await repo.upsert(makeSourceData({ id: `topk-${i}`, content: "matching content", path: `/file-${i}.ts` }));
      }

      const query: SearchQuery = {
        text: "matching",
        mode: "keyword",
        top_k: 3,
      };

      const results = await repo.search(query);
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  // ── DB Metadata ────────────────────────────────────────────

  describe("db_meta", () => {
    it("setDbMeta → getDbMeta returns the value", async () => {
      await repo.setDbMeta("schema_version", 2);
      const val = await repo.getDbMeta("schema_version");
      expect(val).toBe(2);
    });

    it("getDbMeta returns null for unset key", async () => {
      const val = await repo.getDbMeta("nonexistent_key");
      expect(val).toBeNull();
    });

    it("setDbMeta overwrites existing value", async () => {
      await repo.setDbMeta("theme", "dark");
      await repo.setDbMeta("theme", "light");
      const val = await repo.getDbMeta("theme");
      expect(val).toBe("light");
    });

    it("getAllDbMeta returns all key-value pairs", async () => {
      await repo.setDbMeta("key1", "value1");
      await repo.setDbMeta("key2", 42);
      const all = await repo.getAllDbMeta();
      expect(all).toHaveProperty("key1", "value1");
      expect(all).toHaveProperty("key2", 42);
    });

    it("getAllDbMeta returns empty object when no metadata set", async () => {
      const all = await repo.getAllDbMeta();
      expect(all).toEqual({});
    });
  });

  // ── Cleanup ────────────────────────────────────────────────

  describe("cleanup", () => {
    it("dropAll clears all data", async () => {
      await repo.upsert(makeSourceData({ id: "clr1", path: "/clear.ts" }));
      await repo.upsertFileIndex(makeFileIndex({ path: "/clear.idx.ts" }));
      await repo.setDbMeta("some_key", "some_value");

      expect(await repo.getById("clr1")).not.toBeNull();
      expect(await repo.getFileIndex("/clear.idx.ts")).not.toBeNull();
      expect(await repo.getDbMeta("some_key")).toBe("some_value");

      await repo.dropAll();

      expect(await repo.getById("clr1")).toBeNull();
      expect(await repo.getFileIndex("/clear.idx.ts")).toBeNull();
      expect(await repo.getDbMeta("some_key")).toBeNull();
    });
  });

  // ── Stats ──────────────────────────────────────────────────

  describe("stats", () => {
    it("stats returns correct counts", async () => {
      // 2 files, 3 chunks total
      await repo.upsert(makeSourceData({ id: "st1", path: "/file1.ts", chunk_index: 0, total_chunks: 2 }));
      await repo.upsert(makeSourceData({ id: "st2", path: "/file1.ts", chunk_index: 1, total_chunks: 2 }));
      await repo.upsert(makeSourceData({ id: "st3", path: "/file2.ts", chunk_index: 0, total_chunks: 1 }));

      const s = await repo.stats();
      expect(s.total_sources).toBeGreaterThan(0);
      expect(s.total_chunks).toBe(3);
      expect(s.total_files).toBeGreaterThan(0);
      expect(s.last_indexed).toBeTruthy();
    });
  });

  // ── Additional utility methods ─────────────────────────────

  describe("getSourceIdsByHash", () => {
    it("returns array of source_ids for matching semantic_blake3", async () => {
      await repo.upsert(makeSourceData({ id: "sid1", source_id: "src-a", semantic_blake3: "hash-x" }));
      await repo.upsert(makeSourceData({ id: "sid2", source_id: "src-b", semantic_blake3: "hash-y" }));
      await repo.upsert(makeSourceData({ id: "sid3", source_id: "src-a", semantic_blake3: "hash-x" }));

      const ids = await repo.getSourceIdsByHash("hash-x");
      expect(ids.sort()).toEqual(["src-a", "src-a"]);
    });

    it("returns empty array for nonexistent hash", async () => {
      const ids = await repo.getSourceIdsByHash("nope");
      expect(ids).toEqual([]);
    });
  });

  // ── Vector search contract ─────────────────────────────────

  describe("vector search", () => {
    it("uses query.vector and scores identical vectors near 1", async () => {
      await repo.upsert(makeSourceData({
        id: "v1",
        path: "/alpha.ts",
        embeddings: [1, 0, 0],
      }));
      await repo.upsert(makeSourceData({
        id: "v2",
        path: "/beta.ts",
        embeddings: [0, 1, 0],
      }));

      const results = await repo.search({
        text: "anything",
        mode: "semantic",
        top_k: 10,
        vector: [1, 0, 0],
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.source.path).toBe("/alpha.ts");
      expect(results[0]!.score).toBeGreaterThan(0.9);
      expect(results[0]!.score).toBeLessThanOrEqual(1);
    });

    it("returns empty results for semantic mode without a vector", async () => {
      await repo.upsert(makeSourceData({ id: "v3", content: "alpha content", embeddings: [1, 0, 0] }));

      const results = await repo.search({ text: "alpha", mode: "semantic", top_k: 10 });
      expect(results).toEqual([]);
    });

    it("returns empty results for hybrid mode without a vector", async () => {
      await repo.upsert(makeSourceData({ id: "v4", content: "alpha content", embeddings: [1, 0, 0] }));

      const results = await repo.search({ text: "alpha", mode: "hybrid", top_k: 10 });
      expect(results).toEqual([]);
    });

    it("filters vector results by tags", async () => {
      await repo.upsert(makeSourceData({
        id: "tag1",
        path: "/devops.ts",
        content: "deploy",
        tags: ["devops"],
        embeddings: [1, 0, 0],
      }));
      await repo.upsert(makeSourceData({
        id: "tag2",
        path: "/frontend.ts",
        content: "deploy",
        tags: ["frontend"],
        embeddings: [1, 0, 0],
      }));

      const results = await repo.search({
        text: "deploy",
        mode: "semantic",
        top_k: 10,
        vector: [1, 0, 0],
        tags: ["devops"],
      });

      expect(results.length).toBe(1);
      expect(results[0]!.source.tags).toContain("devops");
    });
  });

  describe("getEmbeddingBySemanticHash", () => {
    it("returns the stored vector for a duplicate hash", async () => {
      await repo.upsert(makeSourceData({
        id: "dup1",
        semantic_blake3: "shared-hash",
        embeddings: [0.25, 0.5, 0.75],
      }));

      const embedding = await repo.getEmbeddingBySemanticHash("shared-hash");
      expect(embedding).toEqual([0.25, 0.5, 0.75]);
    });

    it("returns null for a missing hash", async () => {
      await repo.upsert(makeSourceData({ id: "dup2", semantic_blake3: "other" }));
      expect(await repo.getEmbeddingBySemanticHash("nope")).toBeNull();
    });

    it("returns null when the matching row has no embedding", async () => {
      await repo.upsert(makeSourceData({
        id: "dup3",
        semantic_blake3: "empty-emb",
        embeddings: [],
      }));
      expect(await repo.getEmbeddingBySemanticHash("empty-emb")).toBeNull();
    });

    it("returns null when the table does not exist", async () => {
      const emptyRepo = new LanceDbSourceRepository("memory://");
      expect(await emptyRepo.getEmbeddingBySemanticHash("anything")).toBeNull();
    });
  });
});
