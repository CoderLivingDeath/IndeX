// ---------------------------------------------------------------------------
// handleClear — MCP tool handler for `clear`
// ---------------------------------------------------------------------------

import type { McpDependencies } from "../IndeXMcpServer";

export async function handleClear(deps: McpDependencies) {
  await deps.del.clear();

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ status: "ok", message: "Index cleared successfully" }),
      },
    ],
  };
}
