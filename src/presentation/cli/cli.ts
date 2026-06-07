// ---------------------------------------------------------------------------
// CLI — Command-line interface for IndeX
// ---------------------------------------------------------------------------

import type { AppUseCases } from "../../index";

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

  const validCommands = ["index", "search", "pack", "chunk", "embed", "watch", "stats", "clear", "--help", "-h"];
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
    --mode <mode>         Search mode: semantic | keyword | hybrid (default)
    --top-k <n>           Number of results (default: 10)
    --tags <tags>         Filter by tags (comma-separated)
  pack <path>           Pack files into Markdown bundle
    -o <file>             Output file (default: stdout)
    --include <pattern>   Include files matching glob (comma-separated)
    --exclude <pattern>   Exclude files matching glob (comma-separated)
  chunk <path>          Chunk files in directory
  embed <path>          Generate embeddings for files
  watch <path>          Watch directory for changes
  stats                 Show index statistics
  clear                 Clear all indexed data
  --help                Show this help message
`);
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
      console.log(`Indexed ${stats.total_files} files, ${stats.total_chunks} chunks`);
      break;
    }
    case "search": {
      const [query] = args;
      if (!query) { console.error("Error: query required"); return; }
      const results = await app.search.execute(query, {
        mode: (flags.mode as any) ?? "hybrid",
        top_k: flags["top-k"] ? parseInt(flags["top-k"], 10) : 10,
      });
      for (const r of results) {
        console.log(`[${r.match_type}] ${r.source.path} — score: ${r.score.toFixed(3)}`);
      }
      if (results.length === 0) console.log("No results found.");
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
      const [path] = args;
      if (!path) { console.error("Error: path required"); return; }
      await app.watch.execute(path);
      console.log(`Watching ${path} for changes...`);
      break;
    }
    case "stats": {
      const repo = (app as any).del;
      console.log("Stats requested");
      break;
    }
    case "clear": {
      await app.del.clear();
      console.log("Index cleared.");
      break;
    }
    default:
      printHelp();
  }
}

/**
 * Main CLI entry point.
 */
export async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);

  if (parsed.command === "help") {
    printHelp();
    return;
  }

  const { createApp } = await import("../../index");
  const app = createApp({ pretty: true });
  await executeCommand(parsed, app);
}

// Run as entry point
if (import.meta.main) {
  main(process.argv.slice(2)).catch(console.error);
}