// ---------------------------------------------------------------------------
// indeX pack <path>
// ---------------------------------------------------------------------------

import { resolve } from "path";
import type { Command } from "commander";
import { loadApp } from "../app-loader";

export function registerPack(program: Command): void {
  program
    .command("pack <path>")
    .description("Pack files into Markdown bundle")
    .option("-o, --output <file>", "Also write output to file")
    .option("--include <pattern>", "Include files matching glob (comma-separated)")
    .option("--exclude <pattern>", "Exclude files matching glob (comma-separated)")
    .option("--meta", "Include metadata block")
    .option("--ast", "Include AST JSONL section (imports, exports, symbols)")
    .option("--content", "Include code/content block")
    .option("--links", "Include cross-file relationship links")
    .option("--format <type>", 'Output format: "jsonl" (default) or "md"')
    .action(async (
      path: string,
      options: {
        output?: string;
        include?: string;
        exclude?: string;
        meta?: boolean;
        ast?: boolean;
        content?: boolean;
        links?: boolean;
        format?: string;
      },
    ) => {
      const app = await loadApp();
      const resolvedPath = resolve(path);
      const include = options.include?.split(",").filter(Boolean);
      const exclude = options.exclude?.split(",").filter(Boolean);

      // Only flags that were explicitly passed override defaults
      const sectionOpts: Record<string, boolean | undefined> = {};
      for (const key of ["meta", "ast", "content", "links"] as const) {
        if (options[key] !== undefined) sectionOpts[key] = options[key];
      }

      const format = options.format === "md" ? "md" : "jsonl";

      const packed = await app.pack.execute(resolvedPath, {
        include,
        exclude,
        format,
        ...sectionOpts,
      });

      // Always display full output in terminal
      console.log(packed.markdown);

      // Optionally also write to file
      if (options.output) {
        await Bun.write(options.output, packed.markdown);
        console.log(`\nPacked ${packed.chunks_used} files → ${options.output} (${packed.total_tokens} tokens)`);
      }
    });
}
