// ---------------------------------------------------------------------------
// IndeXMcpServer — MCP server system (stdio transport)
//
// Wires McpServer (SDK) + StdioServerTransport + tool registry + resource
// handlers + prompt templates into a single start() entry point.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { SearchUseCase } from "../../application/SearchUseCase";
import type { IndexUseCase } from "../../application/IndexUseCase";
import type { PackUseCase } from "../../application/PackUseCase";
import type { ChunkUseCase } from "../../application/ChunkUseCase";
import type { DeleteUseCase } from "../../application/DeleteUseCase";
import type { Config } from "../../config/ConfigLoader";
import { registerTools } from "./McpToolRegistry";

/**
 * Dependencies needed by the MCP server.
 */
export interface McpDependencies {
  search: SearchUseCase;
  index: IndexUseCase;
  pack: PackUseCase;
  chunk: ChunkUseCase;
  del: DeleteUseCase;
  config: Config;
}

/**
 * MCP server for IndeX — exposes all tools, resources, and prompts
 * over stdio transport (JSON-RPC over stdin/stdout).
 */
export class IndeXMcpServer {
  private transport: StdioServerTransport | null = null;
  private mcpServer: McpServer | null = null;
  private readonly deps: McpDependencies;

  constructor(deps: McpDependencies) {
    this.deps = deps;
  }

  /**
   * Start the MCP server on stdio.
   */
  async start(): Promise<void> {
    // 1. Create stdio transport (reads stdin, writes stdout)
    this.transport = new StdioServerTransport();

    // 2. Create McpServer (SDK high-level API)
    this.mcpServer = new McpServer(
      {
        name: "IndeX",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      },
    );

    // 3. Register tools
    registerTools(this.mcpServer, this.deps);

    // 4. Register resource handlers
    this.registerResources();

    // 5. Register prompt templates
    this.registerPrompts();

    // 6. Connect transport to McpServer (starts listening on stdin)
    await this.mcpServer.connect(this.transport);
  }

  /**
   * Stop the MCP server and clean up.
   */
  async stop(): Promise<void> {
    try {
      await this.mcpServer?.close();
    } catch { /* ignore */ }
    try {
      await this.transport?.close();
    } catch { /* ignore */ }
    this.mcpServer = null;
    this.transport = null;
  }

  /**
   * Register resource handlers for indeX://stats and indeX://config.
   */
  private registerResources(): void {
    if (!this.mcpServer) return;

    this.mcpServer.registerResource(
      "index-stats",
      "indeX://stats",
      {
        description: "Current index statistics",
        mimeType: "application/json",
      },
      async () => {
        const stats = await this.deps.del.stats();
        return {
          contents: [
            {
              uri: "indeX://stats",
              mimeType: "application/json",
              text: JSON.stringify(stats, null, 2),
            },
          ],
        };
      },
    );

    this.mcpServer.registerResource(
      "index-config",
      "indeX://config",
      {
        description: "Current IndeX configuration",
        mimeType: "application/json",
      },
      async () => {
        return {
          contents: [
            {
              uri: "indeX://config",
              mimeType: "application/json",
              text: JSON.stringify(this.deps.config, null, 2),
            },
          ],
        };
      },
    );
  }

  /**
   * Register prompt templates for common agent workflows.
   */
  private registerPrompts(): void {
    if (!this.mcpServer) return;

    this.mcpServer.registerPrompt(
      "search-code",
      {
        description: "Search code with mode and column selection",
        argsSchema: {
          query: z.string().describe("Search query"),
          mode: z.enum(["hybrid", "semantic", "keyword", "ast"]).optional().describe("Search mode"),
        },
      },
      async (args) => {
        const query = (args.query as string) ?? "<query>";
        const mode = (args.mode as string) ?? "hybrid";
        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: `Search the codebase for "${query}" using ${mode} mode. Use the search tool with --mode ${mode} --top-k 10. Format results as a table with path, score, and a snippet of content.`,
              },
            },
          ],
        };
      },
    );

    this.mcpServer.registerPrompt(
      "pack-context",
      {
        description: "Pack files for LLM context analysis",
        argsSchema: {
          path: z.string().describe("Directory path"),
          format: z.enum(["jsonl", "md"]).optional().describe("Output format"),
        },
      },
      async (args) => {
        const path = (args.path as string) ?? ".";
        const format = (args.format as string) ?? "jsonl";
        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: `Pack the files in "${path}" using ${format} format. Include metadata and AST sections. Use the pack tool with --format ${format} --meta --ast --content.`,
              },
            },
          ],
        };
      },
    );

    this.mcpServer.registerPrompt(
      "index-status",
      {
        description: "Check index stats and daemon health",
      },
      async () => {
        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: "Check the current index status. Use the stats tool to get index statistics, and the watch_status tool to check the watch daemon health. Summarize the results.",
              },
            },
          ],
        };
      },
    );
  }
}
