// ---------------------------------------------------------------------------
// IndexUseCase — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { FileFilter } from "../../src/domain/ports/FileFilter";
import type { SourceParserRegistry } from "../../src/domain/ports/SourceParserRegistry";
import type { SourceParser } from "../../src/domain/ports/SourceParser";
import type { ParsedSource } from "../../src/domain/types";
import type { IndexSystems } from "../../src/application/di/Systems";
import { MockEmbedder } from "../mocks/MockEmbedder";
import { MockEmbedderRegistry } from "../mocks/MockEmbedderRegistry";
import { MockChunker } from "../mocks/MockChunker";
import { MockHasher } from "../mocks/MockHasher";
import { MockSourceRepository } from "../mocks/MockSourceRepository";
import { IndexUseCase } from "../../src/application/IndexUseCase";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "index-usecase-test-"));
}

function createTestFile(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("IndexUseCase", () => {
  describe("execute — full pipeline", () => {
    let tmpDir: string;
    let repo: MockSourceRepository;
    let useCase: IndexUseCase;
    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    beforeAll(() => {
      tmpDir = createTempDir();
      createTestFile(tmpDir, "main.ts", "const x = 1;");
      createTestFile(tmpDir, "README.md", "# Hello World");

      // --- Mock FileFilter ---
      const mockFilter: FileFilter = {
        formats: [".ts", ".md"],
        shouldInclude: (p: string) => p.endsWith(".ts") || p.endsWith(".md"),
      };

      // --- Mock parsers ---
      const codeParser: SourceParser = {
        type: "code",
        extensions: [".ts"],
        supportsFile: (p: string) => p.endsWith(".ts"),
        parse: async (path: string): Promise<ParsedSource> => ({
          type: "code",
          path,
          content: "parsed code content",
          tags: ["typescript"],
          metadata: { kind: "code", language: "typescript" },
          file_blake3: "mock-code-hash",
          last_parsed: new Date().toISOString(),
        }),
      };

      const mdParser: SourceParser = {
        type: "markdown",
        extensions: [".md"],
        supportsFile: (p: string) => p.endsWith(".md"),
        parse: async (path: string): Promise<ParsedSource> => ({
          type: "markdown",
          path,
          content: "parsed markdown content",
          tags: ["docs"],
          metadata: { kind: "markdown" },
          file_blake3: "mock-md-hash",
          last_parsed: new Date().toISOString(),
        }),
      };

      const mockRegistry: SourceParserRegistry = {
        getParser: (path: string) =>
          [codeParser, mdParser].find((p) => p.supportsFile(path)) ?? null,
        register: () => {},
      };

      const mockChunker: import("../../src/domain/systems/ChunkingSystem").Chunker = {
        type: "generic" as any,
        chunk: async (text: string) => [{
          content: "chunk content",
          core_content: text.includes("code") ? "core semantic unit code" : "core semantic unit md",
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

      const systems: IndexSystems = {
        fileFilter: mockFilter,
        parserRegistry: mockRegistry,
        chunker: mockChunker,
        embedderRegistry: mockEmbRegistry,
        repo,
        hasher: mockHasher,
        logger: mockLogger,
      };

      useCase = new IndexUseCase(systems);
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("execute returns correct stats after indexing directory", async () => {
      const stats = await useCase.execute(tmpDir);
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

  describe("with exclude patterns", () => {
    test("files matching exclude pattern are skipped", async () => {
      const tmpDir = createTempDir();
      createTestFile(tmpDir, "app.ts", "keep");
      createTestFile(tmpDir, "app.test.ts", "skip");

      const mockLogger = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      };

      const filter: FileFilter = {
        formats: [".ts"],
        shouldInclude: (p: string) => p.endsWith(".ts") && !p.includes(".test."),
      };

      const parser: SourceParser = {
        type: "code",
        extensions: [".ts"],
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

      const registry: SourceParserRegistry = {
        getParser: () => parser,
        register: () => {},
      };

      const mockChunker = new MockChunker([
        {
          content: "c",
          core_content: "cc",
          chunk_index: 0,
          total_chunks: 1,
          strategy: "fixed",
          size_tokens: 5,
        },
      ]);

      const repo = new MockSourceRepository();

      const useCase = new IndexUseCase({
        fileFilter: filter,
        parserRegistry: registry,
        chunker: mockChunker,
        embedderRegistry: new MockEmbedderRegistry({
          code: new MockEmbedder("m", 8),
        }),
        repo,
        hasher: new MockHasher(),
        logger: mockLogger,
      });

      const stats = await useCase.execute(tmpDir);
      expect(stats.total_files).toBe(1); // only app.ts

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
