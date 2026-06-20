// ---------------------------------------------------------------------------
// handleStats — MCP tool handler for `stats`
// ---------------------------------------------------------------------------

import type { McpDependencies } from "../IndeXMcpServer";

export async function handleStats(deps: McpDependencies) {
  const stats = await deps.del.stats();

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            total_files: stats.total_files,
            total_chunks: stats.total_chunks,
            total_deduped_chunks: stats.total_deduped_chunks,
            total_tokens: stats.total_tokens,
            last_indexed: stats.last_indexed,
          },
          null,
          2,
        ),
      },
    ],
  };
}
