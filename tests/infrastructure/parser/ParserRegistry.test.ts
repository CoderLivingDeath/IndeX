import { describe, it, expect, beforeAll } from "bun:test";
import { ParserRegistry } from "../../../src/infrastructure/parser/ParserRegistry";
import { MarkdownParser } from "../../../src/infrastructure/parser/MarkdownParser";
import { ObsidianParser } from "../../../src/infrastructure/parser/ObsidianParser";
import { AstGrepParser } from "../../../src/infrastructure/parser/AstGrepParser";

describe("ParserRegistry", () => {
  let registry: ParserRegistry;
  let mdParser: MarkdownParser;
  let obsParser: ObsidianParser;
  let tsParser: AstGrepParser;

  beforeAll(() => {
    registry = new ParserRegistry();
    mdParser = new MarkdownParser();
    obsParser = new ObsidianParser();
    tsParser = new AstGrepParser();

    registry.register(mdParser);
    registry.register(obsParser);
    registry.register(tsParser);
  });

  it("getParser('.ts') returns AstGrepParser", () => {
    const parser = registry.getParser("tests/fixtures/sample-function.ts");
    expect(parser).toBe(tsParser);
  });

  it("getParser('.tsx') returns AstGrepParser", () => {
    // Use a real-ish path — extension-based, content doesn't matter here
    const parser = registry.getParser("tests/fixtures/component.tsx");
    expect(parser).toBe(tsParser);
  });

  it("getParser('.md') with Obsidian frontmatter returns ObsidianParser", () => {
    const parser = registry.getParser("tests/fixtures/obsidian-note.md");
    expect(parser).toBe(obsParser);
  });

  it("getParser('.md') without Obsidian frontmatter returns MarkdownParser", () => {
    const parser = registry.getParser("tests/fixtures/simple-note.md");
    expect(parser).toBe(mdParser);
  });

  it("getParser('.md') with tags frontmatter returns ObsidianParser", () => {
    const parser = registry.getParser("tests/fixtures/note-with-tags.md");
    expect(parser).toBe(obsParser);
  });

  it("getParser('.py') returns null for unsupported extension", () => {
    const parser = registry.getParser("script.py");
    expect(parser).toBeNull();
  });

  it("getParser('.unknown') returns null", () => {
    const parser = registry.getParser("file.unknown");
    expect(parser).toBeNull();
  });

  it("getEnabledParsers() returns all registered parsers (unique)", () => {
    const parsers = registry.getEnabledParsers();
    // 3 unique parser instances: MarkdownParser, ObsidianParser, AstGrepParser
    expect(parsers.length).toBe(3);
    expect(parsers).toContain(mdParser);
    expect(parsers).toContain(obsParser);
    expect(parsers).toContain(tsParser);
  });

  it("getEnabledParsers() excludes parsers with enabled=false", () => {
    const disabledParser = new AstGrepParser();
    (disabledParser as any).enabled = false;
    registry.register(disabledParser);
    const parsers = registry.getEnabledParsers();
    expect(parsers).not.toContain(disabledParser);
    expect(parsers.length).toBe(3); // still 3, disabled one excluded
  });
});
