// ---------------------------------------------------------------------------
// indeX sync [dir] — synchronise index with file system
//
// Uses a tree-snapshot hash (BLAKE3) to quickly detect changes.
//   • Files deleted from disk  → removed from index (prune)
//   • New / modified files     → re-indexed
// ---------------------------------------------------------------------------

import { resolve } from "path";
import type { Command } from "commander";
import { loadApp } from "../app-loader";

export function registerSync(program: Command): void {
  program
    .command("sync [dir]")
    .description("Synchronise index with file system (prune stale, re-index changed)")
    .action(async (dir?: string) => {
      const directory = resolve(dir || ".");
      const app = await loadApp();
      const result = await app.sync.execute(directory);

      if (result.previousHash === result.currentHash) {
        console.log("Tree snapshot unchanged — index is up to date.");
      } else {
        console.log(
          `Sync complete: ${result.deleted} deleted, ` +
          `${result.indexed} indexed, ${result.skipped} skipped, ` +
          `${result.errors} errors`,
        );
      }
    });
}
