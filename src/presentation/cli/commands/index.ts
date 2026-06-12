// ---------------------------------------------------------------------------
// indeX index <path>
// ---------------------------------------------------------------------------

import type { Command } from "commander";
import { loadApp } from "../app-loader";

export function registerIndex(program: Command): void {
  program
    .command("index <path>")
    .description("Index all supported files in directory")
    .action(async (path: string) => {
      const app = await loadApp();
      const stats = await app.index.execute(path);
      console.log(`Indexed ${stats.total_files} files, ${stats.total_chunks} chunks (${stats.total_deduped_chunks} deduped)`);
    });
}
