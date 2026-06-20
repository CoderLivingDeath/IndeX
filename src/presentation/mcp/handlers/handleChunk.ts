// ---------------------------------------------------------------------------
// handleChunk — MCP tool handler for `chunk`
// ---------------------------------------------------------------------------

import type { McpDependencies } from "../IndeXMcpServer";

interface ChunkArgs {
  path: string;
}

export async function handleChunk(args: Record<string, unknown>, deps: McpDependencies) {
  const { path } = args as unknown as ChunkArgs;

  const chunks = await deps.chunk.execute(path);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            total_chunks: chunks.length,
          },
          null,
          2,
        ),
      },
    ],
  };
}
