// ---------------------------------------------------------------------------
// WatchDaemon — Background process that watches a directory for file changes.
//
// Invoked via:
//   dev mode:   bun run src/watch/WatchDaemon.ts --dir <directory>
//   compiled:   indeX watch-daemon --dir <directory>
//
// Keeps running until SIGTERM / SIGINT, then cleans up gracefully.
// ---------------------------------------------------------------------------

import { loadWatchConfig, saveWatchConfig, getWatchConfigPath, isProcessAlive, DEFAULT_IGNORED_PATTERNS } from "./WatchConfig";
import { startHealthServer } from "./WatchHealthServer";
import type { HealthServer } from "./WatchHealthServer";

/**
 * Run the watch daemon for the given directory.
 *
 * Loads the watch config, instantiates the full app via `createApp()`,
 * starts ChokidarWatcher (via WatchUseCase), writes its PID to config,
 * and blocks until a termination signal is received.
 */
export async function runDaemon(directory: string): Promise<void> {
  const configPath = getWatchConfigPath();
  let config = loadWatchConfig(configPath);

  // ── Guard: refuse if another daemon is already registered ────
  if (config?.pid && config.pid !== process.pid) {
    if (isProcessAlive(config.pid)) {
      console.error(`Error: another daemon is already running (PID: ${config.pid}).`);
      console.error("Stop it first with 'watch stop'.");
      process.exit(1);
    }
  }

  // ── Init config with "starting" status ──────────────────────
  // Write PID + status BEFORE the heavy import so the CLI can immediately
  // see that the daemon is alive (via `watch status`).
  if (!config) {
    config = {
      directory,
      pid: null,
      status: "starting",
      started_at: null,
      options: { debounce_ms: 500, ignored: [...DEFAULT_IGNORED_PATTERNS] },
    };
  }
  config.pid = process.pid;
  config.status = "starting";
  config.directory = directory;
  saveWatchConfig(config, configPath);

  // ── Import heavy modules ────────────────────────────────────
  // The composition root loads all services (parsers, embedders, LanceDB, chokidar).
  // In a compiled exe this is fast (~50ms) because everything is pre-bundled.
  const { createApp } = await import("../index");
  const { PinoLogger } = await import("../infrastructure/logger/PinoLogger");

  const pino = new PinoLogger({ level: "info", pretty: false });
  pino.info(`Watch daemon starting for ${directory}`);

  // ── Mark as running (heavy imports completed) ───────────────
  config.status = "running";
  config.started_at = new Date().toISOString();
  saveWatchConfig(config, configPath);

  // ── Signal handlers (registered early so no signal is missed) ──
  // These use `app` and `healthServer` which are initialized below.
  let healthServer: HealthServer | null = null;
  let app: ReturnType<typeof createApp> | null = null;

  const shutdown = async (signal: string) => {
    pino.info(`Received ${signal}, shutting down...`);
    healthServer?.setWatcherStatus("stopped");

    try {
      await app?.watch.stop();
    } catch (err) {
      pino.warn(`Watcher stop error: ${err}`);
    }

    try {
      await healthServer?.stop();
    } catch (err) {
      pino.warn(`Health server stop error: ${err}`);
    }

    const c = loadWatchConfig(configPath) ?? config!;
    c.pid = null;
    c.status = "stopped";
    c.started_at = null;
    c.health_port = null;
    saveWatchConfig(c, configPath);

    pino.info("Watch daemon stopped");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // ── Create the full application ─────────────────────────────
  // Pass watchDir + watchIgnored so ChokidarWatcher watches the correct
  // directory and ignores internal files (.indeX/, node_modules/, etc.).
  app = createApp({
    pretty: false,
    watchDir: directory,
    watchIgnored: [...DEFAULT_IGNORED_PATTERNS],
  });

  // ── Health server (start BEFORE watcher for faster CLI feedback) ──
  try {
    const requestedPort = config.options.requested_health_port ?? undefined;
    healthServer = startHealthServer(directory, pino, requestedPort);
    config.health_port = healthServer.port;
    saveWatchConfig(config, configPath);
  } catch (err) {
    pino.warn(`Failed to start health server: ${err}`);
  }

  // ── Start watcher ───────────────────────────────────────────
  try {
    await app.watch.execute(directory);
    pino.info(`Watch daemon started (PID: ${process.pid})`);
  } catch (err) {
    pino.error(`Failed to start watcher: ${err}`);
    config = loadWatchConfig(configPath) ?? config;
    config.status = "error";
    config.pid = null;
    saveWatchConfig(config, configPath);
    process.exit(1);
  }

  // Keep running — chokidar holds the event loop open.
  // The process exits via the SIGTERM/SIGINT handlers above.
}

// ── CLI entry point (dev mode only — compiled exe goes through cli.ts) ──

if (import.meta.main) {
  const args = process.argv.slice(2);
  // Parse --dir from args (handles any flag order)
  const dirFlagIndex = args.indexOf("--dir");
  const directory =
    dirFlagIndex >= 0 && args[dirFlagIndex + 1]
      ? args[dirFlagIndex + 1]!
      : process.cwd();

  runDaemon(directory).catch((err) => {
    console.error("Watch daemon crashed:", err);
    process.exit(1);
  });
}
