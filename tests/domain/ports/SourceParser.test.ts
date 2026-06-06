import { describe, expect, test } from "bun:test";

import type { SourceParser } from "../../../src/domain/ports/SourceParser";

describe("SourceParser interface", () => {
  test("all properties and methods are present on a mock implementation", () => {
    const mock: SourceParser = {
      type: "code",
      extensions: [".ts", ".tsx", ".js"],
      supportsFile: (path: string) => path.endsWith(".ts"),
      parse: async (path: string) => ({
        type: mock.type,
        path,
        content: "",
        tags: [],
        metadata: { kind: "code", language: "typescript" },
        file_blake3: "hash",
        last_parsed: "2026-01-01T00:00:00.000Z",
      }),
    };

    // Properties
    expect(mock.type).toBe("code");
    expect(Array.isArray(mock.extensions)).toBe(true);
    expect(mock.extensions).toContain(".ts");

    // Methods exist
    expect(typeof mock.supportsFile).toBe("function");
    expect(typeof mock.parse).toBe("function");
  });

  test("supportsFile returns boolean", () => {
    const mock: SourceParser = {
      type: "markdown",
      extensions: [".md", ".mdx"],
      supportsFile: (path: string) =>
        mock.extensions.some((ext) => path.endsWith(ext)),
      parse: async () => ({
        type: "markdown",
        path: "/f.md",
        content: "# Hi",
        tags: [],
        metadata: { kind: "markdown" },
        file_blake3: "hash",
        last_parsed: "2026-01-01T00:00:00.000Z",
      }),
    };

    expect(mock.supportsFile("/doc.md")).toBe(true);
    expect(mock.supportsFile("/doc.mdx")).toBe(true);
    expect(mock.supportsFile("/doc.txt")).toBe(false);
  });

  test("parse returns ParsedSource", async () => {
    const mock: SourceParser = {
      type: "code",
      extensions: [".py"],
      supportsFile: () => true,
      parse: async (path: string) => ({
        type: "code",
        path,
        content: 'print("hello")',
        tags: ["python"],
        metadata: { kind: "code", language: "python" },
        file_blake3: "abc",
        last_parsed: "2026-02-01T00:00:00.000Z",
      }),
    };

    const result = await mock.parse("/script.py");
    expect(result.type).toBe("code");
    expect(result.path).toBe("/script.py");
    expect(result.content).toBe('print("hello")');
    expect(result.tags).toEqual(["python"]);
    expect(result.file_blake3).toBe("abc");
  });
});
