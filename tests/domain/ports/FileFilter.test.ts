import { describe, expect, test } from "bun:test";

import type { FileFilter } from "../../../src/domain/ports/FileFilter";

describe("FileFilter interface", () => {
  test("all properties and methods are present", () => {
    const mock: FileFilter = {
      formats: [".ts", ".tsx", ".js"],
      include: ["src/**/*"],
      exclude: ["node_modules/**/*"],
      shouldInclude: (path: string) => path.startsWith("src/"),
    };

    expect(Array.isArray(mock.formats)).toBe(true);
    expect(mock.formats).toContain(".ts");
    // include/exclude are optional but when present are arrays
    expect(Array.isArray(mock.include)).toBe(true);
    expect(Array.isArray(mock.exclude)).toBe(true);
    expect(typeof mock.shouldInclude).toBe("function");
  });

  test("shouldInclude returns boolean for included files", () => {
    const mock: FileFilter = {
      formats: [".ts", ".js"],
      include: ["src/**/*"],
      shouldInclude: (path: string) =>
        path.startsWith("src/") &&
        mock.formats.some((ext) => path.endsWith(ext)),
    };

    expect(mock.shouldInclude("src/main.ts")).toBe(true);
    expect(mock.shouldInclude("src/util.js")).toBe(true);
    expect(mock.shouldInclude("node_modules/pkg/index.ts")).toBe(false);
    expect(mock.shouldInclude("src/main.txt")).toBe(false);
  });

  test("include and exclude are optional", () => {
    const mock: FileFilter = {
      formats: [".ts"],
      shouldInclude: () => true,
    };

    expect(mock.include).toBeUndefined();
    expect(mock.exclude).toBeUndefined();
    expect(mock.shouldInclude("any.ts")).toBe(true);
  });

  test("shouldInclude with exclusion logic", () => {
    const mock: FileFilter = {
      formats: [".ts", ".md"],
      exclude: ["test/**/*"],
      shouldInclude: (path: string) =>
        mock.formats.some((ext) => path.endsWith(ext)) &&
        !path.startsWith("test/"),
    };

    expect(mock.shouldInclude("src/app.ts")).toBe(true);
    expect(mock.shouldInclude("README.md")).toBe(true);
    expect(mock.shouldInclude("test/app.test.ts")).toBe(false);
  });
});
