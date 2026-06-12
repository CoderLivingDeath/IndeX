// ---------------------------------------------------------------------------
// indeX embed <path>
// ---------------------------------------------------------------------------

import { resolve } from "path";
import type { Command } from "commander";
import { loadApp } from "../app-loader";

export function registerEmbed(program: Command): void {
  program
    .command("embed <path>")
    .description("Generate embeddings for files")
    .action(async (path: string) => {
      const app = await loadApp();
      const resolvedPath = resolve(path);
      await app.embed.execute({ source: "files", directory: resolvedPath });
      console.log(`Embedding complete for ${resolvedPath}`);
    });
}
