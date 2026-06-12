// ---------------------------------------------------------------------------
// indeX chunk <path>
// ---------------------------------------------------------------------------

import { resolve } from "path";
import type { Command } from "commander";
import { loadApp } from "../app-loader";

export function registerChunk(program: Command): void {
  program
    .command("chunk <path>")
    .description("Chunk files in directory")
    .action(async (path: string) => {
      const app = await loadApp();
      const resolvedPath = resolve(path);
      const chunks = await app.chunk.execute(resolvedPath);
      console.log(`Chunked into ${chunks.length} chunks`);
    });
}
