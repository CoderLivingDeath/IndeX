import { describe, expect, test } from "bun:test";

import type {
  SymbolKind,
  SymbolDetail,
  Import,
  Export,
  Relationship,
  FileIndex,
} from "../../src/domain/ast";

// ---------------------------------------------------------------------------
// SymbolKind
// ---------------------------------------------------------------------------
describe("SymbolKind", () => {
  test("all SymbolKind values are valid strings", () => {
    const kinds: SymbolKind[] = [
      "function",
      "class",
      "interface",
      "type",
      "enum",
      "variable",
      "method",
      "property",
      "parameter",
      "module",
    ];
    expect(kinds).toHaveLength(10);
    expect(kinds).toEqual([
      "function",
      "class",
      "interface",
      "type",
      "enum",
      "variable",
      "method",
      "property",
      "parameter",
      "module",
    ]);
  });

  test("exhaustive switch over SymbolKind (compile-time check)", () => {
    // If a new kind is added without a case, TS will error.
    const describeKind = (kind: SymbolKind): string => {
      switch (kind) {
        case "function":
          return "fn";
        case "class":
          return "cls";
        case "interface":
          return "iface";
        case "struct":
          return "struct";
        case "type":
          return "type";
        case "enum":
          return "enum";
        case "variable":
          return "var";
        case "method":
          return "method";
        case "property":
          return "prop";
        case "parameter":
          return "param";
        case "module":
          return "mod";
      }
    };
    expect(describeKind("function")).toBe("fn");
    expect(describeKind("class")).toBe("cls");
    expect(describeKind("module")).toBe("mod");
  });
});

// ---------------------------------------------------------------------------
// SymbolDetail
// ---------------------------------------------------------------------------
describe("SymbolDetail", () => {
  test("full symbol detail with all fields", () => {
    const sym: SymbolDetail = {
      kind: "function",
      name: "handleRequest",
      signature: "handleRequest(req: Request): Response",
      startPosition: { line: 10, column: 2 },
      endPosition: { line: 25, column: 1 },
    };
    expect(sym.kind).toBe("function");
    expect(sym.name).toBe("handleRequest");
    expect(sym.signature).toContain("Request");
    expect(sym.startPosition).toEqual({ line: 10, column: 2 });
    expect(sym.endPosition).toEqual({ line: 25, column: 1 });
  });

  test("class symbol detail", () => {
    const sym: SymbolDetail = {
      kind: "class",
      name: "UserService",
      signature: "class UserService",
      startPosition: { line: 1, column: 0 },
      endPosition: { line: 50, column: 0 },
    };
    expect(sym.kind).toBe("class");
    expect(sym.name).toBe("UserService");
  });

  test("interface symbol detail", () => {
    const sym: SymbolDetail = {
      kind: "interface",
      name: "SourceRepository",
      signature: "interface SourceRepository",
      startPosition: { line: 5, column: 0 },
      endPosition: { line: 20, column: 0 },
    };
    expect(sym.kind).toBe("interface");
    expect(sym.name).toBe("SourceRepository");
  });

  test("positions are zero-based or file-specific numbers", () => {
    const sym: SymbolDetail = {
      kind: "variable",
      name: "config",
      signature: "const config: Config",
      startPosition: { line: 0, column: 0 },
      endPosition: { line: 0, column: 20 },
    };
    expect(sym.startPosition.line).toBeGreaterThanOrEqual(0);
    expect(sym.startPosition.column).toBeGreaterThanOrEqual(0);
    expect(sym.endPosition.line).toBeGreaterThanOrEqual(0);
    expect(sym.endPosition.column).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
describe("Import", () => {
  test("named import", () => {
    const imp: Import = {
      source: "lodash",
      specifiers: ["merge", "cloneDeep"],
      kind: "named",
    };
    expect(imp.source).toBe("lodash");
    expect(imp.specifiers).toEqual(["merge", "cloneDeep"]);
    expect(imp.kind).toBe("named");
  });

  test("default import", () => {
    const imp: Import = {
      source: "express",
      specifiers: ["express"],
      kind: "default",
    };
    expect(imp.source).toBe("express");
    expect(imp.kind).toBe("default");
  });

  test("namespace import", () => {
    const imp: Import = {
      source: "zod",
      specifiers: ["z"],
      kind: "namespace",
    };
    expect(imp.source).toBe("zod");
    expect(imp.kind).toBe("namespace");
  });

  test("empty specifiers list", () => {
    const imp: Import = {
      source: "side-effect-lib",
      specifiers: [],
      kind: "named",
    };
    expect(imp.specifiers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
describe("Export", () => {
  test("named export", () => {
    const exp: Export = {
      name: "SourceData",
      kind: "named",
    };
    expect(exp.name).toBe("SourceData");
    expect(exp.kind).toBe("named");
  });

  test("default export", () => {
    const exp: Export = {
      name: "default",
      kind: "default",
    };
    expect(exp.name).toBe("default");
    expect(exp.kind).toBe("default");
  });

  test("all export (re-export)", () => {
    const exp: Export = {
      name: "*",
      kind: "all",
    };
    expect(exp.name).toBe("*");
    expect(exp.kind).toBe("all");
  });
});

// ---------------------------------------------------------------------------
// Relationship
// ---------------------------------------------------------------------------
describe("Relationship", () => {
  test("calls relationship", () => {
    const rel: Relationship = {
      type: "calls",
      source: "handleRequest",
      target: "authenticate",
    };
    expect(rel.type).toBe("calls");
    expect(rel.source).toBe("handleRequest");
    expect(rel.target).toBe("authenticate");
  });

  test("extends relationship", () => {
    const rel: Relationship = {
      type: "extends",
      source: "AdminController",
      target: "BaseController",
    };
    expect(rel.type).toBe("extends");
  });

  test("implements relationship", () => {
    const rel: Relationship = {
      type: "implements",
      source: "MyRepository",
      target: "SourceRepository",
    };
    expect(rel.type).toBe("implements");
  });

  test("imports relationship", () => {
    const rel: Relationship = {
      type: "imports",
      source: "src/service.ts",
      target: "src/types.ts",
    };
    expect(rel.type).toBe("imports");
  });

  test("exports relationship", () => {
    const rel: Relationship = {
      type: "exports",
      source: "src/index.ts",
      target: "src/types.ts",
    };
    expect(rel.type).toBe("exports");
  });

  test("all relationship types are covered", () => {
    const types: Relationship["type"][] = [
      "calls",
      "extends",
      "implements",
      "imports",
      "exports",
    ];
    expect(types).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// FileIndex
// ---------------------------------------------------------------------------
describe("FileIndex", () => {
  const fileIndex: FileIndex = {
    path: "/src/main.ts",
    file_blake3: "abc123def456",
    language: "typescript",
    imports: [
      { source: "lodash", specifiers: ["merge"], kind: "named" },
      { source: "express", specifiers: ["express"], kind: "default" },
    ],
    exports: [
      { name: "app", kind: "named" },
      { name: "config", kind: "named" },
    ],
    symbols: [
      {
        kind: "function",
        name: "startServer",
        signature: "startServer(port: number): Server",
        startPosition: { line: 15, column: 0 },
        endPosition: { line: 30, column: 1 },
      },
      {
        kind: "variable",
        name: "PORT",
        signature: "const PORT: number",
        startPosition: { line: 5, column: 0 },
        endPosition: { line: 5, column: 15 },
      },
    ],
    relationships: [
      { type: "imports", source: "/src/main.ts", target: "lodash" },
    ],
    last_parsed: "2026-01-10T08:00:00.000Z",
  };

  test("has all required fields", () => {
    expect(fileIndex.path).toBeDefined();
    expect(fileIndex.file_blake3).toBeDefined();
    expect(fileIndex.language).toBeDefined();
    expect(fileIndex.imports).toBeDefined();
    expect(fileIndex.exports).toBeDefined();
    expect(fileIndex.symbols).toBeDefined();
    expect(fileIndex.relationships).toBeDefined();
    expect(fileIndex.last_parsed).toBeDefined();
  });

  test("path and hash are strings", () => {
    expect(typeof fileIndex.path).toBe("string");
    expect(typeof fileIndex.file_blake3).toBe("string");
    expect(typeof fileIndex.language).toBe("string");
  });

  test("imports array contains typed entries", () => {
    expect(fileIndex.imports).toHaveLength(2);
    fileIndex.imports.forEach((imp) => {
      expect(typeof imp.source).toBe("string");
      expect(Array.isArray(imp.specifiers)).toBe(true);
      expect(["named", "default", "namespace"]).toContain(imp.kind);
    });
  });

  test("exports array contains typed entries", () => {
    expect(fileIndex.exports).toHaveLength(2);
    fileIndex.exports.forEach((exp) => {
      expect(typeof exp.name).toBe("string");
      expect(["named", "default", "all"]).toContain(exp.kind);
    });
  });

  test("symbols array contains typed entries", () => {
    expect(fileIndex.symbols).toHaveLength(2);
    fileIndex.symbols.forEach((sym) => {
      expect(typeof sym.name).toBe("string");
      expect(typeof sym.signature).toBe("string");
      expect(sym.startPosition).toHaveProperty("line");
      expect(sym.startPosition).toHaveProperty("column");
      expect(sym.endPosition).toHaveProperty("line");
      expect(sym.endPosition).toHaveProperty("column");
    });
  });

  test("relationships array contains typed entries", () => {
    expect(fileIndex.relationships).toHaveLength(1);
    fileIndex.relationships.forEach((rel) => {
      expect(typeof rel.source).toBe("string");
      expect(typeof rel.target).toBe("string");
      expect(["calls", "extends", "implements", "imports", "exports"]).toContain(
        rel.type,
      );
    });
  });

  test("last_parsed is ISO 8601", () => {
    expect(fileIndex.last_parsed).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  test("can have empty arrays", () => {
    const empty: FileIndex = {
      path: "/src/empty.ts",
      file_blake3: "hash",
      language: "typescript",
      imports: [],
      exports: [],
      symbols: [],
      relationships: [],
      last_parsed: "2026-01-01T00:00:00.000Z",
    };
    expect(empty.imports).toEqual([]);
    expect(empty.exports).toEqual([]);
    expect(empty.symbols).toEqual([]);
    expect(empty.relationships).toEqual([]);
  });
});
