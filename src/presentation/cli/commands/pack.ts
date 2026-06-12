// ---------------------------------------------------------------------------
// indeX pack <path>
// ---------------------------------------------------------------------------

import type { Command } from "commander";
import { loadApp } from "../app-loader";

export function registerPack(program: Command): void {
  program
    .command("pack <path>")
    .description("Pack files into Markdown bundle")
    .option("-o, --output <file>", "Output file (default: stdout)")
    .option("--include <pattern>", "Include files matching glob (comma-separated)")
    .option("--exclude <pattern>", "Exclude files matching glob (comma-separated)")
    .action(async (path: string, options: { output?: string; include?: string; exclude?: string }) => {
      const app = await loadApp();
      const include = options.include?.split(",").filter(Boolean);
      const exclude = options.exclude?.split(",").filter(Boolean);
      const packed = await app.pack.execute(path, { include, exclude });

      if (options.output) {
        await Bun.write(options.output, packed.markdown);
        console.log(`Packed ${packed.chunks_used} files → ${options.output} (${packed.total_tokens} tokens)`);
      } else {
        console.log(packed.markdown);
      }
    });
}
