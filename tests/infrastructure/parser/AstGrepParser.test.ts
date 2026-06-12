import { describe, it, expect } from "bun:test";
import { AstGrepParser } from "../../../src/infrastructure/parser/AstGrepParser";

describe("AstGrepParser", () => {
  const parser = new AstGrepParser();
  const fixturePathTs = "tests/fixtures/sample-function.ts";
  const fixturePathPy = "tests/fixtures/sample-function.py";
  const fixturePathJson = "tests/fixtures/sample.json";

  // ── TypeScript ────────────────────────────────────────────────────────

  it("parses sample-function.ts with type 'code'", async () => {
    const result = await parser.parse(fixturePathTs);
    expect(result.type).toBe("code");
  });

  it("language includes 'typescript'", async () => {
    const result = await parser.parse(fixturePathTs);
    expect(result.metadata.kind).toBe("code");
    if (result.metadata.kind === "code") {
      expect(result.metadata.language).toBe("typescript");
    }
  });

  it("extracts symbols: at least 1 function and 1 class", async () => {
    const result = await parser.parse(fixturePathTs);
    expect(result.fileIndex).toBeDefined();
    expect(result.fileIndex!.symbols.length).toBeGreaterThanOrEqual(3);

    const functions = result.fileIndex!.symbols.filter(
      (s) => s.kind === "function",
    );
    const classes = result.fileIndex!.symbols.filter((s) => s.kind === "class");
    const interfaces = result.fileIndex!.symbols.filter(
      (s) => s.kind === "interface",
    );

    expect(functions.length).toBeGreaterThanOrEqual(1);
    expect(classes.length).toBe(1);
    expect(interfaces.length).toBe(1);
  });

  it("populates FileIndex with imports", async () => {
    const result = await parser.parse(fixturePathTs);
    expect(result.fileIndex).toBeDefined();
    expect(result.fileIndex!.imports.length).toBeGreaterThanOrEqual(2);

    const utilsImport = result.fileIndex!.imports.find(
      (i) => i.source === "./utils",
    );
    expect(utilsImport).toBeDefined();
    expect(utilsImport!.specifiers).toContain("something");

    const fsImport = result.fileIndex!.imports.find((i) => i.source === "fs");
    expect(fsImport).toBeDefined();
  });

  it("populates FileIndex with exports", async () => {
    const result = await parser.parse(fixturePathTs);
    expect(result.fileIndex).toBeDefined();
    expect(result.fileIndex!.exports.length).toBeGreaterThanOrEqual(2);

    const fnExport = result.fileIndex!.exports.find(
      (e) => e.name === "calculateTotal",
    );
    expect(fnExport).toBeDefined();
    expect(fnExport!.kind).toBe("named");

    const defaultExport = result.fileIndex!.exports.find(
      (e) => e.kind === "default",
    );
    expect(defaultExport).toBeDefined();
  });

  it("computes complexity metrics: lines, functions, classes", async () => {
    const result = await parser.parse(fixturePathTs);
    expect(result.metadata.kind).toBe("code");
    if (result.metadata.kind === "code") {
      expect(result.metadata.complexity).toBeDefined();
      expect(result.metadata.complexity!.lines).toBeGreaterThan(0);
      expect(result.metadata.complexity!.functions).toBeGreaterThanOrEqual(1);
      expect(result.metadata.complexity!.classes).toBe(1);
    }
  });

  it("extracts top-level declarations", async () => {
    const result = await parser.parse(fixturePathTs);
    expect(result.metadata.kind).toBe("code");
    if (result.metadata.kind === "code") {
      expect(result.metadata.topLevelDeclarations).toBeDefined();
      expect(result.metadata.topLevelDeclarations!.length).toBeGreaterThanOrEqual(3);
      expect(result.metadata.topLevelDeclarations).toContain("User");
      expect(result.metadata.topLevelDeclarations).toContain("UserService");
      expect(result.metadata.topLevelDeclarations).toContain("greet");
      expect(result.metadata.topLevelDeclarations).toContain("calculateTotal");
    }
  });

  it("file_blake3 is a 64-character hex string", async () => {
    const result = await parser.parse(fixturePathTs);
    expect(result.file_blake3).toMatch(/^[0-9a-f]{64}$/);
  });

  // ── Python ────────────────────────────────────────────────────────────

  it("parses sample-function.py with type 'code'", async () => {
    const result = await parser.parse(fixturePathPy);
    expect(result.type).toBe("code");
  });

  it("language includes 'python'", async () => {
    const result = await parser.parse(fixturePathPy);
    expect(result.metadata.kind).toBe("code");
    if (result.metadata.kind === "code") {
      expect(result.metadata.language).toBe("python");
    }
  });

  it("extracts Python symbols: 1 function and 1 class", async () => {
    const result = await parser.parse(fixturePathPy);
    expect(result.fileIndex).toBeDefined();

    const functions = result.fileIndex!.symbols.filter(
      (s) => s.kind === "function",
    );
    const classes = result.fileIndex!.symbols.filter((s) => s.kind === "class");

    expect(functions.length).toBeGreaterThanOrEqual(1);
    expect(classes.length).toBe(1);

    // Verify specific names
    const fnNames = functions.map((s) => s.name);
    expect(fnNames).toContain("calculate_total");

    const clsNames = classes.map((s) => s.name);
    expect(clsNames).toContain("DataProcessor");
  });

  it("extracts Python imports: import and from-import", async () => {
    const result = await parser.parse(fixturePathPy);
    expect(result.fileIndex).toBeDefined();
    expect(result.fileIndex!.imports.length).toBeGreaterThanOrEqual(2);

    const osImport = result.fileIndex!.imports.find((i) => i.source === "os");
    expect(osImport).toBeDefined();
    expect(osImport!.specifiers).toContain("*");

    const pathlibImport = result.fileIndex!.imports.find(
      (i) => i.source === "pathlib",
    );
    expect(pathlibImport).toBeDefined();
    expect(pathlibImport!.specifiers).toContain("Path");

    // Alias import: import json as json_lib
    const jsonImport = result.fileIndex!.imports.find(
      (i) => i.source === "json",
    );
    expect(jsonImport).toBeDefined();
  });

  it("computes Python complexity metrics", async () => {
    const result = await parser.parse(fixturePathPy);
    expect(result.metadata.kind).toBe("code");
    if (result.metadata.kind === "code") {
      expect(result.metadata.complexity).toBeDefined();
      expect(result.metadata.complexity!.lines).toBeGreaterThan(0);
      expect(result.metadata.complexity!.functions).toBeGreaterThanOrEqual(1);
      expect(result.metadata.complexity!.classes).toBe(1);
    }
  });

  it("extracts Python top-level declarations", async () => {
    const result = await parser.parse(fixturePathPy);
    expect(result.metadata.kind).toBe("code");
    if (result.metadata.kind === "code") {
      expect(result.metadata.topLevelDeclarations).toBeDefined();
      expect(result.metadata.topLevelDeclarations).toContain("calculate_total");
      expect(result.metadata.topLevelDeclarations).toContain("DataProcessor");
    }
  });

  it("Python file_blake3 is a 64-character hex string", async () => {
    const result = await parser.parse(fixturePathPy);
    expect(result.file_blake3).toMatch(/^[0-9a-f]{64}$/);
  });

  // ── JSON ──────────────────────────────────────────────────────────────

  it("parses sample.json with type 'code'", async () => {
    const result = await parser.parse(fixturePathJson);
    expect(result.type).toBe("code");
  });

  it("language includes 'json'", async () => {
    const result = await parser.parse(fixturePathJson);
    expect(result.metadata.kind).toBe("code");
    if (result.metadata.kind === "code") {
      expect(result.metadata.language).toBe("json");
    }
  });

  it("extracts JSON top-level keys as declarations", async () => {
    const result = await parser.parse(fixturePathJson);
    expect(result.metadata.kind).toBe("code");
    if (result.metadata.kind === "code") {
      expect(result.metadata.topLevelDeclarations).toBeDefined();
      expect(result.metadata.topLevelDeclarations).toContain("name");
      expect(result.metadata.topLevelDeclarations).toContain("version");
      expect(result.metadata.topLevelDeclarations).toContain("description");
    }
  });

  it("JSON has no symbols (no functions/classes)", async () => {
    const result = await parser.parse(fixturePathJson);
    expect(result.fileIndex).toBeDefined();
    expect(result.fileIndex!.symbols.length).toBe(0);
    expect(result.fileIndex!.imports.length).toBe(0);
    expect(result.fileIndex!.exports.length).toBe(0);
  });

  it("JSON file_blake3 is a 64-character hex string", async () => {
    const result = await parser.parse(fixturePathJson);
    expect(result.file_blake3).toMatch(/^[0-9a-f]{64}$/);
  });

  // ── supportsFile ──────────────────────────────────────────────────────

  it("supportsFile returns true for supported extensions", () => {
    expect(parser.supportsFile("file.ts")).toBe(true);
    expect(parser.supportsFile("file.tsx")).toBe(true);
    expect(parser.supportsFile("file.js")).toBe(true);
    expect(parser.supportsFile("file.py")).toBe(true);
    expect(parser.supportsFile("file.json")).toBe(true);
    expect(parser.supportsFile("file.md")).toBe(false);
  });
});
