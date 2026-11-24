// ---------------------------------------------------------------------------
// indeX stats
// ---------------------------------------------------------------------------

import type { Command } from "commander";
import { loadApp } from "../app-loader";

export function registerStats(program: Command): void {
  program
    .command("stats")
    .description("Show index statistics")
    .action(async () => {
      const app = await loadApp();
      const stats = await app.del.stats();
      console.log(`Index statistics:
  Files:    ${stats.total_files}
  Chunks:   ${stats.total_chunks}
  Tokens:   ${stats.total_tokens}
  Reused:   ${stats.total_deduped_chunks}
  Last indexed: ${stats.last_indexed}`);
    });
}
