// ---------------------------------------------------------------------------
// handleEmbed — MCP tool handler for `embed` (calls deps.index.execute())
// ---------------------------------------------------------------------------

import { resolve } from "path";
import type { McpDependencies } from "../IndeXMcpServer";

interface EmbedArgs {
  path: string;
}

export async function handleEmbed(args: Record<string, unknown>, deps: McpDependencies) {
  const { path } = args as unknown as EmbedArgs;

  const stats = await deps.index.execute(resolve(path));

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
