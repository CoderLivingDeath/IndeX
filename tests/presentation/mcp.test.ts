// ---------------------------------------------------------------------------
// MCP — tests for CLI command, tool registry, handlers, and integration
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeAll } from "bun:test";
import { parseArgs } from "../../src/presentation/cli/format";
import type { McpDependencies } from "../../src/presentation/mcp/IndeXMcpServer";
import { SearchUseCase } from "../../src/application/SearchUseCase";
import { IndexUseCase } from "../../src/application/IndexUseCase";
import { PackUseCase } from "../../src/application/PackUseCase";
import { ChunkUseCase } from "../../src/application/ChunkUseCase";
import { DeleteUseCase } from "../../src/application/DeleteUseCase";
import { MockSourceRepository } from "../mocks/MockSourceRepository";
import { MockEmbedder } from "../mocks/MockEmbedder";
import { SilentLogger } from "../../src/infrastructure/logger/SilentLogger";
import type { FileFilter } from "../../src/domain/ports/FileFilter";
import type { SourceParserRegistry } from "../../src/domain/ports/SourceParserRegistry";
import type { EmbedderRegistry } from "../../src/domain/systems/EmbeddingSystem";
import type { Chunker } from "../../src/domain/systems/ChunkingSystem";

// ── Mock dependencies ─────────────────────────────────────────────

const mockFileFilter: FileFilter = {
  formats: [".ts", ".md"],
  shouldInclude: () => true,
};

const mockParserRegistry: SourceParserRegistry = {
  getParser: () => null,
  getParsers: () => [],
  register: () => {},
};

const mockChunker: Chunker = {
  type: "generic" as any,
  chunk: async (text: string) => [],
};

const mockEmbedderRegistry: EmbedderRegistry = {
  getEmbedder: () => null,
  register: () => {},
  getModels: () => [],
};

const mockLogger = new SilentLogger();

// ── Create mock use cases ─────────────────────────────────────────

function createMockDeps(): McpDependencies {
  const repo = new MockSourceRepository();

  const search = new SearchUseCase({
    embedder: new MockEmbedder("test-model", 4),
    repo,
    packer: {
      pack: async (results: any[]) => ({
        markdown: results.map((r) => r.source.content).join("\n\n"),
        chunks_used: results.length,
        total_tokens: 0,
        truncated: false,
        source_notes: [],
      }),
    },
    logger: mockLogger,
  } as any);

  const index = new IndexUseCase({
    fileFilter: mockFileFilter,
    parserRegistry: mockParserRegistry,
    chunker: mockChunker,
    embedderRegistry: mockEmbedderRegistry,
    repo,
    hasher: { hash: async (s: string) => s, hashBatch: async (arr: string[]) => arr },
    logger: mockLogger,
  } as any);

  const pack = new PackUseCase({
    parserRegistry: mockParserRegistry,
    fileFilter: mockFileFilter,
    logger: mockLogger,
  } as any);

  const chunk = new ChunkUseCase({
    parserRegistry: mockParserRegistry,
    chunker: mockChunker,
    fileFilter: mockFileFilter,
    logger: mockLogger,
  } as any);

  const del = new DeleteUseCase(repo);

  const config = {
    models: [{ name: "test-model", dimensions: 4, provider: "ollama" as const }],
    universal_model: "test-model",
    embedder: { batch_size: 10, cache_size: 100 },
    chunking: { default_strategy: "heading" as const, max_chunk_size: 500, overlap: 32 },
    search: { default_mode: "hybrid" as const, top_k: 10, hybrid_weight: 0.7 },
    indexing: { exclude: [] },
  };

  return { search, index, pack, chunk, del, config };
}

// ── 6.1 Tool registry tests ───────────────────────────────────────

describe("MCP tool handlers", () => {
  let deps: McpDependencies;

  beforeAll(() => {
    deps = createMockDeps();
  });

  test("search handler returns structured results", async () => {
    const { handleSearch } = await import("../../src/presentation/mcp/handlers/handleSearch");
    const result = await handleSearch({ query: "test", mode: "hybrid", top_k: 5 }, deps);
    expect(result.content).toBeDefined();
    expect(result.content[0]!.type).toBe("text");
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("count");
    expect(parsed).toHaveProperty("results");
  });

  test("stats handler returns index stats", async () => {
    const { handleStats } = await import("../../src/presentation/mcp/handlers/handleStats");
    const result = await handleStats(deps);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("total_files");
    expect(parsed).toHaveProperty("total_chunks");
  });

  test("clear handler returns confirmation", async () => {
    const { handleClear } = await import("../../src/presentation/mcp/handlers/handleClear");
    const result = await handleClear(deps);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.status).toBe("ok");
  });

  test("chunk handler returns chunk stats", async () => {
    const { handleChunk } = await import("../../src/presentation/mcp/handlers/handleChunk");
    const result = await handleChunk({ path: "." }, deps);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("total_chunks");
  });

  test("scan handler returns file list for valid directory", async () => {
    const { handleScan } = await import("../../src/presentation/mcp/handlers/handleScan");
    const result = await handleScan({ path: "." }, deps);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("total_files");
    expect(parsed).toHaveProperty("matched_files");
    expect(parsed).toHaveProperty("files");
  });

  test("scan handler returns error for invalid directory", async () => {
    const { handleScan } = await import("../../src/presentation/mcp/handlers/handleScan");
    const result = await handleScan({ path: "/nonexistent/path/xyz123" }, deps);
    expect(result.isError).toBe(true);
  });
});

// ── 6.2 Pack handler tests ────────────────────────────────────────

describe("MCP pack handler", () => {
  let deps: McpDependencies;

  beforeAll(() => {
    deps = createMockDeps();
  });

  test("pack handler returns text content", async () => {
    const { handlePack } = await import("../../src/presentation/mcp/handlers/handlePack");
    const result = await handlePack({ path: "." }, deps);
    expect(result.content[0]!.type).toBe("text");
    expect(typeof result.content[0]!.text).toBe("string");
  });
});


