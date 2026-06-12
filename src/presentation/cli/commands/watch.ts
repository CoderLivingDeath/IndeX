// ---------------------------------------------------------------------------
// indeX watch start/stop/status + watch-daemon (hidden)
// ---------------------------------------------------------------------------

import type { Command } from "commander";
import { startWatch, stopWatch, statusWatch } from "../../../watch/index";
import { runDaemon } from "../../../watch/WatchDaemon";

export function registerWatch(program: Command): void {
  const watch = program
    .command("watch")
    .description("Watch directory for changes");

  watch
    .command("start <dir>")
    .description("Start watching directory for changes (daemon)")
    .option("--port <n>", "Health server port")
    .action(async (dir: string, options: { port?: string }) => {
      const port = options.port ? parseInt(options.port, 10) : undefined;
      if (port !== undefined && (isNaN(port) || port < 1 || port > 65535)) {
        console.error("Error: --port must be a valid port number (1-65535)");
        return;
      }
      await startWatch(dir, port);
    });

  watch
    .command("stop")
    .description("Stop the watch daemon")
    .action(async () => {
      await stopWatch();
    });

  watch
    .command("status")
    .description("Show watch daemon status")
    .action(async () => {
      await statusWatch();
    });

  // Hidden command — used internally by startWatch to spawn the daemon
  program
    .command("watch-daemon")
    .description("(internal)", { hidden: true })
    .option("--dir <path>", "Directory to watch")
    .action(async (options: { dir?: string }) => {
      const dir = options.dir ?? process.cwd();
      await runDaemon(dir);
    });
}
