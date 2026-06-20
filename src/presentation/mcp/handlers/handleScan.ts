// ---------------------------------------------------------------------------
// handleScan — MCP tool handler for `scan`
//
// Replicates the scan logic from the CLI command (lightweight, no loadApp).
// ---------------------------------------------------------------------------

import { existsSync } from "fs";
import { resolve, relative } from "path";
import { scanDirectory } from "../../../shared/fileUtils";
import { matchesAny, filterByGlob } from "../../../shared/globMatcher";

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".md", ".json", ".cs"];

interface ScanArgs {
  path: string;
  include?: string;
  exclude?: string;
}

export async function handleScan(args: Record<string, unknown>, _app: any) {
  const { path, include, exclude } = args as unknown as ScanArgs;

  const resolvedPath = resolve(path);
  if (!existsSync(resolvedPath)) {
    return {
      content: [{ type: "text" as const, text: `Error: directory not found: ${resolvedPath}` }],
      isError: true,
    };
  }

  const allFiles = scanDirectory(resolvedPath);

  // Apply exclude patterns
  const excludePatterns: string[] = [];
  if (exclude) {
    excludePatterns.push(...exclude.split(",").map((s) => s.trim()).filter(Boolean));
  }
  let afterExclude = allFiles;
  if (excludePatterns.length > 0) {
    afterExclude = allFiles.filter((f) => !matchesAny(excludePatterns, f));
  }

  // Apply include patterns
  const includePatterns = include
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const afterInclude = includePatterns?.length
    ? filterByGlob(afterExclude, { include: includePatterns })
    : afterExclude;

  // Apply extension filter
  const matched = afterInclude.filter((f) =>
    DEFAULT_EXTENSIONS.some((ext) => f.endsWith(ext)),
  );

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            total_files: allFiles.length,
            matched_files: matched.length,
            files: matched.map((f) => relative(resolvedPath, f).replace(/\\/g, "/")),
          },
          null,
          2,
        ),
      },
    ],
  };
}
