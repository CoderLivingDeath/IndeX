// ---------------------------------------------------------------------------
// indeX search <query>
// ---------------------------------------------------------------------------

import type { Command } from "commander";
import { loadApp } from "../app-loader";
import { formatSearchResults, parseColumns } from "../format";

type SearchMode = "semantic" | "keyword" | "hybrid" | "ast";

const SEARCH_MODES: readonly SearchMode[] = [
  "semantic",
  "keyword",
  "hybrid",
  "ast",
];

function resolveMode(requested: string, astFlag: boolean): SearchMode {
  if (astFlag) return "ast";
  return SEARCH_MODES.includes(requested as SearchMode)
    ? (requested as SearchMode)
    : "hybrid";
}

export function registerSearch(program: Command): void {
  program
    .command("search <query>")
    .description("Search indexed content")
    .option("--mode <mode>", "Search mode: semantic | keyword | hybrid | ast")
    .option("--top-k <n>", "Number of results")
    .option("--tags <tags>", "Filter by tags (comma-separated)")
    .option("--ast", "Shortcut for --mode ast")
    .option("--columns <cols>", "Columns to display (comma-separated)")
    .action(async (
      query: string,
      options: {
        mode?: string;
        topK?: string;
        tags?: string;
        ast?: boolean;
        columns?: string;
      },
    ) => {
      const app = await loadApp();

      // CLI flags override config defaults; otherwise use search.* config.
      const mode = resolveMode(
        options.mode ?? app.config.search.default_mode,
        options.ast ?? false,
      );

      const parsedTopK = options.topK ? parseInt(options.topK, 10) : NaN;
      const topK = Number.isFinite(parsedTopK) && parsedTopK > 0
        ? parsedTopK
        : app.config.search.top_k;

      const tags = options.tags
        ? options.tags.split(",").map((t) => t.trim()).filter(Boolean)
        : undefined;

      const results = await app.search.execute(query, {
        mode,
        top_k: topK,
        ...(tags && tags.length > 0 ? { tags } : {}),
      });

      if (results.length === 0) {
        console.log("No results found.");
        return;
      }

      if (!options.columns) {
        // Default compact format
        for (const r of results) {
          console.log(`[${r.match_type}] ${r.source.path} — score: ${r.score.toFixed(3)}`);
        }
      } else {
        const columns = parseColumns(options.columns);
        console.log(formatSearchResults(results, columns));
      }
    });
}
