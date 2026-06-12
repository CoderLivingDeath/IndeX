// ---------------------------------------------------------------------------
// indeX search <query>
// ---------------------------------------------------------------------------

import type { Command } from "commander";
import { loadApp } from "../app-loader";
import { formatSearchResults, parseColumns } from "../format";

export function registerSearch(program: Command): void {
  program
    .command("search <query>")
    .description("Search indexed content")
    .option("--mode <mode>", "Search mode: semantic | keyword | hybrid | ast", "hybrid")
    .option("--top-k <n>", "Number of results", "10")
    .option("--tags <tags>", "Filter by tags (comma-separated)")
    .option("--ast", "Shortcut for --mode ast")
    .option("--columns <cols>", "Columns to display (comma-separated)")
    .action(async (query: string, options: { mode?: string; topK?: string; tags?: string; ast?: boolean; columns?: string }) => {
      const app = await loadApp();
      const mode = options.ast ? "ast" : (options.mode ?? "hybrid");
      const results = await app.search.execute(query, {
        mode: mode as any,
        top_k: options.topK ? parseInt(options.topK, 10) : 10,
      });

      if (results.length === 0) {
        console.log("No results found.");
        return;
      }

      const columns = parseColumns(options.columns);
      if (!options.columns) {
        // Default compact format
        for (const r of results) {
          console.log(`[${r.match_type}] ${r.source.path} — score: ${r.score.toFixed(3)}`);
        }
      } else {
        console.log(formatSearchResults(results, columns));
      }
    });
}
