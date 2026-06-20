// ---------------------------------------------------------------------------
// McpToolRegistry — Register tool definitions with Zod input schemas
// for all 10 IndeX tools exposed via MCP.
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpDependencies } from "./IndeXMcpServer";
import { handleSearch } from "./handlers/handleSearch";
import { handleEmbed } from "./handlers/handleEmbed";
import { handlePack } from "./handlers/handlePack";
import { handleStats } from "./handlers/handleStats";
import { handleScan } from "./handlers/handleScan";
import { handleClear } from "./handlers/handleClear";
import { handleChunk } from "./handlers/handleChunk";
import { handleWatchStart, handleWatchStatus, handleWatchStop } from "./handlers/handleWatch";

export function registerTools(server: McpServer, deps: McpDependencies): void {
  server.registerTool(
    "search",
    {
      description: "Search indexed content using semantic, keyword, hybrid, or AST mode",
      inputSchema: z.object({
        query: z.string().describe("Search query text"),
        mode: z.enum(["hybrid", "semantic", "keyword", "ast"]).optional().describe("Search mode (default: hybrid)"),
        top_k: z.number().optional().describe("Number of results (default: 10)"),
        columns: z.string().optional().describe("Comma-separated column names"),
      }),
    },
    (args) => handleSearch(args, deps),
  );

  server.registerTool(
    "embed",
    {
      description: "Index files from a directory path",
      inputSchema: z.object({
        path: z.string().describe("Directory path to index"),
      }),
    },
    (args) => handleEmbed(args, deps),
  );

  server.registerTool(
    "pack",
    {
      description: "Bundle files into structured context (JSONL or markdown)",
      inputSchema: z.object({
        path: z.string().describe("Directory path to pack"),
        format: z.enum(["jsonl", "md"]).optional().describe("Output format (default: jsonl)"),
        meta: z.boolean().optional().describe("Include metadata block"),
        ast: z.boolean().optional().describe("Include AST section"),
        content: z.boolean().optional().describe("Include code/content block"),
        links: z.boolean().optional().describe("Include links/relationships"),
        include: z.string().optional().describe("Include glob pattern"),
        exclude: z.string().optional().describe("Exclude glob pattern"),
      }),
    },
    (args) => handlePack(args, deps),
  );

  server.registerTool(
    "stats",
    {
      description: "Get index statistics",
    },
    () => handleStats(deps),
  );

  server.registerTool(
    "scan",
    {
      description: "Preview which files would be indexed (dry-run file filters)",
      inputSchema: z.object({
        path: z.string().describe("Directory path to scan"),
        include: z.string().optional().describe("Include glob pattern"),
        exclude: z.string().optional().describe("Exclude glob pattern"),
      }),
    },
    (args) => handleScan(args, deps),
  );

  server.registerTool(
    "clear",
    {
      description: "Delete the entire index and configuration",
    },
    () => handleClear(deps),
  );

  server.registerTool(
    "chunk",
    {
      description: "Split files into chunks (without embedding)",
      inputSchema: z.object({
        path: z.string().describe("Directory path to chunk"),
      }),
    },
    (args) => handleChunk(args, deps),
  );

  server.registerTool(
    "watch_start",
    {
      description: "Start the watch daemon for a directory",
      inputSchema: z.object({
        dir: z.string().describe("Directory to watch"),
        port: z.number().optional().describe("Optional health server port"),
      }),
    },
    (args) => handleWatchStart(args, deps),
  );

  server.registerTool(
    "watch_status",
    {
      description: "Check watch daemon health status",
    },
    (args) => handleWatchStatus(args, deps),
  );

  server.registerTool(
    "watch_stop",
    {
      description: "Stop the watch daemon",
    },
    (args) => handleWatchStop(args, deps),
  );
}
