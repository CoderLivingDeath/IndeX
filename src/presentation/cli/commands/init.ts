// ---------------------------------------------------------------------------
// indeX init — Create .indeX/config.json with default configuration
//
// Lightweight command (no native imports) — creates the config directory
// and writes the same default config that loadOrDefault() returns.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve, join } from "path";
import type { Command } from "commander";
import { defaultConfig } from "../../../config/ConfigLoader";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Create .indeX/config.json with default configuration")
    .option("--path <dir>", "Target directory (default: current directory)")
    .action(async (options: { path?: string }) => {
      const dir = resolve(options.path ?? ".");
      const configDir = join(dir, ".indeX");
      const configFile = join(configDir, "config.json");

      if (existsSync(configFile)) {
        console.log(`Config already exists: ${configFile}`);
        return;
      }

      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      writeFileSync(configFile, JSON.stringify(defaultConfig, null, 2) + "\n");
      console.log(`Created ${configFile}`);
    });
}
