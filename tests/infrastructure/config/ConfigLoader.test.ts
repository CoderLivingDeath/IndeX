// ---------------------------------------------------------------------------
// ConfigLoader — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ConfigLoader } from "../../../src/config/ConfigLoader";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "config-loader-test-"));
  // Create the .indeX subdirectory
  mkdirSync(join(dir, ".indeX"), { recursive: true });
  return dir;
}

function writeConfig(dir: string, content: string): string {
  const p = join(dir, ".indeX", "config.json");
  writeFileSync(p, content, "utf-8");
  return p;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("ConfigLoader", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = createTempDir();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── test 1: load() with valid config ─────────────────────────
  test("load() with valid config returns Config", () => {
    writeConfig(
      tmpDir,
      JSON.stringify({
        models: [
          {
            name: "nomic-embed-text",
            dimensions: 768,
            provider: "ollama",
          },
        ],
        universal_model: "nomic-embed-text",
      }),
    );
    const config = ConfigLoader.load(join(tmpDir, ".indeX", "config.json"));
    expect(config.models).toHaveLength(1);
    expect(config.models[0]!.name).toBe("nomic-embed-text");
    expect(config.universal_model).toBe("nomic-embed-text");
    // Defaults should be applied
    expect(config.embedder.batch_size).toBe(10);
    expect(config.chunking.default_strategy).toBe("heading");
    expect(config.search.default_mode).toBe("hybrid");
  });

  // ── test 2: loadOrDefault() without config file → defaults ───
  test("loadOrDefault() without config file returns defaults", () => {
    const config = ConfigLoader.loadOrDefault(
      join(tmpDir, "nonexistent", "config.json"),
    );
    expect(config.models).toHaveLength(1);
    expect(config.models[0]!.name).toBe("nomic-embed-text");
    expect(config.universal_model).toBe("nomic-embed-text");
    expect(config.embedder.batch_size).toBe(10);
    expect(config.chunking.default_strategy).toBe("heading");
    expect(config.search.default_mode).toBe("hybrid");
  });

  // ── test 3: load() with broken JSON → descriptive error ───────
  test("load() with broken JSON throws descriptive Zod error", () => {
    writeConfig(tmpDir, "{ invalid json }");
    expect(() =>
      ConfigLoader.load(join(tmpDir, ".indeX", "config.json")),
    ).toThrow();
  });

  // ── test 4: invalid model config (missing required fields) ────
  test("invalid model config (missing required fields) throws validation error", () => {
    writeConfig(
      tmpDir,
      JSON.stringify({
        models: [
          {
            // missing name, dimensions, provider
            baseUrl: "http://localhost:11434",
          },
        ],
        universal_model: "test-model",
      }),
    );
    expect(() =>
      ConfigLoader.load(join(tmpDir, ".indeX", "config.json")),
    ).toThrow();
  });

  // ── test 5: universal_model validated to be in models[] ───────
  test("universal_model validated to be in models[]", () => {
    writeConfig(
      tmpDir,
      JSON.stringify({
        models: [
          {
            name: "model-a",
            dimensions: 384,
            provider: "ollama",
          },
        ],
        universal_model: "model-b", // not in models[]
      }),
    );
    expect(() =>
      ConfigLoader.load(join(tmpDir, ".indeX", "config.json")),
    ).toThrow();
  });
});
