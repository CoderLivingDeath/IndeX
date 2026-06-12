// ---------------------------------------------------------------------------
// CLI — Command-line interface for IndeX
// ---------------------------------------------------------------------------

import { Command } from "commander";
import { registerSearch } from "./commands/search";
import { registerPack } from "./commands/pack";
import { registerChunk } from "./commands/chunk";
import { registerEmbed } from "./commands/embed";
import { registerStats } from "./commands/stats";
import { registerClear } from "./commands/clear";
import { registerWatch } from "./commands/watch";
import { registerScan } from "./commands/scan";
import { registerInit } from "./commands/init";

// Re-export for backward compatibility (tests)
export { parseArgs, formatSearchResults, SEARCH_COLUMNS } from "./format";
export type { ParsedArgs, SearchColumn } from "./format";

/**
 * Create and configure the Commander program.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name("indeX")
    .description("Local code & document indexer")
    .version("0.1.0")
    .usage("<command> [args] [options]");

  // Register commands — each imports its own dependencies lazily
  registerSearch(program);
  registerPack(program);
  registerChunk(program);
  registerEmbed(program);
  registerStats(program);
  registerClear(program);
  registerWatch(program);
  registerScan(program);
  registerInit(program);

  return program;
}

// Run as entry point
// Commander needs the full process.argv (interpreter + script + user args)
// to correctly identify which part is the command.
// In both dev mode (bun run script.ts) and compiled exe,
// process.argv[0..1] are the interpreter/script paths.
if (import.meta.main) {
  const program = createProgram();
  await program.parseAsync(process.argv);
}
