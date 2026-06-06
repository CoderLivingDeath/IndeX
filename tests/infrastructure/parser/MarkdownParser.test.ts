import { describe, it, expect } from "bun:test";
import { MarkdownParser } from "../../../src/infrastructure/parser/MarkdownParser";
import type { Heading, Link, MarkdownStats } from "../../../src/infrastructure/parser/types";

describe("MarkdownParser", () => {
  const parser = new MarkdownParser();
  const fixturePath = "tests/fixtures/simple-note.md";

  it("parses simple-note.md with type 'markdown'", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.type).toBe("markdown");
  });

  it("extracts title from H1 as 'Welcome to IndeX'", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.metadata.kind).toBe("markdown");
    if (result.metadata.kind === "markdown") {
      expect(result.metadata.heading).toBe("Welcome to IndeX");
    }
  });

  it("extracts all headings with level, text, and anchor", async () => {
    const result = await parser.parse(fixturePath);
    const md = result.metadata as typeof result.metadata & { headings: Heading[] };
    expect(md.headings).toBeDefined();
    expect(md.headings.length).toBeGreaterThanOrEqual(3);

    const h1 = md.headings.find((h) => h.level === 1);
    expect(h1).toBeDefined();
    expect(h1!.text).toBe("Welcome to IndeX");
    expect(h1!.anchor).toBe("welcome-to-index");

    const h2s = md.headings.filter((h) => h.level === 2);
    expect(h2s.length).toBe(2);
    expect(h2s[0]!.text).toBe("Getting Started");
    expect(h2s[1]!.text).toBe("Features");

    const h3s = md.headings.filter((h) => h.level === 3);
    expect(h3s.length).toBe(1);
    expect(h3s[0]!.text).toBe("Installation");
  });

  it("extracts links with url, text, and isInternal", async () => {
    const result = await parser.parse(fixturePath);
    const md = result.metadata as typeof result.metadata & { links: Link[] };
    expect(md.links).toBeDefined();

    const openCodeLink = md.links.find(
      (l) => l.url === "https://github.com/opencode-ai",
    );
    expect(openCodeLink).toBeDefined();
    expect(openCodeLink!.text).toBe("OpenCode");
    expect(openCodeLink!.isInternal).toBe(false);
    expect(openCodeLink!.isAnchor).toBe(false);
  });

  it("computes stats: wordCount > 0, paragraphCount, codeBlockCount", async () => {
    const result = await parser.parse(fixturePath);
    const md = result.metadata as typeof result.metadata & { stats: MarkdownStats };
    expect(md.stats).toBeDefined();
    expect(md.stats.wordCount).toBeGreaterThan(0);
    expect(md.stats.readingTimeMinutes).toBeGreaterThanOrEqual(1);
    expect(md.stats.paragraphCount).toBeGreaterThan(0);
    expect(md.stats.codeBlockCount).toBe(1);
  });

  it("metadata kind is 'markdown'", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.metadata.kind).toBe("markdown");
  });

  it("tags is empty array", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.tags).toEqual([]);
  });

  it("file_blake3 is a 64-character hex string", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.file_blake3).toMatch(/^[0-9a-f]{64}$/);
  });

  it("content includes all markdown text", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.content).toContain("Welcome to IndeX");
    expect(result.content).toContain("Getting Started");
    expect(result.content).toContain("OpenCode");
  });
});
