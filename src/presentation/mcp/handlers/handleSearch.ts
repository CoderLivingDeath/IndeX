// ---------------------------------------------------------------------------
// handleSearch — MCP tool handler for `search`
// ---------------------------------------------------------------------------

import type { McpDependencies } from "../IndeXMcpServer";

interface SearchArgs {
  query: string;
  mode?: string;
  top_k?: number;
  columns?: string;
}

export async function handleSearch(args: Record<string, unknown>, deps: McpDependencies) {
  const { query, mode, top_k, columns } = args as unknown as SearchArgs;

  const results = await deps.search.execute(query, {
    mode: (mode as any) ?? "hybrid",
    top_k: top_k ?? 10,
  });

  const output = results.map((r) => {
    const obj: Record<string, unknown> = {
      match_type: r.match_type,
      path: r.source.path,
      score: r.score,
      type: r.source.type,
      content: r.source.content.substring(0, 500),
    };
    if (columns) {
      for (const col of columns.split(",").map((c) => c.trim())) {
        if (col === "tags") obj.tags = r.source.tags;
        if (col === "blake3") obj.blake3 = r.source.file_blake3;
        if (col === "chunk") {
          obj.chunk_index = r.source.chunk_index;
          obj.total_chunks = r.source.total_chunks;
        }
      }
    }
    return obj;
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ count: output.length, results: output }, null, 2),
      },
    ],
  };
}
