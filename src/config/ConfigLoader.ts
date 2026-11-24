// ---------------------------------------------------------------------------
// ConfigLoader — Phase 9
//
// Reads and validates `.indeX/config.json` via Zod.  Falls back to sensible
// defaults when no config file exists (loadOrDefault).
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from "fs";
import { join, resolve, sep } from "path";
import { z, ZodError } from "zod";

// ── Zod schemas ───────────────────────────────────────────────────

const ModelConfig = z.object({
  name: z.string(),
  dimensions: z.number().positive(),
  provider: z.enum(["ollama", "lancedb"]),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
});

const ConfigSchema = z
  .object({
    models: z.array(ModelConfig).min(1),
    universal_model: z.string(),
    embedder: z
      .object({
        batch_size: z.number().positive().default(10),
        cache_size: z.number().positive().default(100),
      })
      .default({}),
    chunking: z
      .object({
        default_strategy: z
          .enum(["heading", "paragraph", "sentence", "code", "overflow"])
          .default("heading"),
        max_chunk_size: z.number().positive().default(500),
        overlap: z.number().min(0).default(32),
      })
      .default({}),
    search: z
      .object({
        default_mode: z
          .enum(["semantic", "keyword", "hybrid"])
          .default("hybrid"),
        top_k: z.number().positive().default(10),
        hybrid_weight: z.number().min(0).max(1).default(0.7),
      })
      .default({}),
    indexing: z
      .object({
        include: z.array(z.string()).optional(),
        exclude: z.array(z.string()).default([
          "**/node_modules/**",
          "**/.git/**",
          "**/dist/**",
          "**/build/**",
          "**/.tmp/**",
          "**/.opencode/**",
          "**/.indeX/**",
          "**/.venv/**",
          "**/__pycache__/**",
          "**/target/**",
          "**/vendor/**",
        ]),
      })
      .default({}),
  })
  .refine(
    (c) => c.models.some((m) => m.name === c.universal_model),
    (c) => ({
      message: `universal_model "${c.universal_model}" must be one of the configured models: ${c.models.map((m) => m.name).join(", ")}`,
    }),
  );

export type Config = z.infer<typeof ConfigSchema>;

// ── Defaults ──────────────────────────────────────────────────────

export const defaultConfig: Config = {
  models: [{ name: "qllama/multilingual-e5-small", dimensions: 384, provider: "ollama" }],
  universal_model: "qllama/multilingual-e5-small",
  embedder: { batch_size: 10, cache_size: 100 },
  chunking: {
    default_strategy: "heading",
    max_chunk_size: 500,
    overlap: 32,
  },
  search: {
    default_mode: "hybrid",
    top_k: 10,
    hybrid_weight: 0.7,
  },
  indexing: {
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/build/**",
      "**/.tmp/**",
      "**/.opencode/**",
      "**/.indeX/**",
      "**/.venv/**",
      "**/__pycache__/**",
      "**/target/**",
      "**/vendor/**",
    ],
  },
};

// ── Hierarchical config resolution ────────────────────────────────

/**
 * Resolve the config file path using a 3-level hierarchy:
 *
 * 1. **Current directory** — `.indeX/config.json` relative to `startDir`
 * 2. **Parent directories** — walk up from `startDir` looking for `.indeX/config.json`
 * 3. **System config** — `~/.config/indeX/config.json` (cross-platform)
 *
 * @param startDir - Directory to start the search from (default: `process.cwd()`).
 * @returns The absolute path to the first config file found, or `null` if none exists.
 */
export function resolveConfigPath(startDir?: string): string | null {
  const dir = startDir ?? process.cwd();

  // 1. Current directory
  const localPath = join(dir, ".indeX", "config.json");
  if (existsSync(localPath)) return localPath;

  // 2. Walk up parent directories
  let current = resolve(dir);
  while (true) {
    const parent = resolve(current, "..");
    if (parent === current) break; // reached filesystem root
    current = parent;
    const parentPath = join(current, ".indeX", "config.json");
    if (existsSync(parentPath)) return parentPath;
  }

  // 3. System config directory (cross-platform)
  const home = process.env.XDG_CONFIG_HOME
    ?? (process.platform === "win32"
      ? process.env.USERPROFILE
      : process.env.HOME);
  if (home) {
    const systemPath = join(home, ".config", "indeX", "config.json");
    if (existsSync(systemPath)) return systemPath;
  }

  return null;
}

// ── Loader API ────────────────────────────────────────────────────

/**
 * Read a config JSON file, validate it through the Zod schema, and return the
 * typed `Config` object.
 *
 * @param path - Path to the config file (default: `.indeX/config.json` relative
 *               to the current working directory).
 * @throws {ZodError} when the JSON is invalid or does not match the schema.
 * @throws {SyntaxError} when the file contains malformed JSON.
 */
export function load(path?: string): Config {
  const resolved = path ?? ".indeX/config.json";
  const raw = readFileSync(resolved, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ZodError([
      {
        code: z.ZodIssueCode.custom,
        message: `Invalid JSON in config file "${resolved}": ${(err as Error).message}`,
        path: [],
      },
    ]);
  }
  return ConfigSchema.parse(parsed);
}

/**
 * Attempt to load the config file using the 3-level hierarchy:
 *
 * 1. `.indeX/config.json` in the current directory
 * 2. `.indeX/config.json` in parent directories (walking up)
 * 3. `~/.config/indeX/config.json` (system-wide)
 *
 * If no config file is found anywhere, return sensible defaults.
 *
 * @param configPath - Optional explicit path (bypasses hierarchy lookup).
 * @returns A validated `Config` object (real or default).
 */
export function loadOrDefault(configPath?: string): Config {
  const resolved = configPath ?? resolveConfigPath();
  if (!resolved || !existsSync(resolved)) {
    return structuredClone(defaultConfig);
  }
  return load(resolved);
}

// Re-export for convenient external access
export const ConfigLoader = { load, loadOrDefault };
