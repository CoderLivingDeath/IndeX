// ---------------------------------------------------------------------------
// indeX clear — lightweight, no heavy imports
// ---------------------------------------------------------------------------

import { existsSync } from "fs";
import { rm } from "fs/promises";
import { resolve } from "path";
import type { Command } from "commander";

export function registerClear(program: Command): void {
  program
    .command("clear")
    .description("Clear all indexed data")
    .action(async () => {
      const dbDir = resolve(".indeX", "index.lancedb");

      if (!existsSync(dbDir)) {
        console.log("Index cleared.");
        return;
      }

      // rmSync can hang indefinitely on Windows when files are locked.
      // Use async rm with a timeout and retry logic instead.
      try {
        await Promise.race([
          rm(dbDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 }),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error("Timeout after 10s")), 10000),
          ),
        ]);
        console.log("Index cleared.");
      } catch (err) {
        console.error(`Failed to clear index: ${(err as Error).message}`);
        console.error("Files may be locked. Close other processes or reboot.");
        process.exit(1);
      }
    });
}
