// ---------------------------------------------------------------------------
// McpTransport — stdio transport factory
//
// Uses the SDK's StdioServerTransport to communicate with opencode over
// stdin/stdout (JSON-RPC, newline-delimited).
// ---------------------------------------------------------------------------

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

/**
 * Create an MCP transport instance that reads from stdin and writes to stdout.
 */
export function createMcpTransport(): StdioServerTransport {
  return new StdioServerTransport();
}
