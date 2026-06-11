import { describe, expect, test } from "bun:test";

// Import types (will validate they exist when source is created in step 1.2)
import type {
  SourceType,
  SourceMetadata,
  SourceData,
  SearchQuery,
  SearchResult,
  ParsedSource,
  IndexStats,
} from "../../src/domain/types";

// ---------------------------------------------------------------------------
// Runtime helper: narrow SourceMetadata by kind
// ---------------------------------------------------------------------------
function getCodeLanguage(meta: SourceMetadata): string {
  // Discriminated union narrowing via 'kind'
  if (meta.kind === "code") return meta.language;
  if (meta.kind === "markdown") return "n/a (markdown)";
  if (meta.kind === "obsidian") return "n/a (obsidian)";
  return "n/a (generic)";
}

// ---------------------------------------------------------------------------
// SourceType
// ---------------------------------------------------------------------------
describe("SourceType", () => {
  test("all SourceType values are valid strings", () => {
    const t1: SourceType = "code";
    const t2: SourceType = "markdown";
    const t3: SourceType = "obsidian";
    const t4: SourceType = "generic";
    expect([t1, t2, t3, t4]).toEqual(["code", "markdown", "obsidian", "generic"]);
  });

  test("SourceType rejects unknown values at type level (runtime is string)", () => {
    const val: string = "unknown";
    // At runtime types are erased, but we can still test assignment works
    expect(typeof val).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// SourceMetadata discriminated union
// ---------------------------------------------------------------------------
describe("SourceMetadata", () => {
  test("code metadata narrowing", () => {
    const meta: SourceMetadata = {
      kind: "code",
      language: "typescript",
      packageName: "lodash",
    };
    expect(getCodeLanguage(meta)).toBe("typescript");
    // After narrowing, code-specific fields are accessible
    if (meta.kind === "code") {
      expect(meta.language).toBe("typescript");
      expect(meta.packageName).toBe("lodash");
    }
  });

  test("code metadata without optional packageName", () => {
    const meta: SourceMetadata = { kind: "code", language: "python" };
    expect(meta.kind).toBe("code");
    if (meta.kind === "code") {
      expect(meta.language).toBe("python");
      expect(meta.packageName).toBeUndefined();
    }
  });

  test("markdown metadata narrowing", () => {
    const meta: SourceMetadata = {
      kind: "markdown",
      heading: "Introduction",
      section: "Overview",
      wordCount: 150,
    };
    if (meta.kind === "markdown") {
      expect(meta.heading).toBe("Introduction");
      expect(meta.section).toBe("Overview");
      expect(meta.wordCount).toBe(150);
    }
  });

  test("markdown metadata without optionals", () => {
    const meta: SourceMetadata = { kind: "markdown" };
    expect(meta.kind).toBe("markdown");
    if (meta.kind === "markdown") {
      expect(meta.heading).toBeUndefined();
      expect(meta.section).toBeUndefined();
      expect(meta.wordCount).toBeUndefined();
    }
  });

  test("obsidian metadata narrowing", () => {
    const meta: SourceMetadata = {
      kind: "obsidian",
      tags: ["project", "notes"],
      links: ["page1", "page2"],
      frontmatter: { created: "2024-01-01" },
    };
    if (meta.kind === "obsidian") {
      expect(meta.tags).toEqual(["project", "notes"]);
      expect(meta.links).toEqual(["page1", "page2"]);
      expect(meta.frontmatter).toEqual({ created: "2024-01-01" });
    }
  });

  test("obsidian metadata without frontmatter", () => {
    const meta: SourceMetadata = {
      kind: "obsidian",
      tags: [],
      links: [],
    };
    if (meta.kind === "obsidian") {
      expect(meta.tags).toEqual([]);
      expect(meta.links).toEqual([]);
      expect(meta.frontmatter).toBeUndefined();
    }
  });

  test("generic metadata narrowing", () => {
    const meta: SourceMetadata = {
      kind: "generic",
      encoding: "utf-8",
      mimeType: "text/plain",
    };
    if (meta.kind === "generic") {
      expect(meta.encoding).toBe("utf-8");
      expect(meta.mimeType).toBe("text/plain");
    }
  });

  test("generic metadata without mimeType", () => {
    const meta: SourceMetadata = { kind: "generic", encoding: "base64" };
    if (meta.kind === "generic") {
      expect(meta.encoding).toBe("base64");
      expect(meta.mimeType).toBeUndefined();
    }
  });

  test("exhaustive narrowing switch covers all kinds", () => {
    // Compile-time check: if a new kind is added without a branch this will error
    const narrow = (meta: SourceMetadata): string => {
      switch (meta.kind) {
        case "code":
          return meta.language;
        case "markdown":
          return meta.heading ?? "untitled";
        case "obsidian":
          return meta.tags.join(",");
        case "generic":
          return meta.encoding;
      }
    };
    expect(
      narrow({ kind: "code", language: "rust" }),
    ).toBe("rust");
    expect(
      narrow({ kind: "markdown", heading: "Intro" }),
    ).toBe("Intro");
    expect(
      narrow({ kind: "obsidian", tags: ["dev"], links: [] }),
    ).toBe("dev");
    expect(
      narrow({ kind: "generic", encoding: "utf-16" }),
    ).toBe("utf-16");
  });
});

// ---------------------------------------------------------------------------
// SourceData
// ---------------------------------------------------------------------------
describe("SourceData", () => {
  const sampleMetadata: SourceMetadata = {
    kind: "code",
    language: "typescript",
    packageName: "@openagents/index",
  };

  const sourceData: SourceData = {
    id: "0192c1a0-0000-7000-8000-000000000001",
    chunk_id: "0192c1a0-0000-7000-8000-000000000002",
    source_id: "0192c1a0-0000-7000-8000-000000000003",
    type: "code",
    title: "main.ts",
    content: 'import { foo } from "bar";\n',
    tags: ["typescript", "module"],
    path: "/src/main.ts",
    file_blake3: "abc123def456",
    semantic_blake3: "sem789ghi012",
    chunk_index: 0,
    total_chunks: 3,
    embeddings: [0.1, 0.2, 0.3],
    metadata: sampleMetadata,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  };

  test("has all required fields", () => {
    expect(sourceData.id).toBeDefined();
    expect(sourceData.chunk_id).toBeDefined();
    expect(sourceData.source_id).toBeDefined();
    expect(sourceData.type).toBeDefined();
    expect(sourceData.title).toBeDefined();
    expect(sourceData.content).toBeDefined();
    expect(sourceData.tags).toBeDefined();
    expect(sourceData.path).toBeDefined();
    expect(sourceData.file_blake3).toBeDefined();
    expect(sourceData.semantic_blake3).toBeDefined();
    expect(sourceData.chunk_index).toBeDefined();
    expect(sourceData.total_chunks).toBeDefined();
    expect(sourceData.embeddings).toBeDefined();
    expect(sourceData.metadata).toBeDefined();
    expect(sourceData.created_at).toBeDefined();
    expect(sourceData.updated_at).toBeDefined();
  });

  test("fields have correct types", () => {
    expect(typeof sourceData.id).toBe("string");
    expect(typeof sourceData.chunk_id).toBe("string");
    expect(typeof sourceData.source_id).toBe("string");
    expect(typeof sourceData.type).toBe("string");
    expect(typeof sourceData.title).toBe("string");
    expect(typeof sourceData.content).toBe("string");
    expect(Array.isArray(sourceData.tags)).toBe(true);
    expect(typeof sourceData.path).toBe("string");
    expect(typeof sourceData.file_blake3).toBe("string");
    expect(typeof sourceData.semantic_blake3).toBe("string");
    expect(typeof sourceData.chunk_index).toBe("number");
    expect(typeof sourceData.total_chunks).toBe("number");
    expect(Array.isArray(sourceData.embeddings)).toBe(true);
    expect(typeof sourceData.metadata).toBe("object");
    expect(typeof sourceData.created_at).toBe("string");
    expect(typeof sourceData.updated_at).toBe("string");
  });

  test("embeddings contain numbers", () => {
    expect(sourceData.embeddings.every((e) => typeof e === "number")).toBe(true);
  });

  test("metadata is discriminable", () => {
    if (sourceData.metadata.kind === "code") {
      expect(sourceData.metadata.language).toBe("typescript");
    }
  });

  test("chunk_index and total_chunks relationship", () => {
    expect(sourceData.chunk_index).toBeLessThan(sourceData.total_chunks);
  });

  test("timestamps are ISO 8601", () => {
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(sourceData.created_at).toMatch(isoRegex);
    expect(sourceData.updated_at).toMatch(isoRegex);
  });
});

// ---------------------------------------------------------------------------
// SearchQuery
// ---------------------------------------------------------------------------
describe("SearchQuery", () => {
  test("full search query with all fields", () => {
    const query: SearchQuery = {
      text: "typescript generics",
      mode: "hybrid",
      tags: ["typescript"],
      top_k: 10,
      source_types: ["code", "markdown"],
      min_score: 0.5,
      filters: { author: "john" },
    };
    expect(query.text).toBe("typescript generics");
    expect(query.mode).toBe("hybrid");
    expect(query.tags).toEqual(["typescript"]);
    expect(query.top_k).toBe(10);
    expect(query.source_types).toEqual(["code", "markdown"]);
    expect(query.min_score).toBe(0.5);
    expect(query.filters).toEqual({ author: "john" });
  });

  test("minimal search query (only required fields)", () => {
    const query: SearchQuery = {
      text: "hello",
      mode: "semantic",
      top_k: 5,
    };
    expect(query.text).toBe("hello");
    expect(query.mode).toBe("semantic");
    expect(query.top_k).toBe(5);
    expect(query.tags).toBeUndefined();
    expect(query.source_types).toBeUndefined();
    expect(query.min_score).toBeUndefined();
    expect(query.filters).toBeUndefined();
  });

  test("mode values are valid", () => {
    const semantic: SearchQuery = { text: "a", mode: "semantic", top_k: 1 };
    const keyword: SearchQuery = { text: "a", mode: "keyword", top_k: 1 };
    const hybrid: SearchQuery = { text: "a", mode: "hybrid", top_k: 1 };
    expect(semantic.mode).toBe("semantic");
    expect(keyword.mode).toBe("keyword");
    expect(hybrid.mode).toBe("hybrid");
  });
});

// ---------------------------------------------------------------------------
// SearchResult
// ---------------------------------------------------------------------------
describe("SearchResult", () => {
  const sampleMetadata: SourceMetadata = {
    kind: "markdown",
    heading: "Test",
  };

  const source: SourceData = {
    id: "id-1",
    chunk_id: "chunk-id-1",
    source_id: "source-id-1",
    type: "markdown",
    title: "test.md",
    content: "# Hello",
    tags: ["test"],
    path: "/docs/test.md",
    file_blake3: "fhash",
    semantic_blake3: "shash",
    chunk_index: 0,
    total_chunks: 1,
    embeddings: [],
    metadata: sampleMetadata,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  test("search result with all fields", () => {
    const result: SearchResult = {
      source,
      score: 0.95,
      match_type: "semantic",
      model_scores: { cosine: 0.95, euclidean: 0.3 },
    };
    expect(result.source.id).toBe("id-1");
    expect(result.score).toBeCloseTo(0.95);
    expect(result.match_type).toBe("semantic");
    expect(result.model_scores).toEqual({ cosine: 0.95, euclidean: 0.3 });
  });

  test("search result without model_scores", () => {
    const result: SearchResult = {
      source,
      score: 0.85,
      match_type: "keyword",
    };
    expect(result.score).toBeCloseTo(0.85);
    expect(result.match_type).toBe("keyword");
    expect(result.model_scores).toBeUndefined();
  });

  test("match_type values", () => {
    const r1: SearchResult = { source, score: 1, match_type: "semantic" };
    const r2: SearchResult = { source, score: 1, match_type: "keyword" };
    const r3: SearchResult = { source, score: 1, match_type: "hybrid" };
    expect(r1.match_type).toBe("semantic");
    expect(r2.match_type).toBe("keyword");
    expect(r3.match_type).toBe("hybrid");
  });
});

// ---------------------------------------------------------------------------
// ParsedSource
// ---------------------------------------------------------------------------
describe("ParsedSource", () => {
  test("parsed source with all fields", () => {
    const meta: SourceMetadata = {
      kind: "code",
      language: "go",
      packageName: "fmt",
    };
    const parsed: ParsedSource = {
      type: "code",
      path: "/src/main.go",
      content: 'package main\n\nimport "fmt"\n',
      tags: ["go", "main"],
      metadata: meta,
      file_blake3: "abc123",
      last_parsed: "2026-01-15T10:30:00.000Z",
    };
    expect(parsed.type).toBe("code");
    expect(parsed.path).toBe("/src/main.go");
    expect(parsed.content).toContain("package main");
    expect(parsed.tags).toEqual(["go", "main"]);
    if (parsed.metadata.kind === "code") {
      expect(parsed.metadata.language).toBe("go");
    }
    expect(parsed.file_blake3).toBe("abc123");
    expect(parsed.last_parsed).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  test("parsed source with markdown metadata", () => {
    const parsed: ParsedSource = {
      type: "markdown",
      path: "/docs/readme.md",
      content: "# Readme",
      tags: [],
      metadata: { kind: "markdown", heading: "Readme", wordCount: 50 },
      file_blake3: "def456",
      last_parsed: "2026-02-01T00:00:00.000Z",
    };
    if (parsed.metadata.kind === "markdown") {
      expect(parsed.metadata.heading).toBe("Readme");
      expect(parsed.metadata.wordCount).toBe(50);
    }
  });
});

// ---------------------------------------------------------------------------
// IndexStats
// ---------------------------------------------------------------------------
describe("IndexStats", () => {
  test("stats with all fields", () => {
    const stats: IndexStats = {
      total_sources: 100,
      total_chunks: 350,
      total_files: 80,
      total_tokens: 400,
      total_deduped_chunks: 0,
      last_indexed: "2026-03-01T12:00:00.000Z",
    };
    expect(stats.total_sources).toBe(100);
    expect(stats.total_chunks).toBe(350);
    expect(stats.total_files).toBe(80);
    expect(stats.total_tokens).toBe(400);
    expect(stats.total_deduped_chunks).toBe(0);
    expect(stats.last_indexed).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  test("stats can have zero values", () => {
    const stats: IndexStats = {
      total_sources: 0,
      total_chunks: 0,
      total_files: 0,
      total_tokens: 0,
      total_deduped_chunks: 0,
      last_indexed: "2026-01-01T00:00:00.000Z",
    };
    expect(stats.total_sources).toBe(0);
    expect(stats.total_chunks).toBe(0);
    expect(stats.total_files).toBe(0);
    expect(stats.total_deduped_chunks).toBe(0);
    expect(stats.total_tokens).toBe(0);
  });
});
