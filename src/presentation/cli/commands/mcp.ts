// ---------------------------------------------------------------------------
// indeX mcp — start the MCP server over stdio
// ---------------------------------------------------------------------------

import type { Command } from "commander";

export function registerMcp(program: Command): void {
  program
    .command("mcp")
    .description("Start the MCP server over stdio (for AI agents)")
    .action(async () => {
      // Load heavy dependencies only when the server is actually started.
      const { startMcpServer } = await import("../../mcp/mcp-entry");
      await startMcpServer();
    });
}
