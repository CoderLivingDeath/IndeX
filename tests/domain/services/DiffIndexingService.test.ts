import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { FileFilter } from "../../../src/domain/ports/FileFilter";
import type { SourceParserRegistry } from "../../../src/domain/ports/SourceParserRegistry";
import type { SourceParser } from "../../../src/domain/ports/SourceParser";
import type { ParsedSource, SourceData, SourceType } from "../../../src/domain/types";
import type { FileIndex } from "../../../src/domain/ast";
import { MockEmbedder } from "../../mocks/MockEmbedder";
import { MockEmbedderRegistry } from "../../mocks/MockEmbedderRegistry";
import { MockChunker } from "../../mocks/MockChunker";
import { MockHasher } from "../../mocks/MockHasher";
import { MockSourceRepository } from "../../mocks/MockSourceRepository";
import { DiffIndexingService } from "../../../src/domain/services/DiffIndexingService";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "diff-test-"));
}

function createTestFile(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

function makeFilter(
  predicate: (path: string) => boolean,
): FileFilter {
  return { formats: [".ts"], shouldInclude: predicate };
}

function makeParser(
  type: SourceType,
  ext: string,
  fileIndex?: FileIndex,
): SourceParser {
  return {
    type,
    extensions: [ext],
    supportsFile: (p: string) => p.endsWith(ext),
    parse: async (path: string): Promise<ParsedSource> => ({
      type,
      path,
      content: `parsed ${type} content`,
      tags: [],
      metadata:
        type === "code"
          ? { kind: "code", language: "typescript" }
          : { kind: "generic", encoding: "utf-8" },
      file_blake3: `mock-${type}-hash`,
      last_parsed: new Date().toISOString(),
      ...(fileIndex ? { fileIndex } : {}),
    }),
  };
}

function makeParserRegistry(...parsers: SourceParser[]): SourceParserRegistry {
  return {
    getParser: (path: string) =>
      parsers.find((p) => p.supportsFile(path)) ?? null,
    register: () => {},
  };
}

/** Create a minimal SourceData for seeding the mock repo. */
function seedSourceData(
  id: string,
  path: string,
  fileHash: string,
  semanticHash: string,
): SourceData {
  const now = new Date().toISOString();
  return {
    id: `${id}-chunk-1`,
    chunk_id: `${id}-chunk-1`,
    source_id: `src-${id}`,
    type: "code",
    title: path,
    content: `old content for ${id}`,
    tags: [],
    path,
    file_blake3: fileHash,
    semantic_blake3: semanticHash,
    chunk_index: 0,
    total_chunks: 1,
    embeddings: [],
    metadata: { kind: "code", language: "typescript" },
    created_at: now,
    updated_at: now,
  };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("DiffIndexingService", () => {
  // ── Unchanged file skip ─────────────────────────────────────

  describe("unchanged file skip", () => {
    test("skips file when file_blake3 matches stored hash", async () => {
      const tmpDir = createTempDir();
      const filePath = createTestFile(tmpDir, "a.ts", "stable content");

      const repo = new MockSourceRepository();
      const hasher = new MockHasher();
      const fileHash = await hasher.hash("stable content");

      // Seed repo with old SourceData that has the same hash as current content
      await repo.upsert(
        seedSourceData("a", filePath, fileHash, "sem-hash-old"),
      );

      const service = new DiffIndexingService(
        hasher,
        makeParserRegistry(makeParser("code", ".ts")),
        new MockChunker([
          {
            content: "x",
            core_content: "y",
            chunk_index: 0,
            total_chunks: 1,
            strategy: "fixed",
            size_tokens: 5,
          },
        ]),
        new MockEmbedderRegistry({ code: new MockEmbedder("m", 8) }),
        repo,
        makeFilter((p) => p.endsWith(".ts")),
      );

      const result = await service.diffIndex(tmpDir);
      expect(result.indexed).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.errors).toBe(0);

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  // ── Changed file re-process ────────────────────────────────

  describe("changed file re-process", () => {
    test("re-parses, re-chunks, re-embeds when file_blake3 differs", async () => {
      const tmpDir = createTempDir();
      const filePath = createTestFile(tmpDir, "a.ts", "new content");

      const repo = new MockSourceRepository();
      const hasher = new MockHasher();

      // Seed repo with old hash (different from current content)
      await repo.upsert(
        seedSourceData("a", filePath, "old-file-hash", "old-sem-hash"),
      );

      const service = new DiffIndexingService(
        hasher,
        makeParserRegistry(makeParser("code", ".ts")),
        new MockChunker([
          {
            content: "new chunk",
            core_content: "new core",
            chunk_index: 0,
            total_chunks: 1,
            strategy: "fixed",
            size_tokens: 5,
          },
        ]),
        new MockEmbedderRegistry({ code: new MockEmbedder("m", 8) }),
        repo,
        makeFilter((p) => p.endsWith(".ts")),
      );

      const result = await service.diffIndex(tmpDir);
      expect(result.indexed).toBe(1);
      expect(result.skipped).toBe(0);

      // Verify old chunks were removed and new ones exist
      const updatedSources = await repo.getByPath(filePath);
      expect(updatedSources.length).toBe(1);
      expect(updatedSources[0]!.content).toBe("new chunk");

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  // ── Cross-file semantic dedup ──────────────────────────────

  describe("cross-file semantic dedup", () => {
    test("shared semantic_blake3 preserved when other file still references it", async () => {
      const tmpDir = createTempDir();
      const sharedHash = "shared-semantic-hash-123";

      // File A will change; File B is not in the scanned dir (only in repo)
      const fileAPath = createTestFile(tmpDir, "a.ts", "changed content for A");

      const repo = new MockSourceRepository();

      // File A's old data — shares semantic hash with File B
      await repo.upsert(
        seedSourceData("a", fileAPath, "old-file-hash-A", sharedHash),
      );
      // File B (virtual, not in temp dir) — shares the same semantic hash
      await repo.upsert(
        seedSourceData("b", "/virtual/b.ts", "file-b-hash", sharedHash),
      );

      // Verify shared hash exists before
      expect(await repo.hasSemanticBlake3(sharedHash)).toBe(true);

      const service = new DiffIndexingService(
        new MockHasher(),
        makeParserRegistry(makeParser("code", ".ts")),
        new MockChunker([
          {
            content: "new chunk for A",
            core_content: "new core for A",
            chunk_index: 0,
            total_chunks: 1,
            strategy: "fixed",
            size_tokens: 5,
          },
        ]),
        new MockEmbedderRegistry({ code: new MockEmbedder("m", 8) }),
        repo,
        makeFilter((p) => p.endsWith(".ts")),
      );

      const result = await service.diffIndex(tmpDir);
      expect(result.indexed).toBe(1);
      expect(result.skipped).toBe(0);

      // Shared hash should still exist because File B references it
      const stillExists = await repo.hasSemanticBlake3(sharedHash);
      expect(stillExists).toBe(true);

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  // ── FileIndex rebuild ──────────────────────────────────────

  describe("FileIndex rebuild", () => {
    test("FileIndex is updated when file content changes", async () => {
      const tmpDir = createTempDir();
      const filePath = createTestFile(tmpDir, "a.ts", "modified content");

      const repo = new MockSourceRepository();
      const hasher = new MockHasher();

      // Seed old data
      await repo.upsert(
        seedSourceData("a", filePath, "old-hash", "old-sem"),
      );

      // Seed old FileIndex
      const oldFileIndex: FileIndex = {
        path: filePath,
        file_blake3: "old-hash",
        language: "typescript",
        imports: [{ source: "old-dep", specifiers: ["old"], kind: "named" }],
        exports: [],
        symbols: [],
        relationships: [],
        last_parsed: "2026-01-01T00:00:00.000Z",
      };
      await repo.upsertFileIndex(oldFileIndex);

      // Parser returns new FileIndex
      const newFileIndex: FileIndex = {
        path: filePath,
        file_blake3: "new-hash",
        language: "typescript",
        imports: [{ source: "new-dep", specifiers: ["new"], kind: "named" }],
        exports: [],
        symbols: [],
        relationships: [],
        last_parsed: "2026-06-01T00:00:00.000Z",
      };

      const service = new DiffIndexingService(
        hasher,
        makeParserRegistry(makeParser("code", ".ts", newFileIndex)),
        new MockChunker([
          {
            content: "c",
            core_content: "cc",
            chunk_index: 0,
            total_chunks: 1,
            strategy: "fixed",
            size_tokens: 5,
          },
        ]),
        new MockEmbedderRegistry({ code: new MockEmbedder("m", 8) }),
        repo,
        makeFilter((p) => p.endsWith(".ts")),
      );

      const result = await service.diffIndex(tmpDir);
      expect(result.indexed).toBe(1);

      // Verify FileIndex was updated
      const updatedFileIndex = await repo.getFileIndex(filePath);
      expect(updatedFileIndex).not.toBeNull();
      expect(updatedFileIndex!.file_blake3).toBe("new-hash");
      expect(updatedFileIndex!.imports[0]!.source).toBe("new-dep");

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  // ── New file ────────────────────────────────────────────────

  describe("new file", () => {
    test("processes new file not present in the index", async () => {
      const tmpDir = createTempDir();
      const filePath = createTestFile(tmpDir, "a.ts", "brand new file");

      const repo = new MockSourceRepository();
      // No seed data — repo is empty for this file

      const service = new DiffIndexingService(
        new MockHasher(),
        makeParserRegistry(makeParser("code", ".ts")),
        new MockChunker([
          {
            content: "new chunk content",
            core_content: "new core",
            chunk_index: 0,
            total_chunks: 1,
            strategy: "fixed",
            size_tokens: 5,
          },
        ]),
        new MockEmbedderRegistry({ code: new MockEmbedder("m", 8) }),
        repo,
        makeFilter((p) => p.endsWith(".ts")),
      );

      const result = await service.diffIndex(tmpDir);
      expect(result.indexed).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);

      // Verify data stored
      const sources = await repo.getByPath(filePath);
      expect(sources.length).toBe(1);
      expect(sources[0]!.content).toBe("new chunk content");

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  // ── Embedding reuse ────────────────────────────────────────

  describe("embedding reuse", () => {
    test("reuses an existing vector for identical content", async () => {
      const tmpDir = createTempDir();
      const filePath = createTestFile(tmpDir, "a.ts", "changed content");

      const hasher = new MockHasher();
      const sharedHash = await hasher.hash("shared core unit");

      const repo = new MockSourceRepository();
      const other = seedSourceData("b", "/virtual/b.ts", "file-b-hash", sharedHash);
      other.embeddings = [1, 2, 3, 4, 5, 6, 7, 8];
      await repo.upsert(other);

      let embedCalls = 0;
      const embedder = new MockEmbedder("m", 8);
      embedder.embed = async (text: string) => {
        embedCalls++;
        return {
          vector: [9, 9, 9, 9, 9, 9, 9, 9],
          model: "m",
          dimensions: 8,
          tokens_in: text.length,
        };
      };

      const service = new DiffIndexingService(
        hasher,
        makeParserRegistry(makeParser("code", ".ts")),
        new MockChunker([
          {
            content: "new chunk content",
            core_content: "shared core unit",
            chunk_index: 0,
            total_chunks: 1,
            strategy: "fixed",
            size_tokens: 5,
          },
        ]),
        new MockEmbedderRegistry({ code: embedder }),
        repo,
        makeFilter((p) => p.endsWith(".ts")),
      );

      const result = await service.diffIndex(tmpDir);
      expect(result.indexed).toBe(1);

      const sources = await repo.getByPath(filePath);
      expect(sources.length).toBe(1);
      expect(sources[0]!.embeddings).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(embedCalls).toBe(0);

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
