// ---------------------------------------------------------------------------
// CLI — Command-line interface for IndeX
// ---------------------------------------------------------------------------

import type { AppUseCases } from "../../index";
import type { SearchResult } from "../../domain/types";

/** Available column names for search output. */
export const SEARCH_COLUMNS = [
  "match_type",
  "path",
  "score",
  "type",
  "title",
  "content",
  "tags",
  "chunk",
  "blake3",
  "ast",
  "meta",
  "timestamps",
  "model_scores",
  "embedding",
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

  const validCommands = ["index", "search", "pack", "chunk", "embed", "watch", "watch-daemon", "stats", "clear", "--help", "-h"];
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
 * Print help text to console.
 */
export function printHelp(): void {
  console.log(`
IndeX — Local code & document indexer

Usage: indeX <command> [args] [flags]

Commands:
  index <path>          Index all supported files in directory
  search <query>        Search indexed content
    --mode <mode>         Search mode: semantic | keyword | hybrid | ast (default: hybrid)
    --top-k <n>           Number of results (default: 10)
    --tags <tags>         Filter by tags (comma-separated)
    --ast                 Shortcut for --mode ast
    --columns <cols>      Columns to display (comma-separated).
                          Available: match_type, path, score, type, title, content,
                          tags, chunk, blake3, ast, meta, timestamps, model_scores,
                          embedding
                          Default: match_type,path,score
  pack <path>           Pack files into Markdown bundle
    -o <file>             Output file (default: stdout)
    --include <pattern>   Include files matching glob (comma-separated)
    --exclude <pattern>   Exclude files matching glob (comma-separated)
  chunk <path>          Chunk files in directory
  embed <path>          Generate embeddings for files
   watch start <path>    Start watching directory for changes (daemon)
     --port <n>            Health server port (default: random)
   watch stop            Stop the watch daemon
   watch status          Show watch daemon status
  stats                 Show index statistics
  clear                 Clear all indexed data
  --help                Show this help message
`);
}

/**
 * Format search results as JSON lines — one JSON object per line, no data
 * transformation. Each object contains only the requested columns.
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
function parseColumns(raw?: string): SearchColumn[] {
  if (!raw) return ["match_type", "path", "score"];
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter((c): c is SearchColumn => (SEARCH_COLUMNS as readonly string[]).includes(c));
}

/**
 * Execute a parsed CLI command against the application.
 */
export async function executeCommand(
  parsed: ParsedArgs,
  app: AppUseCases,
): Promise<void> {
  const { command, args, flags } = parsed;

  switch (command) {
    case "index": {
      const [path] = args;
      if (!path) { console.error("Error: path required"); return; }
      const stats = await app.index.execute(path);
      console.log(`Indexed ${stats.total_files} files, ${stats.total_chunks} chunks (${stats.total_deduped_chunks} deduped)`);
      break;
    }
    case "search": {
      const [query] = args;
      if (!query) { console.error("Error: query required"); return; }
      const mode = flags.ast === "true" ? "ast" : (flags.mode ?? "hybrid");
      const results = await app.search.execute(query, {
        mode: mode as any,
        top_k: flags["top-k"] ? parseInt(flags["top-k"], 10) : 10,
      });
      if (results.length === 0) {
        console.log("No results found.");
        break;
      }
      const columns = parseColumns(flags.columns);
      // Default compact format for backward compatibility
      if (!flags.columns) {
        for (const r of results) {
          console.log(`[${r.match_type}] ${r.source.path} — score: ${r.score.toFixed(3)}`);
        }
      } else {
        console.log(formatSearchResults(results, columns));
      }
      break;
    }
    case "pack": {
      const [path] = args;
      if (!path) { console.error("Error: path required"); return; }
      const include = flags.include?.split(",").filter(Boolean);
      const exclude = flags.exclude?.split(",").filter(Boolean);
      const packed = await app.pack.execute(path, { include, exclude });
      const output = flags.o;
      if (output) {
        await Bun.write(output, packed.markdown);
        console.log(`Packed ${packed.chunks_used} files → ${output} (${packed.total_tokens} tokens)`);
      } else {
        console.log(packed.markdown);
      }
      break;
    }
    case "chunk": {
      const [path] = args;
      if (!path) { console.error("Error: path required"); return; }
      const chunks = await app.chunk.execute(path);
      console.log(`Chunked into ${chunks.length} chunks`);
      break;
    }
    case "embed": {
      const [path] = args;
      if (!path) { console.error("Error: path required"); return; }
      await app.embed.execute({ source: "files", directory: path });
      console.log(`Embedding complete for ${path}`);
      break;
    }
    case "watch": {
      const sub = args[0];
      if (sub === "start") {
        const [dir] = args.slice(1);
        if (!dir) { console.error("Error: directory required. Usage: watch start <dir> [--port N]"); return; }
        const port = flags.port ? parseInt(flags.port, 10) : undefined;
        if (port !== undefined && (isNaN(port) || port < 1 || port > 65535)) {
          console.error("Error: --port must be a valid port number (1-65535)");
          return;
        }
        const { startWatch } = await import("../../watch/index");
        await startWatch(dir, port);
      } else if (sub === "stop") {
        const { stopWatch } = await import("../../watch/index");
        await stopWatch();
      } else if (sub === "status") {
        const { statusWatch } = await import("../../watch/index");
        await statusWatch();
      } else if (sub) {
        // Legacy: `watch <path>` — run in foreground
        await app.watch.execute(sub);
        console.log(`Watching ${sub} for changes...`);
      } else {
        console.error("Usage: watch start <dir> | watch stop | watch status");
      }
      break;
    }
    case "watch-daemon": {
      const dir = flags.dir ?? process.cwd();
      // Port is read by the daemon from config.options.requested_health_port
      const { runDaemon } = await import("../../watch/WatchDaemon");
      await runDaemon(dir);
      break;
    }
    case "stats": {
      const stats = await app.del.stats();
      console.log(`Index statistics:
  Files:    ${stats.total_files}
  Chunks:   ${stats.total_chunks}
  Tokens:   ${stats.total_tokens}
  Deduped:  ${stats.total_deduped_chunks}
  Last indexed: ${stats.last_indexed}`);
      break;
    }
    case "clear": {
      if (app) {
        // Full app loaded — use DeleteUseCase (LanceDB dropAll)
        await app.del.clear();
      } else {
        // Light path — just delete the database directory (fast)
        const { rmSync } = await import("fs");
        const { join } = await import("path");
        const dbDir = join(process.cwd(), ".indeX", "index.lancedb");
        rmSync(dbDir, { recursive: true, force: true });
      }
      console.log("Index cleared.");
      break;
    }
    default:
      printHelp();
  }
}

/**
 * Commands that require the full application (parsers, embedders, DB, etc.).
 */
const APP_COMMANDS = new Set(["index", "search", "pack", "chunk", "embed", "stats"]);

/**
 * Main CLI entry point.
 *
 * Only imports the full application (LanceDB, chokidar, ast-grep, etc.)
 * for commands that actually need it. Watch subcommands (start/stop/status)
 * bypass the heavy import and load only their lightweight handler.
 */
export async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);

  if (parsed.command === "help") {
    printHelp();
    return;
  }

  if (APP_COMMANDS.has(parsed.command)) {
    // Heavy path — loads all native modules (LanceDB, chokidar, ast-grep)
    const { createApp } = await import("../../index");
    const app = createApp({ pretty: true });
    await executeCommand(parsed, app);
  } else {
    // Light path — for watch start/stop/status and watch-daemon
    // that import their own handlers without the full app.
    //
    // Cast is safe: APP_COMMANDS lists all commands that touch `app`.
    await executeCommand(parsed, undefined as unknown as AppUseCases);
  }
}

// Run as entry point
if (import.meta.main) {
  main(process.argv.slice(2)).catch(console.error);
}