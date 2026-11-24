// ---------------------------------------------------------------------------
// indeX embed <path>
// ---------------------------------------------------------------------------

import { resolve } from "path";
import type { Command } from "commander";
import { loadApp } from "../app-loader";

export function registerEmbed(program: Command): void {
  program
    .command("embed <path>")
    .description("Scan, parse, chunk, embed, and save all supported files to LanceDB")
    .action(async (path: string) => {
      const app = await loadApp();
      const resolvedPath = resolve(path);
      const stats = await app.index.execute(resolvedPath);
      console.log(`Indexed ${stats.total_files} files, ${stats.total_chunks} chunks (${stats.total_deduped_chunks} reused)`);
    });
}
