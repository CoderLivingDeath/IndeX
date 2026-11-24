// ---------------------------------------------------------------------------
// MCP server entry point — stdio transport, clean stdout.
//
// stdio is the JSON-RPC channel, so stdout MUST stay protocol-only. All logs
// are sent to stderr via a dedicated PinoLogger destination.
// ---------------------------------------------------------------------------

import { createApp } from "../../index";
import { PinoLogger } from "../../infrastructure/logger/PinoLogger";

/**
 * Start the MCP server and keep it running until stdin closes or a
 * termination signal arrives.
 */
export async function startMcpServer(): Promise<void> {
  const logger = new PinoLogger({ level: "info" }, process.stderr);
  const app = createApp({ logger });

  await app.mcp.start();

  await new Promise<void>((resolve) => {
    process.stdin.on("end", () => resolve());
    process.stdin.on("close", () => resolve());
    process.on("SIGTERM", () => resolve());
    process.on("SIGINT", () => resolve());
  });

  await app.mcp.stop();
}

// Standalone entry: `bun src/presentation/mcp/mcp-entry.ts`
if (import.meta.main) {
  startMcpServer().catch((err) => {
    console.error("Failed to start MCP server:", err);
    process.exit(1);
  });
}
