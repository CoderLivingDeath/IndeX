import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { FileFilter } from "../../../src/domain/ports/FileFilter";
import type { SourceParserRegistry } from "../../../src/domain/ports/SourceParserRegistry";
import type { SourceParser } from "../../../src/domain/ports/SourceParser";
import type { ParsedSource } from "../../../src/domain/types";
import { MockEmbedder } from "../../mocks/MockEmbedder";
import { MockEmbedderRegistry } from "../../mocks/MockEmbedderRegistry";
import { MockChunker } from "../../mocks/MockChunker";
import { MockHasher } from "../../mocks/MockHasher";
import { MockSourceRepository } from "../../mocks/MockSourceRepository";
import { IndexingService } from "../../../src/domain/services/IndexingService";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "indexing-test-"));
}

function createTestFile(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

function makeFilter(
  predicate: (path: string) => boolean,
  formats: string[] = [".ts", ".md", ".json"],
): FileFilter {
  return { formats, shouldInclude: predicate };
}

function simpleParser(type: "code" | "markdown"): SourceParser {
  const ext = type === "code" ? ".ts" : ".md";
  return {
    type,
    extensions: [ext],
    supportsFile: (p: string) => p.endsWith(ext),
    parse: async (path: string): Promise<ParsedSource> => ({
      type,
      path,
      content: `parsed ${type} content`,
      tags: type === "code" ? ["typescript"] : ["docs"],
      metadata:
        type === "code"
          ? { kind: "code", language: "typescript" }
          : { kind: "markdown" },
      file_blake3: `mock-${type}-hash`,
      last_parsed: new Date().toISOString(),
    }),
  };
}

function makeParserRegistry(
  ...parsers: SourceParser[]
): SourceParserRegistry {
  return {
    getParser: (path: string) =>
      parsers.find((p) => p.supportsFile(path)) ?? null,
    register: () => {},
  };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("IndexingService", () => {
  describe("basic indexing pipeline", () => {
    let tmpDir: string;
    let repo: MockSourceRepository;
    let service: IndexingService;

    beforeAll(() => {
      tmpDir = createTempDir();
      createTestFile(tmpDir, "main.ts", "const x = 1;");
      createTestFile(tmpDir, "README.md", "# Hello");

      const mockFilter = makeFilter(
        (p) => p.endsWith(".ts") || p.endsWith(".md"),
      );
      const mockRegistry = makeParserRegistry(
        simpleParser("code"),
        simpleParser("markdown"),
      );
      const mockChunker: import("../../../src/domain/systems/ChunkingSystem").Chunker = {
        type: "generic" as any,
        chunk: async (text: string) => [{
          content: "chunk content",
          core_content: text.includes("code") ? "core code unit" : "core md unit",
          chunk_index: 0,
          total_chunks: 1,
          strategy: "fixed",
          size_tokens: 10,
        }],
      };
      const mockEmbedder = new MockEmbedder("test-model", 128);
      const mockEmbRegistry = new MockEmbedderRegistry({
        code: mockEmbedder,
        markdown: mockEmbedder,
      });
      repo = new MockSourceRepository();
      const mockHasher = new MockHasher();

      service = new IndexingService(
        mockFilter,
        mockRegistry,
        mockChunker,
        mockEmbRegistry,
        repo,
        mockHasher,
      );
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("returns correct stats after indexing directory", async () => {
      const stats = await service.index(tmpDir);
      expect(stats.total_files).toBe(2);
      expect(stats.total_chunks).toBe(2);
    });

    test("stored SourceData has correct fields", async () => {
      const tsSources = await repo.getByPath(join(tmpDir, "main.ts"));
      expect(tsSources.length).toBe(1);
      const src = tsSources[0]!;
      expect(src.type).toBe("code");
      expect(src.content).toBe("chunk content");
      expect(src.embeddings.length).toBe(128);
      expect(typeof src.file_blake3).toBe("string");
      expect(src.file_blake3.length).toBeGreaterThan(0);
      expect(typeof src.semantic_blake3).toBe("string");
      expect(src.semantic_blake3.length).toBeGreaterThan(0);
      expect(typeof src.id).toBe("string");
      expect(typeof src.chunk_id).toBe("string");
      expect(typeof src.source_id).toBe("string");
    });
  });

  describe("exclude patterns", () => {
    test("files matching exclude pattern are skipped", async () => {
      const tmpDir = createTempDir();
      createTestFile(tmpDir, "app.ts", "keep");
      createTestFile(tmpDir, "app.test.ts", "skip");
      createTestFile(tmpDir, "config.json", '{}');

      const filter = makeFilter(
        (p) => !p.includes(".test.") && (p.endsWith(".ts") || p.endsWith(".json")),
      );

      const parser: SourceParser = {
        type: "code",
        extensions: [".ts", ".json"],
        supportsFile: () => true,
        parse: async (path: string): Promise<ParsedSource> => ({
          type: "code",
          path,
          content: "parsed",
          tags: [],
          metadata: { kind: "code", language: "typescript" },
          file_blake3: "mock-hash",
          last_parsed: new Date().toISOString(),
        }),
      };

      const service = new IndexingService(
        filter,
        makeParserRegistry(parser),
        { type: "generic" as any, chunk: (() => {
          let counter = 0;
          return async (_text: string) => [{
            content: "c",
            core_content: `cc-${counter++}`,
            chunk_index: 0,
            total_chunks: 1,
            strategy: "fixed",
            size_tokens: 5,
          }];
        })() } as any,
        new MockEmbedderRegistry({ code: new MockEmbedder("m", 8) }),
        new MockSourceRepository(),
        new MockHasher(),
      );

      const stats = await service.index(tmpDir);
      expect(stats.total_files).toBe(2); // app.ts + config.json, NOT app.test.ts

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("multi-model embedding", () => {
    test("different source types use their respective embedders", async () => {
      const tmpDir = createTempDir();
      createTestFile(tmpDir, "code.ts", "const a = 1;");
      createTestFile(tmpDir, "doc.md", "# Markdown");

      const codeEmbedder = new MockEmbedder("code-model", 64);
      const mdEmbedder = new MockEmbedder("md-model", 32);
      const repo = new MockSourceRepository();

      const service = new IndexingService(
        makeFilter((p) => p.endsWith(".ts") || p.endsWith(".md")),
        makeParserRegistry(simpleParser("code"), simpleParser("markdown")),
        { type: "generic" as any, chunk: async (text: string) => [{
          content: "x",
          core_content: text.includes("code") ? "semantic code unit" : "semantic md unit",
          chunk_index: 0,
          total_chunks: 1,
          strategy: "fixed",
          size_tokens: 5,
        }] } as any,
        new MockEmbedderRegistry({ code: codeEmbedder, markdown: mdEmbedder }),
        repo,
        new MockHasher(),
      );

      const stats = await service.index(tmpDir);
      expect(stats.total_files).toBe(2);

      // Each embedder should have been called for its respective source type
      // Verify by checking embedding dimensions via public repo methods
      const codeSources = await repo.getByPath(join(tmpDir, "code.ts"));
      const mdSources = await repo.getByPath(join(tmpDir, "doc.md"));

      // code-model has 64 dimensions
      for (const s of codeSources) {
        expect(s.embeddings.length).toBe(64);
      }
      // md-model has 32 dimensions
      for (const s of mdSources) {
        expect(s.embeddings.length).toBe(32);
      }

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("embedding reuse (ingest dedup)", () => {
    class CountingEmbedder extends MockEmbedder {
      batchCalls = 0;
      texts: string[] = [];

      override async embedBatch(input: string[]) {
        this.batchCalls++;
        this.texts.push(...input);
        return super.embedBatch(input);
      }
    }

    function makeService(
      repo: MockSourceRepository,
      embedder: CountingEmbedder,
    ): IndexingService {
      return new IndexingService(
        makeFilter((p) => p.endsWith(".ts")),
        makeParserRegistry(simpleParser("code")),
        {
          type: "generic" as any,
          chunk: async (text: string) => [{
            content: "duplicate chunk",
            core_content: text.includes("code") ? "shared core unit" : "other core unit",
            chunk_index: 0,
            total_chunks: 1,
            strategy: "fixed",
            size_tokens: 7,
          }],
        } as any,
        new MockEmbedderRegistry({ code: embedder }),
        repo,
        new MockHasher(),
      );
    }

    test("a fully duplicated file still keeps its own rows and path", async () => {
      const tmpDir = createTempDir();
      createTestFile(tmpDir, "a.ts", "same content");
      createTestFile(tmpDir, "b.ts", "same content");

      const repo = new MockSourceRepository();
      const stats = await makeService(repo, new CountingEmbedder("m", 8)).index(tmpDir);

      expect(stats.total_files).toBe(2);
      expect(stats.total_chunks).toBe(2);
      expect(stats.total_deduped_chunks).toBe(1);

      const paths = await repo.getAllPaths();
      expect(paths.sort()).toEqual([
        join(tmpDir, "a.ts"),
        join(tmpDir, "b.ts"),
      ].sort());
      expect((await repo.getByPath(join(tmpDir, "b.ts"))).length).toBe(1);

      const results = await repo.search({
        text: "duplicate",
        mode: "keyword",
        top_k: 10,
      });
      expect(results.some((r) => r.source.path === join(tmpDir, "b.ts"))).toBe(true);

      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("reuses a stored embedding across runs without dropping rows", async () => {
      const repo = new MockSourceRepository();
      const firstDir = createTempDir();
      createTestFile(firstDir, "a.ts", "same content");

      const firstStats = await makeService(repo, new CountingEmbedder("m", 8)).index(firstDir);
      expect(firstStats.total_deduped_chunks).toBe(0);

      const secondDir = createTempDir();
      createTestFile(secondDir, "b.ts", "same content");

      const secondStats = await makeService(repo, new CountingEmbedder("m", 8)).index(secondDir);
      expect(secondStats.total_deduped_chunks).toBe(1);
      // Stats describe this run; the repository still holds both files.
      expect(secondStats.total_chunks).toBe(1);
      expect(secondStats.total_files).toBe(1);
      expect(await repo.getAllPaths()).toHaveLength(2);
      expect((await repo.getByPath(join(secondDir, "b.ts"))).length).toBe(1);

      rmSync(firstDir, { recursive: true, force: true });
      rmSync(secondDir, { recursive: true, force: true });
    });

    test("re-indexing the same directory does not duplicate rows", async () => {
      const tmpDir = createTempDir();
      createTestFile(tmpDir, "a.ts", "stable content");

      const repo = new MockSourceRepository();
      const service = makeService(repo, new CountingEmbedder("m", 8));

      const first = await service.index(tmpDir);
      expect(first.total_chunks).toBe(1);

      const second = await service.index(tmpDir);
      expect(second.total_chunks).toBe(1);
      expect((await repo.getByPath(join(tmpDir, "a.ts"))).length).toBe(1);

      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("does not embed identical content twice within one run", async () => {
      const tmpDir = createTempDir();
      createTestFile(tmpDir, "a.ts", "same content");
      createTestFile(tmpDir, "b.ts", "same content");

      const embedder = new CountingEmbedder("m", 8);
      const repo = new MockSourceRepository();
      await makeService(repo, embedder).index(tmpDir);

      expect(embedder.batchCalls).toBe(1);
      expect(embedder.texts).toHaveLength(1);

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
