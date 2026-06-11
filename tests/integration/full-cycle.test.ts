// ---------------------------------------------------------------------------
// Integration Test — Full Pipeline: Index → Search → Pack
// Uses real parsers (MarkdownParser) + real chunker (HeadingChunker) +
// mocked storage (MockSourceRepository) + mocked embedder.
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { IndexingService } from "../../src/domain/services/IndexingService";
import { SearchService } from "../../src/domain/services/SearchService";
import { IndexUseCase } from "../../src/application/IndexUseCase";
import { SearchUseCase } from "../../src/application/SearchUseCase";
import { MockEmbedder } from "../mocks/MockEmbedder";
import { MockEmbedderRegistry } from "../mocks/MockEmbedderRegistry";
import { MockSourceRepository } from "../mocks/MockSourceRepository";
import { MockHasher } from "../mocks/MockHasher";
import type { FileFilter } from "../../src/domain/ports/FileFilter";
import type { SourceRepository } from "../../src/domain/ports/SourceRepository";
import { ParserRegistry } from "../../src/infrastructure/parser/ParserRegistry";
import { MarkdownParser } from "../../src/infrastructure/parser/MarkdownParser";
import { ChunkerFactory } from "../../src/infrastructure/chunking/ChunkerFactory";
import { TokenEstimatorSimple } from "../../src/infrastructure/hashing/TokenEstimatorSimple";

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

describe("Full pipeline integration", () => {
  let tmpDir: string;
  let repo: SourceRepository;
  let indexUseCase: IndexUseCase;
  let searchUseCase: SearchUseCase;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "indeX-integration-"));

    const fileFilter: FileFilter = {
      formats: [".md"],
      shouldInclude: (p: string) => p.endsWith(".md"),
    };

    const parserRegistry = new ParserRegistry();
    parserRegistry.register(new MarkdownParser());

    const tokenEstimator = new TokenEstimatorSimple();
    const chunkerFactory = new ChunkerFactory(500, tokenEstimator, 32);
    const chunkerPipeline = chunkerFactory.createPipeline(["heading", "paragraph", "sentence", "overflow"]);
    const chunker = {
      type: "markdown" as const,
      chunk: async (text: string) => chunkerPipeline.chunk(text, "markdown"),
    };

    const mockEmbedder = new MockEmbedder("test-model", 64);
    const embedderRegistry = new MockEmbedderRegistry({ markdown: mockEmbedder, generic: mockEmbedder });

    repo = new MockSourceRepository();
    const hasher = new MockHasher();

    const indexingService = new IndexingService(
      fileFilter,
      parserRegistry,
      chunker,
      embedderRegistry,
      repo,
      hasher,
    );

    indexUseCase = new IndexUseCase({
      fileFilter,
      parserRegistry,
      chunker,
      embedderRegistry,
      repo,
      hasher,
      logger: mockLogger,
    });

    const searchService = new SearchService(mockEmbedder, repo, {
      hybrid_weight: 0.7,
    });

    searchUseCase = new SearchUseCase({
      embedder: mockEmbedder,
      repo,
      packer: {
        pack: async (results: any[]) => ({
          markdown: results.map((r) => r.source.content).join("\n\n"),
          chunks_used: results.length,
          total_tokens: 0,
          truncated: false,
          source_notes: results.map((r) => r.source.path),
        }),
      },
      logger: mockLogger,
    });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates app with mock DI", () => {
    expect(indexUseCase).toBeDefined();
    expect(searchUseCase).toBeDefined();
    expect(typeof indexUseCase.execute).toBe("function");
    expect(typeof searchUseCase.execute).toBe("function");
  });

  test("indexes a markdown fixture through real parser + chunker", async () => {
    // Create fixture files
    writeFileSync(
      join(tmpDir, "note1.md"),
      `# Title

This is some content about TypeScript.

## Section

More details here.`,
      "utf-8",
    );

    writeFileSync(
      join(tmpDir, "note2.md"),
      `# Another Note

Content about Markdown parsing.`,
      "utf-8",
    );

    const stats = await indexUseCase.execute(tmpDir);
    expect(stats.total_files).toBe(2);
    expect(stats.total_chunks).toBeGreaterThanOrEqual(2);
  });

  test("searches indexed content", async () => {
    const results = await searchUseCase.execute("TypeScript", { mode: "keyword", top_k: 10 });
    expect(Array.isArray(results)).toBe(true);
    // Should find at least the TypeScript-related content
    expect(results.length).toBeGreaterThan(0);
  });

  test("packs files into markdown bundle", async () => {
    const { PackUseCase } = await import("../../src/application/PackUseCase");
    const pack = new PackUseCase({
      parserRegistry: new ParserRegistry(),
      fileFilter: { formats: [".md"], shouldInclude: (p: string) => p.endsWith(".md") },
      logger: mockLogger,
    });
    // Register markdown parser for the pack use case
    (pack as any).systems.parserRegistry.register(new MarkdownParser());

    const packed = await pack.execute(tmpDir, { include: ["**/*.md"] });
    expect(packed.markdown).toContain("Title");
    expect(packed.markdown).toContain("Another Note");
    expect(packed.chunks_used).toBe(2);
  });
});