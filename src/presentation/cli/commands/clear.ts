// ---------------------------------------------------------------------------
// indeX clear — lightweight, no heavy imports
// ---------------------------------------------------------------------------

import { rmSync } from "fs";
import { resolve } from "path";
import type { Command } from "commander";

export function registerClear(program: Command): void {
  program
    .command("clear")
    .description("Clear all indexed data")
    .action(() => {
      const dbDir = resolve(".indeX", "index.lancedb");
      rmSync(dbDir, { recursive: true, force: true });
      console.log("Index cleared.");
    });
}
