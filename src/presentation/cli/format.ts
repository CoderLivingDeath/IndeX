// ---------------------------------------------------------------------------
// CLI format utilities — shared by command handlers and tests
// ---------------------------------------------------------------------------

import type { SearchResult } from "../../domain/types";

/** Default columns for search output. */
export const SEARCH_COLUMNS = [
  "match_type", "path", "score", "type", "title", "content",
  "tags", "chunk", "blake3", "ast", "meta", "timestamps",
  "model_scores", "embedding",
] as const;

export type SearchColumn = (typeof SEARCH_COLUMNS)[number];

export interface ParsedArgs {
  command: string;
  args: string[];
  flags: Record<string, string>;
}

/**
 * Parse command-line arguments into a structured command.
 * Supports both `--flag value` and `-s value` syntax.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) return { command: "help", args: [], flags: {} };

  const validCommands = [
    "search", "pack", "chunk", "embed",
    "watch", "watch-daemon", "stats", "clear", "init", "sync", "mcp",
    "--help", "-h",
  ];
  const first = argv[0] ?? "";

  if (first === "--help" || first === "-h" || !validCommands.includes(first)) {
    return { command: "help", args: [], flags: {} };
  }

  const command = first;
  const rest = argv.slice(1);
  const args: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = rest[i + 1];
      if (value && !value.startsWith("-")) {
        flags[key] = value;
        i++;
      } else {
        flags[key] = "true";
      }
    } else if (arg.startsWith("-") && !arg.startsWith("--")) {
      const key = arg.slice(1);
      const value = rest[i + 1];
      if (value && !value.startsWith("-")) {
        flags[key] = value;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      args.push(arg);
    }
  }

  return { command, args, flags };
}

/**
 * Format search results as JSON lines — one JSON object per line.
 */
export function formatSearchResults(results: SearchResult[], columns: SearchColumn[]): string {
  return results
    .map((r) => {
      const s = r.source;
      const obj: Record<string, unknown> = {};
      for (const col of columns) {
        switch (col) {
          case "match_type":  obj.match_type = r.match_type; break;
          case "path":        obj.path = s.path; break;
          case "score":       obj.score = r.score; break;
          case "type":        obj.type = s.type; break;
          case "title":       obj.title = s.title; break;
          case "content":     obj.content = s.content; break;
          case "tags":        obj.tags = s.tags; break;
          case "chunk":       obj.chunk_index = s.chunk_index; obj.total_chunks = s.total_chunks; break;
          case "blake3":      obj.file_blake3 = s.file_blake3; obj.semantic_blake3 = s.semantic_blake3; break;
          case "ast": {
            const meta = s.metadata;
            obj.ast = meta.kind === "code" && meta.ast ? meta.ast : null;
            break;
          }
          case "meta":        obj.metadata = s.metadata; break;
          case "timestamps":  obj.created_at = s.created_at; obj.updated_at = s.updated_at; break;
          case "model_scores": obj.model_scores = r.model_scores ?? null; break;
          case "embedding":   obj.embedding = s.embeddings; break;
        }
      }
      return JSON.stringify(obj);
    })
    .join("\n");
}

/**
 * Parse the --columns flag. Returns default columns if not set.
 */
export function parseColumns(raw?: string): SearchColumn[] {
  if (!raw) return ["match_type", "path", "score"];
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter((c): c is SearchColumn => (SEARCH_COLUMNS as readonly string[]).includes(c));
}
