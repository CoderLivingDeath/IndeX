// ---------------------------------------------------------------------------
// EmbedUseCase — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { EmbedSystems } from "../../src/application/di/Systems";
import type { SourceParserRegistry } from "../../src/domain/ports/SourceParserRegistry";
import type { SourceParser } from "../../src/domain/ports/SourceParser";
import type { FileFilter } from "../../src/domain/ports/FileFilter";
import { MockEmbedder } from "../mocks/MockEmbedder";
import { MockEmbedderRegistry } from "../mocks/MockEmbedderRegistry";
import { MockSourceRepository } from "../mocks/MockSourceRepository";
import { EmbedUseCase, type EmbedOptions } from "../../src/application/EmbedUseCase";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "embed-test-"));
}

function createTestFile(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

function makeMockParser(sourceType: string, ext: string): SourceParser {
  return {
    type: sourceType as "code" | "markdown" | "generic",
    extensions: [ext],
    supportsFile: (p: string) => p.endsWith(ext),
    parse: async (path: string) => {
      const content = await Bun.file(path).text();
      return {
        type: sourceType as "code" | "markdown" | "generic",
        path,
        content,
        tags: [],
        metadata: { kind: "generic" as const, encoding: "utf-8" },
        file_blake3: "mock-hash",
        last_parsed: new Date().toISOString(),
      };
    },
  };
}

function makeParserRegistry(...parsers: SourceParser[]): SourceParserRegistry {
  return {
    getParser: (path: string) =>
      parsers.find((p) => p.supportsFile(path)) ?? null,
    register: () => {},
  };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("EmbedUseCase", () => {
  describe("source: chunks — re-embed existing chunks by path", () => {
    test("reads existing chunks from repo and upserts embeddings", async () => {
      const repo = new MockSourceRepository();
      const embedder = new MockEmbedder("test-model", 8);
      const embRegistry = new MockEmbedderRegistry({ generic: embedder });

      // Seed repo with existing data (no embeddings)
      const now = new Date().toISOString();
      await repo.upsert({
        id: "chunk-1",
        chunk_id: "chunk-1",
        source_id: "src-1",
        type: "generic",
        title: "doc1.txt",
        content: "content to embed",
        tags: [],
        path: "/fixtures/doc1.txt",
        file_blake3: "hash-1",
        semantic_blake3: "sem-1",
        chunk_index: 0,
        total_chunks: 1,
        embeddings: [],
        metadata: { kind: "generic", encoding: "utf-8" },
        created_at: now,
        updated_at: now,
      });

      const systems: EmbedSystems = {
        embedderRegistry: embRegistry,
        repo,
        logger: mockLogger,
      };

      const useCase = new EmbedUseCase(systems);
      await useCase.execute({
        source: "chunks",
        paths: ["/fixtures/doc1.txt"],
      });

      // Verify the chunk now has embeddings
      const updated = await repo.getById("chunk-1");
      expect(updated).not.toBeNull();
      expect(updated!.embeddings.length).toBeGreaterThan(0);
    });
  });

  describe("source: files — embeds and upserts", () => {
    test("re-parses files, chunks, embeds, and upserts", async () => {
      const tmpDir = createTempDir();
      createTestFile(tmpDir, "doc1.txt", "some text content for embedding");

      const repo = new MockSourceRepository();
      const embedder = new MockEmbedder("test-model", 8);
      const embRegistry = new MockEmbedderRegistry({ generic: embedder });

      const parser = makeMockParser("generic", ".txt");
      const parserRegistry = makeParserRegistry(parser);

      const chunker = {
        type: "generic" as const,
        chunk: async (text: string) => [
          {
            content: text,
            core_content: text,
            chunk_index: 0,
            total_chunks: 1,
            strategy: "paragraph",
            size_tokens: Math.max(1, Math.round(text.length / 4)),
          },
        ],
      };

      const fileFilter: FileFilter = {
        formats: [".txt"],
        shouldInclude: () => true,
      };

      const systems: EmbedSystems = {
        embedderRegistry: embRegistry,
        repo,
        parserRegistry,
        chunker,
        fileFilter,
        logger: mockLogger,
      };

      const useCase = new EmbedUseCase(systems);
      await useCase.execute({ source: "files", directory: tmpDir });

      const stats = await repo.stats();
      expect(stats.total_chunks).toBeGreaterThan(0);

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});