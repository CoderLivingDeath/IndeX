// ---------------------------------------------------------------------------
// CLI — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import type { SourceData, SearchResult } from "../../../src/domain/types";
import { parseArgs, formatSearchResults, SEARCH_COLUMNS } from "../../../src/presentation/cli/cli";

describe("CLI argument parsing", () => {
  test("parses index command", () => {
    const result = parseArgs(["index", "./vault"]);
    expect(result.command).toBe("index");
    expect(result.args).toEqual(["./vault"]);
  });

  test("parses search command with flags", () => {
    const result = parseArgs(["search", "query text", "--mode", "hybrid", "--top-k", "5"]);
    expect(result.command).toBe("search");
    expect(result.args).toEqual(["query text"]);
    expect(result.flags.mode).toBe("hybrid");
    expect(result.flags["top-k"]).toBe("5");
  });

  test("parses pack command with output flag", () => {
    const result = parseArgs(["pack", "./vault", "-o", "bundle.md"]);
    expect(result.command).toBe("pack");
    expect(result.args).toEqual(["./vault"]);
    expect(result.flags.o).toBe("bundle.md");
  });

  test("parses pack command with include/exclude flags", () => {
    const result = parseArgs(["pack", ".", "--include", "**/*.md", "--exclude", "node_modules,.git"]);
    expect(result.command).toBe("pack");
    expect(result.args).toEqual(["."]);
    expect(result.flags.include).toBe("**/*.md");
    expect(result.flags.exclude).toBe("node_modules,.git");
  });

  test("parses chunk command", () => {
    const result = parseArgs(["chunk", "./vault"]);
    expect(result.command).toBe("chunk");
    expect(result.args).toEqual(["./vault"]);
  });

  test("parses embed command", () => {
    const result = parseArgs(["embed", "./vault"]);
    expect(result.command).toBe("embed");
    expect(result.args).toEqual(["./vault"]);
  });

  test("parses watch command", () => {
    const result = parseArgs(["watch", "./vault"]);
    expect(result.command).toBe("watch");
    expect(result.args).toEqual(["./vault"]);
  });

  test("parses stats command", () => {
    const result = parseArgs(["stats"]);
    expect(result.command).toBe("stats");
    expect(result.args).toEqual([]);
  });

  test("parses clear command", () => {
    const result = parseArgs(["clear"]);
    expect(result.command).toBe("clear");
    expect(result.args).toEqual([]);
  });

  test("parses --help flag", () => {
    const result = parseArgs(["--help"]);
    expect(result.command).toBe("help");
  });

  test("unknown command returns help", () => {
    const result = parseArgs(["unknown"]);
    expect(result.command).toBe("help");
  });

  test("empty args returns help", () => {
    const result = parseArgs([]);
    expect(result.command).toBe("help");
  });

  test("parses search with --columns flag", () => {
    const result = parseArgs(["search", "query", "--columns", "path,score,ast,meta"]);
    expect(result.command).toBe("search");
    expect(result.flags.columns).toBe("path,score,ast,meta");
  });

  test("SEARCH_COLUMNS contains all expected column names", () => {
    expect(SEARCH_COLUMNS).toContain("match_type");
    expect(SEARCH_COLUMNS).toContain("path");
    expect(SEARCH_COLUMNS).toContain("score");
    expect(SEARCH_COLUMNS).toContain("ast");
    expect(SEARCH_COLUMNS).toContain("meta");
    expect(SEARCH_COLUMNS).toContain("content");
    expect(SEARCH_COLUMNS).toContain("tags");
    expect(SEARCH_COLUMNS).toContain("embedding");
  });
});

describe("formatSearchResults", () => {
  const makeSource = (overrides: Partial<SourceData> = {}): SourceData => ({
    id: "id-1",
    chunk_id: "chunk-1",
    source_id: "src-1",
    type: "code",
    title: "test.ts",
    content: "function foo() { return 1; }",
    tags: ["test", "util"],
    path: "/project/src/test.ts",
    file_blake3: "abc123def456",
    semantic_blake3: "hash789",
    chunk_index: 0,
    total_chunks: 3,
    embeddings: [0.1, 0.2, 0.3, 0.4, 0.5],
    metadata: {
      kind: "code",
      language: "typescript",
      ast: {
        symbols: [{ kind: "function", name: "foo", line: 1 }],
        imports: [],
        exports: [{ name: "foo", kind: "function" }],
      },
    },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  const makeResult = (overrides: Partial<SearchResult> = {}): SearchResult => ({
    source: makeSource(),
    score: 0.95,
    match_type: "semantic",
    model_scores: { e5: 0.9, clip: 0.85 },
    ...overrides,
  });

  test("returns compact format for default columns (match_type, path, score)", () => {
    const results = [makeResult()];
    const output = formatSearchResults(results, ["match_type", "path", "score"]);
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({
      match_type: "semantic",
      path: "/project/src/test.ts",
      score: 0.95,
    });
  });

  test("includes ast column when requested", () => {
    const results = [makeResult()];
    const output = formatSearchResults(results, ["path", "ast"]);
    const parsed = JSON.parse(output);
    expect(parsed.ast).toEqual({
      symbols: [{ kind: "function", name: "foo", line: 1 }],
      imports: [],
      exports: [{ name: "foo", kind: "function" }],
    });
    expect(parsed.score).toBeUndefined();
  });

  test("includes meta column when requested", () => {
    const results = [makeResult()];
    const output = formatSearchResults(results, ["path", "meta"]);
    const parsed = JSON.parse(output);
    expect(parsed.metadata).toHaveProperty("language", "typescript");
  });

  test("shows null ast for non-code files", () => {
    const results = [makeResult({ source: makeSource({ metadata: { kind: "markdown" } }) })];
    const output = formatSearchResults(results, ["ast"]);
    const parsed = JSON.parse(output);
    expect(parsed.ast).toBeNull();
  });

  test("includes tags column when requested", () => {
    const results = [makeResult()];
    const output = formatSearchResults(results, ["tags"]);
    const parsed = JSON.parse(output);
    expect(parsed.tags).toEqual(["test", "util"]);
  });

  test("includes chunk column when requested", () => {
    const results = [makeResult()];
    const output = formatSearchResults(results, ["chunk"]);
    const parsed = JSON.parse(output);
    expect(parsed.chunk_index).toBe(0);
    expect(parsed.total_chunks).toBe(3);
  });

  test("includes content column when requested", () => {
    const results = [makeResult()];
    const output = formatSearchResults(results, ["content"]);
    const parsed = JSON.parse(output);
    expect(parsed.content).toContain("function foo");
  });

  test("includes embedding column when requested", () => {
    const results = [makeResult()];
    const output = formatSearchResults(results, ["embedding"]);
    const parsed = JSON.parse(output);
    expect(parsed.embedding).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
  });

  test("includes model_scores column when requested", () => {
    const results = [makeResult()];
    const output = formatSearchResults(results, ["model_scores"]);
    const parsed = JSON.parse(output);
    expect(parsed.model_scores).toEqual({ e5: 0.9, clip: 0.85 });
  });

  test("outputs one JSON line per result", () => {
    const results = [makeResult({ source: makeSource({ path: "/a.ts" }) }), makeResult({ source: makeSource({ path: "/b.ts" }) })];
    const output = formatSearchResults(results, ["path"]);
    const lines = output.split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).path).toBe("/a.ts");
    expect(JSON.parse(lines[1]!).path).toBe("/b.ts");
  });

  test("handles empty results array", () => {
    const output = formatSearchResults([], ["path"]);
    expect(output).toBe("");
  });
});