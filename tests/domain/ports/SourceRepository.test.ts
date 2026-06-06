import { describe, expect, test } from "bun:test";

import type { SourceRepository } from "../../../src/domain/ports/SourceRepository";

describe("SourceRepository interface", () => {
  test("all required methods are present on a mock implementation", () => {
    // Create a minimal mock that satisfies SourceRepository
    const mock: SourceRepository = {
      upsert: async () => {},
      upsertBatch: async () => {},
      getById: async () => null,
      getByPath: async () => [],
      delete: async () => {},
      deleteByPath: async () => {},
      search: async () => [],
      hasSemanticBlake3: async () => false,
      hasModelEmbedding: async () => false,
      getSourceIdsByHash: async () => [],
      getFileBlake3ByPath: async () => null,
      stats: async () => ({
        total_sources: 0,
        total_chunks: 0,
        total_files: 0,
        last_indexed: "2026-01-01T00:00:00.000Z",
      }),
      upsertFileIndex: async () => {},
      getFileIndex: async () => null,
      deleteFileIndex: async () => {},
      dropAll: async () => {},
    };

    // Verify every method exists and is a function
    expect(typeof mock.upsert).toBe("function");
    expect(typeof mock.upsertBatch).toBe("function");
    expect(typeof mock.getById).toBe("function");
    expect(typeof mock.getByPath).toBe("function");
    expect(typeof mock.delete).toBe("function");
    expect(typeof mock.deleteByPath).toBe("function");
    expect(typeof mock.search).toBe("function");
    expect(typeof mock.hasSemanticBlake3).toBe("function");
    expect(typeof mock.hasModelEmbedding).toBe("function");
    expect(typeof mock.getSourceIdsByHash).toBe("function");
    expect(typeof mock.getFileBlake3ByPath).toBe("function");
    expect(typeof mock.stats).toBe("function");
    expect(typeof mock.upsertFileIndex).toBe("function");
    expect(typeof mock.getFileIndex).toBe("function");
    expect(typeof mock.deleteFileIndex).toBe("function");
    expect(typeof mock.dropAll).toBe("function");
  });

  test("methods return Promise (async)", async () => {
    const mock: SourceRepository = {
      upsert: async () => {},
      upsertBatch: async () => {},
      getById: async () => null,
      getByPath: async () => [],
      delete: async () => {},
      deleteByPath: async () => {},
      search: async () => [],
      hasSemanticBlake3: async () => true,
      hasModelEmbedding: async () => false,
      getSourceIdsByHash: async () => ["id-1"],
      getFileBlake3ByPath: async () => "hash",
      stats: async () => ({
        total_sources: 1,
        total_chunks: 3,
        total_files: 1,
        last_indexed: "2026-01-01T00:00:00.000Z",
      }),
      upsertFileIndex: async () => {},
      getFileIndex: async () => null,
      deleteFileIndex: async () => {},
      dropAll: async () => {},
    };

    // All methods that return promises should resolve
    await expect(mock.upsert({} as never)).resolves.toBeUndefined();
    await expect(mock.upsertBatch([])).resolves.toBeUndefined();
    await expect(mock.getById("x")).resolves.toBeNull();
    await expect(mock.getByPath("/a.ts")).resolves.toEqual([]);
    await expect(mock.delete("x")).resolves.toBeUndefined();
    await expect(mock.deleteByPath("/a.ts")).resolves.toBeUndefined();
    await expect(mock.search({} as never)).resolves.toEqual([]);
    await expect(mock.hasSemanticBlake3("h")).resolves.toBe(true);
    await expect(mock.hasModelEmbedding("id")).resolves.toBe(false);
    await expect(mock.getSourceIdsByHash("h")).resolves.toEqual(["id-1"]);
    await expect(mock.getFileBlake3ByPath("/a.ts")).resolves.toBe("hash");
    await expect(mock.stats()).resolves.toEqual({
      total_sources: 1,
      total_chunks: 3,
      total_files: 1,
      last_indexed: "2026-01-01T00:00:00.000Z",
    });
    await expect(mock.upsertFileIndex({} as never)).resolves.toBeUndefined();
    await expect(mock.getFileIndex("/a.ts")).resolves.toBeNull();
    await expect(mock.deleteFileIndex("/a.ts")).resolves.toBeUndefined();
    await expect(mock.dropAll()).resolves.toBeUndefined();
  });

  test("interface has exactly the specified number of methods", () => {
    // Count interface members by checking mock keys
    const mock: SourceRepository = {
      upsert: async () => {},
      upsertBatch: async () => {},
      getById: async () => null,
      getByPath: async () => [],
      delete: async () => {},
      deleteByPath: async () => {},
      search: async () => [],
      hasSemanticBlake3: async () => false,
      hasModelEmbedding: async () => false,
      getSourceIdsByHash: async () => [],
      getFileBlake3ByPath: async () => null,
      stats: async () => ({
        total_sources: 0,
        total_chunks: 0,
        total_files: 0,
        last_indexed: "2026-01-01T00:00:00.000Z",
      }),
      upsertFileIndex: async () => {},
      getFileIndex: async () => null,
      deleteFileIndex: async () => {},
      dropAll: async () => {},
    };
    // All 16 methods
    expect(Object.keys(mock).length).toBe(16);
  });
});
