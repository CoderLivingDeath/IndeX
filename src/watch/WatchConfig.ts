// ---------------------------------------------------------------------------
// WatchConfig — Optional config file for the watch daemon.
// Stored at `.indeX/watch.json` (separate from the main config).
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { z } from "zod";

// ── Shared constants ─────────────────────────────────────────────

/** Default glob patterns that the watcher should ignore. */
export const DEFAULT_IGNORED_PATTERNS: string[] = [
  "**/.indeX/**",
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.opencode/**",
];

/**
 * Check if a process is alive by PID.
 *
 * Uses `process.kill(pid, 0)` which sends signal 0 (no actual signal).
 * Works cross-platform on Unix and Windows via Bun/Node.
 *
 * **Caveat**: on Windows, PID recycling is fast — a "live" PID could
 * belong to a completely different process that recycled the same ID.
 * For production use, consider a stronger mechanism (named pipe / lock file).
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect whether we are running via `bun run` (dev mode) or compiled .exe.
 *
 * In dev mode: `process.argv[1]` ends with `.ts`
 * In compiled exe: `process.argv[1]` is a subcommand like "watch", "search"
 */
export function isBunDevMode(): boolean {
  return (process.argv[1] ?? "").endsWith(".ts");
}

// ── Schema ─────────────────────────────────────────────────────────

export const WatchConfigSchema = z.object({
  /** Absolute or relative path to the watched directory. */
  directory: z.string(),
  /** OS PID of the running daemon process (null when stopped). */
  pid: z.number().nullable().default(null),
  /** Daemon status. */
  status: z.enum(["running", "stopped", "starting", "error"]).default("stopped"),
  /** ISO 8601 timestamp when the daemon was last started. */
  started_at: z.string().nullable().default(null),
  /** Port for the internal health HTTP server (null when stopped). */
  health_port: z.number().nullable().default(null),
  /** Daemon options. */
  options: z
    .object({
      /** Debounce interval in milliseconds. */
      debounce_ms: z.number().positive().default(500),
      /** Glob patterns to ignore. */
      ignored: z
        .array(z.string())
        .default([...DEFAULT_IGNORED_PATTERNS]),
      /** Requested health server port (null = random available port). */
      requested_health_port: z.number().int().positive().nullable().default(null),
    })
    .default({}),
});

export type WatchConfig = z.infer<typeof WatchConfigSchema>;

// ── Path resolution ────────────────────────────────────────────────

const CONFIG_DIR = ".indeX";

/** Resolve the absolute path to `.indeX/watch.json` relative to `baseDir`. */
export function getWatchConfigPath(baseDir?: string): string {
  const dir = baseDir ?? process.cwd();
  return join(dir, CONFIG_DIR, "watch.json");
}

// ── Load / Save ────────────────────────────────────────────────────

/**
 * Load `.indeX/watch.json`. Returns `null` if the file does not exist.
 * Throws on invalid JSON or schema mismatch.
 */
export function loadWatchConfig(configPath?: string): WatchConfig | null {
  const resolved = configPath ?? getWatchConfigPath();
  if (!existsSync(resolved)) return null;
  const raw = readFileSync(resolved, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  return WatchConfigSchema.parse(parsed);
}

/**
 * Save a watch config to `.indeX/watch.json`. Creates the `.indeX/` directory
 * if it doesn't exist.
 */
export function saveWatchConfig(config: WatchConfig, configPath?: string): void {
  const resolved = configPath ?? getWatchConfigPath();
  const d = dirname(resolved);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  writeFileSync(resolved, JSON.stringify(config, null, 2));
}
