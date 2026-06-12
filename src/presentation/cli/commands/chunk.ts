// ---------------------------------------------------------------------------
// indeX chunk <path>
// ---------------------------------------------------------------------------

import type { Command } from "commander";
import { loadApp } from "../app-loader";

export function registerChunk(program: Command): void {
  program
    .command("chunk <path>")
    .description("Chunk files in directory")
    .action(async (path: string) => {
      const app = await loadApp();
      const chunks = await app.chunk.execute(path);
      console.log(`Chunked into ${chunks.length} chunks`);
    });
}
