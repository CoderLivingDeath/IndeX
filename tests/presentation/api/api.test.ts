// ---------------------------------------------------------------------------
// HTTP API — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { createServer } from "../../../src/presentation/api/server";
import { MockSourceRepository } from "../../mocks/MockSourceRepository";
import type { SearchResult, IndexStats } from "../../../src/domain/types";

function createMockApp() {
  const repo = new MockSourceRepository();
  return {
    index: {
      execute: async (_path: string): Promise<IndexStats> => ({
        total_sources: 0, total_chunks: 0, total_files: 0, last_indexed: new Date().toISOString(),
      }),
    },
    search: {
      execute: async (_query: string, _opts?: any): Promise<SearchResult[]> => [],
    },
    pack: { execute: async () => ({ markdown: "", chunks_used: 0, total_tokens: 0, truncated: false, source_notes: [] }) },
    chunk: { execute: async () => [] },
    embed: { execute: async () => {} },
    watch: { execute: async () => {}, stop: async () => {} },
    del: { execute: async () => {} },
  };
}

describe("HTTP API", () => {
  test("GET /api/search returns JSON results", async () => {
    const app = createServer(createMockApp() as any, true);
    const res = await app.request("/api/search?q=test&mode=hybrid");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("results");
    expect(body).toHaveProperty("count");
  });

  test("GET /api/search without q returns 400", async () => {
    const app = createServer(createMockApp() as any, true);
    const res = await app.request("/api/search");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  test("GET /api/stats returns JSON", async () => {
    const app = createServer(createMockApp() as any, true);
    const res = await app.request("/api/stats");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("stats");
  });

  test("POST /api/index with valid path returns status", async () => {
    const app = createServer(createMockApp() as any, true);
    const res = await app.request("/api/index", {
      method: "POST",
      body: JSON.stringify({ path: "./vault" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("POST /api/index without path returns 400", async () => {
    const app = createServer(createMockApp() as any, true);
    const res = await app.request("/api/index", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/index with invalid JSON returns 400", async () => {
    const app = createServer(createMockApp() as any, true);
    const res = await app.request("/api/index", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });
});