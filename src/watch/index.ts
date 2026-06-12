// ---------------------------------------------------------------------------
// Watch CLI — `watch start`, `watch stop`, `watch status`
//
// Cross-platform daemon process management.
// ---------------------------------------------------------------------------

import { existsSync } from "fs";
import { loadWatchConfig, saveWatchConfig, isProcessAlive, isBunDevMode, DEFAULT_IGNORED_PATTERNS, type WatchConfig } from "./WatchConfig";
import { fetchHealthInfo } from "./WatchHealthServer";

// ── Commands ───────────────────────────────────────────────────────

/**
 * `watch start <directory>` — Spawn a detached daemon process.
 *
 * Enforces: only one watch daemon per `.indeX/` directory.
 *   - Reads `.indeX/watch.json` — if PID is alive → refuses to start.
 *   - The daemon itself also checks for duplicates on startup (belt + suspenders).
 *
 * @param directory  Directory to watch.
 * @param port       Optional health server port (0 or undefined = random).
 */
export async function startWatch(directory: string, port?: number): Promise<void> {
  if (!existsSync(directory)) {
    console.error(`Error: directory not found: ${directory}`);
    process.exit(1);
  }

  // Validate port
  if (port !== undefined && (port < 1 || port > 65535)) {
    console.error("Error: --port must be between 1 and 65535");
    process.exit(1);
  }

  // Check for already-running daemon via config
  const existing = loadWatchConfig();
  if (existing?.pid && existing.status === "running") {
    if (isProcessAlive(existing.pid)) {
      console.error(`Error: daemon already running (PID: ${existing.pid}). Run 'watch stop' first.`);
      process.exit(1);
    }
    // Stale PID — will overwrite
  }

  // Save initial config (daemon will update with its PID on start)
  const config: WatchConfig = {
    directory,
    pid: null,
    status: "starting",
    started_at: null,
    options: {
      debounce_ms: 500,
      ignored: [...DEFAULT_IGNORED_PATTERNS],
      requested_health_port: port ?? null,
    },
  };
  saveWatchConfig(config);

  // Spawn the daemon:
  //   dev mode  → bun run src/watch/WatchDaemon.ts --dir <dir>
  //   compiled  → indeX watch-daemon --dir <dir>
  const bunDev = isBunDevMode();
  const args = bunDev
    ? [process.execPath, "run", "src/watch/WatchDaemon.ts", "--dir", directory]
    : [process.execPath, "watch-daemon", "--dir", directory];

  // Pass --port for visibility (daemon reads port from config, not argv)
  if (port !== undefined) {
    args.push("--port", String(port));
  }

  const child = Bun.spawn(args, {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env },
  });
  child.unref();

  console.log(`Watch daemon starting for ${directory}${child.pid ? ` (PID: ${child.pid})` : ""}`);
  console.log("Config: .indeX/watch.json");
}

/**
 * `watch stop` — Stop the running daemon.
 *
 * Sends SIGTERM (cross-platform via Bun/Node). On Windows, Bun emulates
 * SIGTERM via TerminateProcess; the daemon's shutdown handler runs if
 * Bun's vectored exception handler catches it in time.
 *
 * Falls back gracefully if the process is already dead.
 */
export async function stopWatch(): Promise<void> {
  const config = loadWatchConfig();
  if (!config) {
    console.log("No watch daemon running (config not found).");
    return;
  }

  if (!config.pid) {
    console.log("Watch daemon is not running.");
    config.status = "stopped";
    saveWatchConfig(config);
    return;
  }

  console.log(`Stopping watch daemon (PID: ${config.pid})...`);

  try {
    process.kill(config.pid, "SIGTERM");
  } catch {
    // Process may already be dead — that's fine
  }

  config.pid = null;
  config.status = "stopped";
  config.started_at = null;
  saveWatchConfig(config);

  console.log("Watch daemon stopped.");
}

/**
 * `watch status` — Show daemon info, querying the health endpoint if available.
 */
export async function statusWatch(): Promise<void> {
  const config = loadWatchConfig();
  if (!config) {
    console.log("Watch daemon is not configured.");
    console.log("Run 'watch start <directory>' to start.");
    return;
  }

  const pidAlive = config.pid ? isProcessAlive(config.pid) : false;

  // Try to get detailed health info from the daemon's HTTP endpoint
  let health = null;
  if (pidAlive && config.health_port) {
    health = await fetchHealthInfo(config.health_port);
  }

  console.log("Watch daemon status:");
  console.log(`  Directory: ${config.directory}`);
  console.log(`  PID:       ${config.pid ?? "—"}`);
  console.log(`  Status:    ${config.status}`);
  console.log(`  Started:   ${config.started_at ?? "—"}`);

  if (health) {
    console.log(`  Responding: Yes`);
    console.log(`  Uptime:     ${formatUptime(health.uptime_seconds)}`);
    console.log(`  Watcher:    ${health.watcher_status}`);
  } else if (pidAlive) {
    console.log(`  Responding: No (health endpoint unreachable)`);
    console.log(`  Watcher:    unknown`);
  } else {
    console.log(`  Responding: —`);
    console.log(`  Watcher:    —`);
  }
}

// ── Helpers ────────────────────────────────────────────────────────

/** Format seconds into human-readable uptime. */
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m ${s}s`;
}
