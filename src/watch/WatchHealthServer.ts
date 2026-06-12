// ---------------------------------------------------------------------------
// WatchHealthServer — HTTP health endpoint for the watch daemon.
//
// Provides a lightweight HTTP server (127.0.0.1, random port) so the CLI can
// verify the daemon is alive and functioning via an actual request, not just
// a PID check.
// ---------------------------------------------------------------------------

import type { Logger } from "../domain/ports/Logger";

// ── Types ────────────────────────────────────────────────────────────

export interface HealthInfo {
  status: "ok";
  pid: number;
  directory: string;
  uptime_seconds: number;
  watcher_status: "running" | "stopped" | "error";
}

export interface HealthServer {
  /** The port the server is listening on. */
  port: number;
  /** Stop the server. */
  stop(): Promise<void>;
  /** Update the watcher status (called when watcher stops). */
  setWatcherStatus(status: HealthInfo["watcher_status"]): void;
}

// ── Server ───────────────────────────────────────────────────────────

/**
 * Start a lightweight HTTP health server on 127.0.0.1.
 *
 * @param directory  The watched directory (reported in health info).
 * @param logger     Logger instance.
 * @param port       Desired port, or 0/undefined for a random available port.
 *
 * Endpoints:
 *   GET /api/health  → JSON with daemon health info
 *   POST /api/shutdown → Triggers graceful shutdown (caller must also signal)
 */
export function startHealthServer(directory: string, logger: Logger, port?: number): HealthServer {
  const startTime = Date.now();
  let watcherStatus: HealthInfo["watcher_status"] = "running";

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: port ?? 0, // use requested port or random available
    reusePort: false,
    fetch(req) {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/api/health") {
        const info: HealthInfo = {
          status: "ok",
          pid: process.pid,
          directory,
          uptime_seconds: Math.round((Date.now() - startTime) / 1000),
          watcher_status: watcherStatus,
        };
        return new Response(JSON.stringify(info, null, 2), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (req.method === "POST" && url.pathname === "/api/shutdown") {
        // Don't exit here — the caller (signal handler) does the full cleanup.
        // Just respond and let the caller send SIGTERM.
        logger.info("Health server received shutdown request");
        return new Response(JSON.stringify({ status: "shutting_down" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  logger.info(`Health server started on 127.0.0.1:${server.port}`);

  return {
    port: server.port,
    stop: async () => {
      server.stop(true); // true = close active connections
    },
    setWatcherStatus: (status) => {
      watcherStatus = status;
    },
  };
}

/**
 * Fetch health info from a running daemon.
 * Returns `null` if the daemon is unreachable or doesn't respond in time.
 */
export async function fetchHealthInfo(port: number): Promise<HealthInfo | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    // Basic shape check
    if (typeof data !== "object" || data === null) return null;
    const d = data as Record<string, unknown>;
    if (d.status !== "ok" || typeof d.pid !== "number") return null;
    return data as HealthInfo;
  } catch {
    // Connection refused, timeout, etc.
    return null;
  }
}
