// ---------------------------------------------------------------------------
// PackUseCase — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { FileFilter } from "../../src/domain/ports/FileFilter";
import type { SourceParserRegistry } from "../../src/domain/ports/SourceParserRegistry";
import type { SourceParser } from "../../src/domain/ports/SourceParser";
import type { ParsedSource } from "../../src/domain/types";
import type { PackSystems } from "../../src/application/di/Systems";
import { PackUseCase, type PackOptions } from "../../src/application/PackUseCase";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "pack-usecase-test-"));
}

function createTestFile(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("PackUseCase", () => {
  describe("execute — pack directory", () => {
    let tmpDir: string;
    let useCase: PackUseCase;

    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    beforeAll(() => {
      tmpDir = createTempDir();
      createTestFile(tmpDir, "README.md", "# My Project\n\nThis is a test.");
      createTestFile(tmpDir, "CONTRIBUTING.md", "## How to Contribute\n\nFork and PR.");
      createTestFile(tmpDir, "main.ts", 'console.log("hello");');
      createTestFile(tmpDir, "notes.txt", "Just some notes.");

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

      // FileFilter that accepts everything
      const mockFilter: FileFilter = {
        formats: [".md", ".ts"],
        shouldInclude: (p: string) => p.endsWith(".md") || p.endsWith(".ts"),
      };

      const systems: PackSystems = {
        parserRegistry: mockRegistry,
        fileFilter: mockFilter,
        logger: mockLogger,
      };

      useCase = new PackUseCase(systems);
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── test 1: pack with include filter ──────────────────────────
    test('execute with include filter returns PackedContext with only .md files', async () => {
      const options: PackOptions = { include: ["**/*.md"] };
      const result = await useCase.execute(tmpDir, options);
      expect(result.markdown).toBeTruthy();
      // Should have combined content of both .md files in code fences
      expect(result.markdown).toContain("# My Project");
      expect(result.markdown).toContain("How to Contribute");
      // Should NOT contain the .ts file content
      expect(result.markdown).not.toContain('console.log("hello")');
      expect(result.chunks_used).toBeGreaterThanOrEqual(2);
      expect(result.source_notes.length).toBeGreaterThanOrEqual(2);
    });

    // ── test 2: pack with exclude filter ──────────────────────────
    test('execute with exclude filter excludes specified files', async () => {
      const options: PackOptions = { exclude: ["**/CONTRIBUTING.md"] };
      const result = await useCase.execute(tmpDir, options);
      expect(result.markdown).toContain("# My Project");
      expect(result.markdown).not.toContain("How to Contribute");
    });

    // ── test 3: structured format has file index and metadata ──
    test("packed markdown has file index table and per-file metadata", async () => {
      const result = await useCase.execute(tmpDir, { format: "md" });
      // Should have File Index table of contents
      expect(result.markdown).toContain("## File Index");
      expect(result.markdown).toContain("| # | Path | Language | Lines | Tokens |");
      // Each file should appear in the index and have a ## header and metadata
      expect(result.markdown).toContain("README.md");
      expect(result.markdown).toContain("CONTRIBUTING.md");
      expect(result.markdown).toContain("main.ts");
      // Should have metadata fields
      expect(result.markdown).toContain("type: markdown");
      expect(result.markdown).toContain("type: code");
      expect(result.markdown).toContain("### content");
      // The code file should use ### code (not ### content)
      expect(result.markdown).toContain("### code");
    });
  });
});
