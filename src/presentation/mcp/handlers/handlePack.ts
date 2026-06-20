// ---------------------------------------------------------------------------
// handlePack — MCP tool handler for `pack`
// ---------------------------------------------------------------------------

import type { McpDependencies } from "../IndeXMcpServer";
import type { PackOptions } from "../../../application/PackUseCase";

interface PackArgs {
  path: string;
  format?: string;
  meta?: boolean;
  ast?: boolean;
  content?: boolean;
  links?: boolean;
  include?: string;
  exclude?: string;
}

export async function handlePack(args: Record<string, unknown>, deps: McpDependencies) {
  const { path, format, meta, ast, content, links, include, exclude } =
    args as unknown as PackArgs;

  const options: PackOptions = {
    format: (format as "jsonl" | "md") ?? "jsonl",
    maxTokens: 100_000,
  };
  if (meta !== undefined) options.meta = meta;
  if (ast !== undefined) options.ast = ast;
  if (content !== undefined) options.content = content;
  if (links !== undefined) options.links = links;
  if (include) options.include = include.split(",").map((s) => s.trim());
  if (exclude) options.exclude = exclude.split(",").map((s) => s.trim());

  const result = await deps.pack.execute(path, options);

  const text = result.markdown.length > 100_000
    ? result.markdown.substring(0, 100_000) + "\n... (truncated)"
    : result.markdown;

  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}
