import { describe, it, expect } from "bun:test";
import { ObsidianParser } from "../../../src/infrastructure/parser/ObsidianParser";
import type { WikiLink } from "../../../src/infrastructure/parser/types";

describe("ObsidianParser", () => {
  const parser = new ObsidianParser();
  const fixturePath = "tests/fixtures/obsidian-note.md";

  it("parses obsidian-note.md with type 'obsidian'", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.type).toBe("obsidian");
  });

  it("extracts title from frontmatter as 'My Obsidian Note'", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.metadata.kind).toBe("obsidian");
    if (result.metadata.kind === "obsidian") {
      // Title is not directly in obsidian metadata kind — but the frontmatter
      // is stored. We validate via the frontmatter field.
      expect(result.metadata.frontmatter).toBeDefined();
      expect(result.metadata.frontmatter?.title).toBe("My Obsidian Note");
    }
  });

  it("extracts tags from frontmatter: ['daily', 'journal']", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.tags).toEqual(["daily", "journal"]);
    if (result.metadata.kind === "obsidian") {
      expect(result.metadata.tags).toEqual(["daily", "journal"]);
    }
  });

  it("extracts wiki-links [[target]] and [[target|alias]]", async () => {
    const result = await parser.parse(fixturePath);
    const od = result.metadata as typeof result.metadata & {
      wikiLinks: WikiLink[];
    };
    expect(od.wikiLinks).toBeDefined();
    expect(od.wikiLinks.length).toBe(3);

    const plainLink = od.wikiLinks.find((w) => w.target === "typescript-generics");
    expect(plainLink).toBeDefined();
    expect(plainLink!.alias).toBeUndefined();

    const aliasLink = od.wikiLinks.find(
      (w) => w.target === "dependency-injection",
    );
    expect(aliasLink).toBeDefined();
    expect(aliasLink!.alias).toBe("DI patterns");

    const dailyLink = od.wikiLinks.find((w) => w.target === "daily/2024-01-14");
    expect(dailyLink).toBeDefined();
  });

  it("content excludes frontmatter (does not start with '---')", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.content).not.toMatch(/^---\n/);
    // Content should start with the actual note body
    expect(result.content.trimStart().startsWith("# My Obsidian Note")).toBe(true);
  });

  it("backlinks and graphConnections are empty arrays", async () => {
    const result = await parser.parse(fixturePath);
    const od = result.metadata as typeof result.metadata & {
      backlinks: string[];
      graphConnections: string[];
    };
    expect(od.backlinks).toEqual([]);
    expect(od.graphConnections).toEqual([]);
  });

  it("file_blake3 is a 64-character hex string", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.file_blake3).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hasFrontmatter static method detects YAML frontmatter", () => {
    expect(ObsidianParser.hasFrontmatter("---\ntitle: Test\n---\nContent")).toBe(true);
    expect(ObsidianParser.hasFrontmatter("# No frontmatter")).toBe(false);
  });
});
