import { describe, expect, test } from "bun:test";

import type { SourceParserRegistry } from "../../../src/domain/ports/SourceParserRegistry";
import type { SourceParser } from "../../../src/domain/ports/SourceParser";

describe("SourceParserRegistry interface", () => {
  test("register and getParser roundtrip", () => {
    const tsParser: SourceParser = {
      type: "code",
      extensions: [".ts"],
      supportsFile: (path: string) => path.endsWith(".ts"),
      parse: async (path: string) => ({
        type: "code",
        path,
        content: "",
        tags: [],
        metadata: { kind: "code", language: "typescript" },
        file_blake3: "hash",
        last_parsed: "2026-01-01T00:00:00.000Z",
      }),
    };

    const parsers: SourceParser[] = [];
    const registry: SourceParserRegistry = {
      getParser(path: string) {
        return parsers.find((p) => p.supportsFile(path)) ?? null;
      },
      register(parser: SourceParser) {
        parsers.push(parser);
      },
    };

    registry.register(tsParser);
    const found = registry.getParser("/file.ts");
    expect(found).not.toBeNull();
    expect(found!.type).toBe("code");
    expect(found!.extensions).toContain(".ts");
  });

  test("getParser returns null for unsupported files", () => {
    const registry: SourceParserRegistry = {
      getParser() {
        return null;
      },
      register() {},
    };

    expect(registry.getParser("/unknown.xyz")).toBeNull();
  });

  test("multiple parsers can be registered", () => {
    const mdParser: SourceParser = {
      type: "markdown",
      extensions: [".md"],
      supportsFile: (path: string) => path.endsWith(".md"),
      parse: async () => ({
        type: "markdown",
        path: "",
        content: "",
        tags: [],
        metadata: { kind: "markdown" },
        file_blake3: "h",
        last_parsed: "2026-01-01T00:00:00.000Z",
      }),
    };

    const parsers: SourceParser[] = [mdParser];
    const registry: SourceParserRegistry = {
      getParser(path: string) {
        return parsers.find((p) => p.supportsFile(path)) ?? null;
      },
      register(parser: SourceParser) {
        parsers.push(parser);
      },
    };

    expect(registry.getParser("/doc.md")).not.toBeNull();
    expect(registry.getParser("/doc.txt")).toBeNull();
  });
});
