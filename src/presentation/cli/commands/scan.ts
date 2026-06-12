// ---------------------------------------------------------------------------
// indeX scan <path> — Dry-run: show which files match the include/exclude
// filters that index/pack/chunk would use.  No heavy imports (no loadApp).
// ---------------------------------------------------------------------------

import { existsSync } from "fs";
import { relative, resolve } from "path";
import type { Command } from "commander";
import { scanDirectory } from "../../../shared/fileUtils";
import { matchesAny, filterByGlob } from "../../../shared/globMatcher";

// ── Defaults (matches createFileFilter in src/index.ts) ──────────────

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".md", ".json", ".cs"];
const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.tmp/**",
  "**/.opencode/**",
  "**/.venv/**",
  "**/__pycache__/**",
  "**/target/**",
  "**/vendor/**",
];

// ── Helpers ─────────────────────────────────────────────────────────

function formatCount(label: string, count: number, total?: number): string {
  const pct = total ? ` (${((count / total) * 100).toFixed(0)}%)` : "";
  return `  ${label}: ${count}${pct}`;
}

function showFileList(files: string[], baseDir: string, label: string): void {
  if (files.length === 0) {
    console.log(`  ${label}: (none)`);
    return;
  }
  console.log(`  ${label}:`);
  for (const f of files) {
    console.log(`    ${relative(baseDir, f).replace(/\\/g, "/")}`);
  }
}

// ── Command registration ────────────────────────────────────────────

export function registerScan(program: Command): void {
  program
    .command("scan <path>")
    .description("Preview which files match include/exclude filters")
    .option(
      "--include <pattern>",
      "Include files matching glob (comma-separated)",
    )
    .option(
      "--exclude <pattern>",
      "Exclude files matching glob (comma-separated)",
    )
    .option(
      "--config-exclude",
      "Also apply default config exclude patterns (node_modules, .git, …)",
    )
    .option(
      "--no-default-exclude",
      "Skip the default extension filter — show ALL files",
    )
    .option("--show-all", "Print every file path in each bucket")
    .action(
      async (
        path: string,
        options: {
          include?: string;
          exclude?: string;
          configExclude?: boolean;
          defaultExclude?: boolean;
          showAll?: boolean;
        },
      ) => {
        const resolvedPath = resolve(path);
        if (!existsSync(resolvedPath)) {
          console.error(`Error: directory not found: ${resolvedPath}`);
          return;
        }

        const baseDir = resolvedPath;
        const showAll = options.showAll ?? false;

        // ── 1. Scan all files ────────────────────────────────────
        const allFiles = scanDirectory(baseDir);
        console.log(`\nScanned ${baseDir}`);
        console.log(formatCount("Total files found", allFiles.length));

        // ── 2. Apply default exclude patterns ────────────────────
        const excludePatterns: string[] = [];
        if (options.configExclude) {
          excludePatterns.push(...DEFAULT_EXCLUDE);
        }
        if (options.exclude) {
          excludePatterns.push(
            ...options.exclude.split(",").map((s) => s.trim()).filter(Boolean),
          );
        }

        let afterExclude = allFiles;
        if (excludePatterns.length > 0) {
          console.log(`\nExclude patterns:`);
          for (const p of excludePatterns) {
            console.log(`  ${p}`);
          }
          afterExclude = allFiles.filter(
            (f) => !matchesAny(excludePatterns, f),
          );
          console.log(
            formatCount(
              "After exclude",
              afterExclude.length,
              allFiles.length,
            ),
          );

          // Show top extensions after exclude (not from full scan, too noisy)
          const extCounts = new Map<string, number>();
          for (const f of afterExclude) {
            const dot = f.lastIndexOf(".");
            const ext = dot >= 0 ? f.slice(dot).toLowerCase() : "(no ext)";
            extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
          }
          const topExts = [...extCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15);
          console.log("  Extensions (top 15):");
          for (const [ext, count] of topExts) {
            console.log(`    ${ext}: ${count}`);
          }
          if (showAll) {
            const excluded = allFiles.filter((f) =>
              matchesAny(excludePatterns, f),
            );
            showFileList(excluded, baseDir, "Excluded files");
          }
        }

        // ── 3. Apply include patterns ────────────────────────────
        const includePatterns = options.include
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        const afterInclude = includePatterns?.length
          ? filterByGlob(afterExclude, { include: includePatterns })
          : afterExclude;

        if (includePatterns?.length) {
          console.log(`\nInclude patterns:`);
          for (const p of includePatterns) {
            console.log(`  ${p}`);
          }
          console.log(
            formatCount(
              "After include",
              afterInclude.length,
              afterExclude.length,
            ),
          );
        }

        // ── 4. Apply extension filter ────────────────────────────
        const extFilter = options.defaultExclude !== false;
        const matched = extFilter
          ? afterInclude.filter((f) =>
              DEFAULT_EXTENSIONS.some((ext) => f.endsWith(ext)),
            )
          : afterInclude;

        if (extFilter) {
          console.log(
            `\nExtension filter: ${DEFAULT_EXTENSIONS.join(", ")}`,
          );
          console.log(
            formatCount(
              "Indexable files (final)",
              matched.length,
              allFiles.length,
            ),
          );
          if (showAll) {
            const skipped = afterInclude.filter(
              (f) => !DEFAULT_EXTENSIONS.some((ext) => f.endsWith(ext)),
            );
            showFileList(skipped, baseDir, "Skipped by extension");
          }
        } else {
          console.log(
            `\nExtension filter: disabled (--no-default-exclude)`,
          );
          console.log(
            formatCount("Final (all files)", matched.length),
          );
        }

        // ── 5. Show final list ───────────────────────────────────
        if (matched.length > 0) {
          console.log(
            `\nFiles that WILL be processed (${matched.length}):`,
          );
          // Group by directory for compact display
          const dirGroups = new Map<string, string[]>();
          for (const f of matched) {
            const rel = relative(baseDir, f).replace(/\\/g, "/");
            const lastSlash = rel.lastIndexOf("/");
            const dir = lastSlash >= 0 ? rel.slice(0, lastSlash) : ".";
            if (!dirGroups.has(dir)) dirGroups.set(dir, []);
            dirGroups.get(dir)!.push(lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel);
          }

          const sortedDirs = [...dirGroups.keys()].sort();
          for (const dir of sortedDirs) {
            const files = dirGroups.get(dir)!;
            console.log(`  ${dir}/ (${files.length})`);
            if (showAll) {
              for (const f of files) {
                console.log(`    ${f}`);
              }
            }
          }
        } else {
          console.log("\nNo files matched all filters.");
        }
      },
    );
}
