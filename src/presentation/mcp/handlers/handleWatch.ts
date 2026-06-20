// ---------------------------------------------------------------------------
// handleWatch — MCP tool handlers for watch_start, watch_status, watch_stop
// ---------------------------------------------------------------------------

import type { McpDependencies } from "../IndeXMcpServer";

interface WatchStartArgs {
  dir: string;
  port?: number;
}

export async function handleWatchStart(args: Record<string, unknown>, _deps: McpDependencies) {
  const { dir, port } = args as unknown as WatchStartArgs;

  const { startWatch } = await import("../../../watch/index");

  try {
    await startWatch(dir, port);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "started", directory: dir }),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "error", message: String(err) }),
        },
      ],
      isError: true,
    };
  }
}

export async function handleWatchStatus(_args: Record<string, unknown>, _deps: McpDependencies) {
  const { loadWatchConfig } = await import("../../../watch/WatchConfig");

  try {
    const config = loadWatchConfig();
    if (!config) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ status: "not_configured" }),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            directory: config.directory,
            pid: config.pid,
            status: config.status,
            started_at: config.started_at,
          }, null, 2),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "error", message: String(err) }),
        },
      ],
      isError: true,
    };
  }
}

export async function handleWatchStop(_args: Record<string, unknown>, _deps: McpDependencies) {
  const { stopWatch } = await import("../../../watch/index");

  try {
    await stopWatch();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "stopped" }),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "error", message: String(err) }),
        },
      ],
      isError: true,
    };
  }
}
