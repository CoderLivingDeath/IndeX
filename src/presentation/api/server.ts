// ---------------------------------------------------------------------------
// HTTP API — Hono server wrapping IndeX use cases
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { resolve } from "path";
import { writeFileSync } from "fs";
import type { AppUseCases } from "../../index";
import { WEB_DIST, buildWeb } from "./web-build";

/**
 * Create a Hono HTTP API server wrapping the IndeX application.
 *
 * @param webRoot - Directory with the built React SPA (default: dist/web).
 */
export function createServer(
  app: AppUseCases,
  hasVectorEmbedder: boolean = false,
  webRoot: string = WEB_DIST,
): Hono {
  const server = new Hono();

  // CORS for SPA
  server.use("/api/*", cors());

  // ── Config ──────────────────────────────────────────────

  // GET /api/config  —  return current session config
  server.get("/api/config", async (c) => {
    return c.json({ config: app.config });
  });

  // PATCH /api/config  —  update config and persist to disk
  server.patch("/api/config", async (c) => {
    try {
      const body = await c.req.json();
      // Merge into existing config (shallow merge for top-level keys)
      const updated = { ...app.config, ...body };
      // Write back to config file
      const configPath = ".indeX/config.json";
      writeFileSync(configPath, JSON.stringify(updated, null, 2), "utf-8");
      // Update the in-memory config reference (object is frozen by user)
      Object.assign(app.config, updated);
      return c.json({ status: "ok", config: updated });
    } catch (err: any) {
      return c.json({ error: String(err) }, 400);
    }
  });

  // ── Search ──────────────────────────────────────────────

  // GET /api/search?q=...&mode=...&top_k=...&tags=...&source_types=...&min_score=...&offset=...&limit=...
  server.get("/api/search", async (c) => {
    const query = c.req.query("q");
    if (!query) {
      return c.json({ error: "Missing query parameter 'q'" }, 400);
    }

    const mode = (c.req.query("mode") ?? "keyword") as any;
    const topK = parseInt(c.req.query("top_k") ?? "10", 10);
    const tags = c.req.query("tags")?.split(",").filter(Boolean);
    const sourceTypes = c.req.query("source_types")?.split(",").filter(Boolean) as ("code" | "markdown" | "obsidian" | "generic")[] | undefined;
    const minScore = c.req.query("min_score") ? parseFloat(c.req.query("min_score")!) : undefined;
    const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10));
    const limit = Math.max(1, Math.min(100, parseInt(c.req.query("limit") ?? "20", 10)));

    // Block semantic/hybrid when no real embedder is available
    if (!hasVectorEmbedder && (mode === "semantic" || mode === "hybrid")) {
      return c.json({
        results: [],
        count: 0,
        total: 0,
        offset,
        limit,
        mode,
        info: "Vector embedder unavailable. Semantic/hybrid search requires Ollama. Use mode=keyword or start Ollama.",
      }, 200);
    }

    try {
      // Fetch enough results to cover the requested page. `total` is the
      // size of this fetched window (LanceDB has no cheap count query).
      const fetchK = Math.min(1000, Math.max(topK, offset + limit));
      const searchOpts: Record<string, any> = {
        mode,
        top_k: fetchK,
      };
      if (tags) searchOpts.tags = tags;
      if (sourceTypes && sourceTypes.length > 0) searchOpts.source_types = sourceTypes;
      if (minScore !== undefined) searchOpts.min_score = minScore;
      const allResults = await app.search.execute(query, searchOpts as any);
      const total = allResults.length;
      const results = allResults.slice(offset, offset + limit);
      return c.json({ results, count: results.length, total, offset, limit, mode });
    } catch (err: any) {
      if (err?.message?.includes("connect") || err?.message?.includes("ECONNREFUSED")) {
        return c.json({
          error: "Ollama is not running. Use mode=keyword or start Ollama.",
          results: [],
          count: 0,
          total: 0,
        }, 200);
      }
      return c.json({ error: String(err), results: [], count: 0, total: 0 }, 200);
    }
  });

  // GET /api/system — runtime environment for the UI
  server.get("/api/system", async (c) => {
    return c.json({
      cwd: process.cwd(),
      storage: "LanceDB",
      server: new URL(c.req.url).origin,
    });
  });

  // GET /api/stats — always reads live from the repo
  server.get("/api/stats", async (c) => {
    try {
      const stats = await app.del.stats();
      return c.json({ stats });
    } catch (err) {
      return c.json({ error: String(err) }, 200);
    }
  });

  // POST /api/index
  server.post("/api/index", async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const path = body?.path;
    if (!path) {
      return c.json({ error: "Missing 'path' in request body" }, 400);
    }

    try {
      // Normalise to an absolute path so rows replace existing entries
      // instead of creating relative-path duplicates.
      const stats = await app.index.execute(resolve(path));
      return c.json({
        status: "ok",
        message: `Indexed ${stats.total_files} files, ${stats.total_chunks} chunks (${stats.total_deduped_chunks} reused)`,
        stats,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg.includes("connect") || msg.includes("ECONNREFUSED")) {
        return c.json({ error: "Ollama not available. Data indexed without embeddings (keyword search only)." }, 200);
      }
      return c.json({ error: msg }, 200);
    }
  });

  // DELETE /api/index  —  clear all indexed data
  server.delete("/api/index", async (c) => {
    try {
      await app.del.clear();
      return c.json({ status: "ok", message: "Index cleared" });
    } catch (err: any) {
      return c.json({ error: String(err) }, 200);
    }
  });

  // GET /api/source?source_id=...  —  get all chunks for a source
  server.get("/api/source", async (c) => {
    const sourceId = c.req.query("source_id");
    const path = c.req.query("path");
    try {
      if (sourceId) {
        const chunks = await app.del.getSourceChunks(sourceId);
        return c.json({ chunks, total: chunks.length });
      }
      if (path) {
        const chunks = await app.del.getPathChunks(path);
        return c.json({ chunks, total: chunks.length });
      }
      return c.json({ error: "Provide source_id or path" }, 400);
    } catch (err: any) {
      return c.json({ error: String(err) }, 200);
    }
  });

  // ── Static files (React SPA) ───────────────────────────────
  server.use("/*", serveStatic({ root: webRoot }));

  return server;
}

/**
 * Start the IndeX HTTP API server on the given port.
 * Uses persistent LanceDB on disk (.indeX/index.lancedb).
 * Pass `--memory` to use in-memory storage (no persistence).
 */
export async function serve(port: number = 3000, useMemory: boolean = false): Promise<void> {
  const { createApp } = await import("../../index");
  const { PinoLogger } = await import("../../infrastructure/logger/PinoLogger");

  const webRoot = await buildWeb().catch((err) => {
    console.error(`\n  Failed to build the web UI: ${err}\n`);
    process.exit(1);
  });

  const app = createApp({
    testMode: useMemory,
    logger: new PinoLogger({ level: "info", pretty: true }),
  });
  const server = createServer(app, true, webRoot); // OllamaEmbedder = vector search available

  try {
    Bun.serve({
      fetch: server.fetch,
      port,
    });
    console.log(`\n  IndeX API server running at http://localhost:${port}`);
    console.log(`  Storage: ${useMemory ? "LanceDB (memory)" : "LanceDB (disk)"}`);
    console.log(`  Index:   POST /api/index { "path": "." }`);
    console.log(`  Search:  GET  /api/search?q=hello`);
    console.log(`  Web UI:  http://localhost:${port}/\n`);
  } catch (err: any) {
    if (err?.message?.includes("EADDRINUSE") || err?.code === "EADDRINUSE") {
      console.error(`\n  Port ${port} is already in use. Stop the other process first.\n`);
    } else {
      console.error(`\n  Failed to start server: ${err}\n`);
    }
    process.exit(1);
  }
}

// Start server when run directly
if (import.meta.main) {
  const args = process.argv.slice(2);
  const useMemory = args.includes("--memory");
  serve(3000, useMemory).catch(console.error);
}
