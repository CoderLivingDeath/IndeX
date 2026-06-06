// ---------------------------------------------------------------------------
// ChunkUseCase — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { FileFilter } from "../../src/domain/ports/FileFilter";
import type { SourceParserRegistry } from "../../src/domain/ports/SourceParserRegistry";
import type { SourceParser } from "../../src/domain/ports/SourceParser";
import type { ParsedSource } from "../../src/domain/types";
import type { ChunkSystems } from "../../src/application/di/Systems";
import type { Chunk } from "../../src/domain/systems/ChunkingSystem";
import { ChunkUseCase, type ChunkOptions } from "../../src/application/ChunkUseCase";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "chunk-usecase-test-"));
}

function createTestFile(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

// A simple chunker that splits text into chunks by double-newline
class TestChunker {
  readonly type = "generic" as const;

  async chunk(text: string): Promise<Chunk[]> {
    const parts = text.split(/\n\n+/).filter(Boolean);
    return parts.map((part, i) => ({
      content: part,
      core_content: part,
      chunk_index: i,
      total_chunks: parts.length,
      strategy: "paragraph",
      size_tokens: Math.max(1, Math.round(part.length / 4)),
    }));
  }
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("ChunkUseCase", () => {
  describe("execute — chunk directory", () => {
    let tmpDir: string;
    let useCase: ChunkUseCase;

    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    beforeAll(() => {
      tmpDir = createTempDir();
      createTestFile(tmpDir, "doc1.md", "# Section 1\n\nContent one.\n\n# Section 2\n\nContent two.");
      createTestFile(tmpDir, "doc2.md", "# Intro\n\nJust a single paragraph.");
      createTestFile(tmpDir, "code.ts", 'const x = 1;\n\nfunction foo() { return x; }');
      createTestFile(tmpDir, "notes.txt", "Not included.");

      // --- Mock parsers ---
      const mdParser: SourceParser = {
        type: "markdown",
        extensions: [".md"],
        supportsFile: (p: string) => p.endsWith(".md"),
        parse: async (path: string): Promise<ParsedSource> => {
          const content = await Bun.file(path).text();
          return {
            type: "markdown",
            path,
            content,
            tags: ["docs"],
            metadata: { kind: "markdown" },
            file_blake3: "mock-hash",
            last_parsed: new Date().toISOString(),
          };
        },
      };

      const tsParser: SourceParser = {
        type: "code",
        extensions: [".ts"],
        supportsFile: (p: string) => p.endsWith(".ts"),
        parse: async (path: string): Promise<ParsedSource> => {
          const content = await Bun.file(path).text();
          return {
            type: "code",
            path,
            content,
            tags: ["typescript"],
            metadata: { kind: "code", language: "typescript" },
            file_blake3: "mock-hash",
            last_parsed: new Date().toISOString(),
          };
        },
      };

      const mockRegistry: SourceParserRegistry = {
        getParser: (path: string) =>
          [mdParser, tsParser].find((p) => p.supportsFile(path)) ?? null,
        register: () => {},
      };

      const mockFilter: FileFilter = {
        formats: [".md", ".ts"],
        shouldInclude: (p: string) => p.endsWith(".md") || p.endsWith(".ts"),
      };

      const systems: ChunkSystems = {
        parserRegistry: mockRegistry,
        chunker: new TestChunker(),
        fileFilter: mockFilter,
        logger: mockLogger,
      };

      useCase = new ChunkUseCase(systems);
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── test 1: chunk returns Chunk[] ────────────────────────────
    test("execute returns Chunk[] for directory", async () => {
      const chunks = await useCase.execute(tmpDir);
      expect(chunks.length).toBeGreaterThan(0);
      // doc1.md has 2 paragraphs, doc2.md has 1, code.ts has 1 → at least 4
      expect(chunks.length).toBeGreaterThanOrEqual(4);
    });

    // ── test 2: include filter ───────────────────────────────────
    test('include filter restricts to .md files', async () => {
      const options: ChunkOptions = { include: ["**/*.md"] };
      const chunks = await useCase.execute(tmpDir, options);
      expect(chunks.length).toBeGreaterThan(0);
      // All chunks should be from .md files (strategy "paragraph")
      expect(chunks.every((c) => c.strategy === "paragraph")).toBe(true);
    });

    // ── test 3: exclude filter ───────────────────────────────────
    test('exclude filter excludes specific files', async () => {
      const options: ChunkOptions = { exclude: ["**/doc2.md"] };
      const chunks = await useCase.execute(tmpDir, options);
      // No chunks should come from doc2.md — every chunk's content should
      // NOT contain "Just a single paragraph"
      expect(chunks.some((c) => c.content.includes("Just a single paragraph"))).toBe(false);
    });
  });
});
