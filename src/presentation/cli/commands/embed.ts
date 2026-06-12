// ---------------------------------------------------------------------------
// indeX embed <path>
// ---------------------------------------------------------------------------

import type { Command } from "commander";
import { loadApp } from "../app-loader";

export function registerEmbed(program: Command): void {
  program
    .command("embed <path>")
    .description("Generate embeddings for files")
    .action(async (path: string) => {
      const app = await loadApp();
      await app.embed.execute({ source: "files", directory: path });
      console.log(`Embedding complete for ${path}`);
    });
}
