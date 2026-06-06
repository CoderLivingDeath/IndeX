import { describe, expect, test } from "bun:test";
import { MarkdownAstParser } from "../../../src/infrastructure/markdown/MarkdownAstParser";

describe("MarkdownAstParser", () => {
  const parser = new MarkdownAstParser();

  test("extracts headings with level, text, and anchor", () => {
    const md = `# Title\n\n## Section One\n\n### Subsection\n\nSome content`;
    const headings = parser.parse(md);

    expect(headings).toHaveLength(3);
    expect(headings[0]).toEqual({ level: 1, text: "Title", anchor: "title" });
    expect(headings[1]).toEqual({ level: 2, text: "Section One", anchor: "section-one" });
    expect(headings[2]).toEqual({ level: 3, text: "Subsection", anchor: "subsection" });
  });

  test("generates GitHub-style anchor slugs", () => {
    const md = `# Hello World!\n## Special Characters: @#$%\n### Multiple   Spaces\n`;
    const headings = parser.parse(md);

    expect(headings[0].anchor).toBe("hello-world");
    expect(headings[1].anchor).toBe("special-characters");
    expect(headings[2].anchor).toBe("multiple-spaces");
  });

  test("returns empty array for text without headings", () => {
    const md = `Just a paragraph.\n\nAnother paragraph.`;
    const headings = parser.parse(md);
    expect(headings).toEqual([]);
  });

  test("returns empty array for empty string", () => {
    const headings = parser.parse("");
    expect(headings).toEqual([]);
  });

  test("handles multiple headings at the same level", () => {
    const md = `## A\n## B\n## C`;
    const headings = parser.parse(md);
    expect(headings).toHaveLength(3);
    expect(headings.map((h) => h.text)).toEqual(["A", "B", "C"]);
  });

  test("handles code blocks without extracting code as headings", () => {
    const md = `# Real Heading\n\`\`\`\n# Not a heading\n\`\`\`\n\n## Another Heading`;
    const headings = parser.parse(md);
    expect(headings).toHaveLength(2);
    expect(headings[0].text).toBe("Real Heading");
    expect(headings[1].text).toBe("Another Heading");
  });
});
