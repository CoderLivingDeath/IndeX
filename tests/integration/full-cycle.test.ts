// ---------------------------------------------------------------------------
// Integration Test — Full Pipeline: Index → Search → Pack
// Uses real parsers (MarkdownParser) + real chunker (HeadingChunker) +
// mocked storage (MockSourceRepository).
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { createApp } from "../../src/index";
import { MockSourceRepository } from "../mocks/MockSourceRepository";
import { MockEmbedder } from "../mocks/MockEmbedder";

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

describe("Full pipeline integration", () => {
  let tmpDir: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "indeX-integration-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates app with test-mode DI container", () => {
    app = createApp({
      testMode: true,
      repository: new MockSourceRepository(),
      logger: mockLogger,
    });

    expect(app).toBeDefined();
    expect(typeof app.index.execute).toBe("function");
    expect(typeof app.search.execute).toBe("function");
    expect(typeof app.pack.execute).toBe("function");
    expect(typeof app.chunk.execute).toBe("function");
    expect(typeof app.embed.execute).toBe("function");
    expect(typeof app.watch.execute).toBe("function");
    expect(typeof app.del.execute).toBe("function");
  });

  test("indexes a markdown fixture through real parser + chunker", async () => {
    // Create fixture files
    writeFileSync(
      join(tmpDir, "note1.md"),
      `# Title

This is some content about TypeScript.

## Section

More details here.`,
      "utf-8",
    );

    writeFileSync(
      join(tmpDir, "note2.md"),
      `# Another Note

Content about Markdown parsing.`,
      "utf-8",
    );

    const stats = await app.index.execute(tmpDir);
    expect(stats.total_files).toBe(2);
    expect(stats.total_chunks).toBeGreaterThanOrEqual(2);
  });

  test("searches indexed content", async () => {
    const results = await app.search.execute("TypeScript", { mode: "keyword", top_k: 10 });
    expect(Array.isArray(results)).toBe(true);
    // Should find at least the TypeScript-related content
    expect(results.length).toBeGreaterThan(0);
  });

  test("packs files into markdown bundle", async () => {
    const packed = await app.pack.execute(tmpDir, {
      include: ["**/*.md"],
    });
    expect(packed.markdown).toContain("Title");
    expect(packed.markdown).toContain("Another Note");
    expect(packed.chunks_used).toBe(2);
  });
});