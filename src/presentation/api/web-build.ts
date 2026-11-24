// ---------------------------------------------------------------------------
// React web build — bundles web/ into dist/web for the Hono static server.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, statSync } from "fs";
import { rm } from "fs/promises";
import { join } from "path";

const ROOT = join(import.meta.dir, "..", "..", "..");
export const WEB_SOURCE = join(ROOT, "web");
export const WEB_DIST = join(ROOT, "dist", "web");

function newestMtime(target: string): number {
  if (!existsSync(target)) return 0;
  const stat = statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;

  let newest = stat.mtimeMs;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    newest = Math.max(newest, newestMtime(join(target, entry.name)));
  }
  return newest;
}

function isFresh(): boolean {
  const output = join(WEB_DIST, "index.html");
  if (!existsSync(output)) return false;

  const outputMtime = statSync(output).mtimeMs;
  const inputs = [
    newestMtime(WEB_SOURCE),
    newestMtime(join(ROOT, "package.json")),
    newestMtime(join(ROOT, "bun.lock")),
  ];
  return Math.max(...inputs) <= outputMtime;
}

/**
 * Build the React SPA into `dist/web`.
 *
 * Skips the build when the output is newer than every source file.
 */
export async function buildWeb(force = false): Promise<string> {
  if (!force && isFresh()) return WEB_DIST;

  if (!existsSync(join(WEB_SOURCE, "index.html"))) {
    throw new Error(`Web entrypoint not found: ${join(WEB_SOURCE, "index.html")}`);
  }

  await rm(WEB_DIST, { recursive: true, force: true });

  const result = await Bun.build({
    entrypoints: [join(WEB_SOURCE, "index.html")],
    outdir: WEB_DIST,
    target: "browser",
    minify: true,
    sourcemap: "none",
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  });

  if (!result.success) {
    const details = result.logs.map((log) => String(log)).join("\n");
    throw new Error(`Web build failed:\n${details}`);
  }

  return WEB_DIST;
}

if (import.meta.main) {
  const output = await buildWeb(true);
  console.log(`Web UI built → ${output}`);
}
