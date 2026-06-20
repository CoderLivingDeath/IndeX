// ---------------------------------------------------------------------------
// MCP server entry point — standalone binary, no CLI overhead
//
// Compiled separately to indeX-mcp.exe so it doesn't lock the main CLI exe.
// ---------------------------------------------------------------------------

import { loadApp } from "../cli/app-loader";

try {
  const app = await loadApp();
  await app.mcp.start();

  // Keep running until stdin closes
  await new Promise<void>((resolve) => {
    process.stdin.on("end", () => resolve());
    process.stdin.on("close", () => resolve());
    process.on("SIGTERM", () => resolve());
    process.on("SIGINT", () => resolve());
  });
} catch (err) {
  console.error("Failed to start MCP server:", err);
  process.exit(1);
}
