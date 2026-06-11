// ---------------------------------------------------------------------------
// AstGrepParser — Phase 3
// Parses TypeScript/JavaScript source files into ParsedSource + FileIndex data.
// Uses @ast-grep/napi for AST-level queries.
// ---------------------------------------------------------------------------

import type { SourceParser } from "../../domain/ports/SourceParser";
import type { ParsedSource, SourceType } from "../../domain/types";
import type {
  FileIndex,
  SymbolDetail,
  Import,
  Export,
} from "../../domain/ast";
import { BLAKE3Hasher } from "../hashing/BLAKE3Hasher";
import { parse, Lang } from "@ast-grep/napi";

// ── Dynamic language registration (C# etc.) ─────────────────────

let csharpRegistered = false;

function ensureCsharpRegistered(): void {
  if (csharpRegistered) return;
  try {
    const { registerDynamicLanguage } = require("@ast-grep/napi") as typeof import("@ast-grep/napi");
    const csharpLang = require("@ast-grep/lang-csharp") as {
      libraryPath: string;
      extensions: string[];
      languageSymbol?: string;
      expandoChar?: string;
    };
    registerDynamicLanguage({
      csharp: {
        libraryPath: csharpLang.libraryPath,
        extensions: csharpLang.extensions ?? [".cs"],
      },
    });
    csharpRegistered = true;
  } catch {
    // C# language support not available — .cs files will fall through
  }
}

/**
 * Determine language from file extension.
 */
function determineLanguage(path: string): string {
  if (path.endsWith(".cs")) return "csharp";
  if (path.endsWith(".tsx")) return "typescriptreact";
  if (path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".jsx")) return "javascriptreact";
  if (path.endsWith(".js")) return "javascript";
  return "typescript";
}

/**
 * Strip surrounding quotes from a string.
 */
function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}

/**
 * Extracts the import source from an import_statement node by looking for
 * a `string` child (the module path).
 */
function getImportSource(node: {
  children(): { kind(): string; text(): string }[];
}): string {
  for (const c of node.children()) {
    if (c.kind() === "string") return stripQuotes(c.text());
  }
  return "";
}

/**
 * Parses TypeScript/JavaScript source files using AST-level queries
 * via @ast-grep/napi.
 *
 * Extracts symbols (functions, classes, interfaces), imports, exports,
 * and complexity metrics.
 */
export class AstGrepParser implements SourceParser {
  readonly type: SourceType = "code";
  readonly extensions = [".ts", ".tsx", ".js", ".jsx", ".cs"];
  private hasher = new BLAKE3Hasher();

  supportsFile(path: string): boolean {
    return this.extensions.some((ext) => path.endsWith(ext));
  }

  async parse(path: string): Promise<ParsedSource> {
    const content = await Bun.file(path).text();
    const lines = content.split("\n");
    const file_blake3 = await this.hasher.hash(content);

    const symbols: SymbolDetail[] = [];
    const imports: Import[] = [];
    const exports: Export[] = [];
    const topLevelDeclarations: string[] = [];

    // Use C# parser for .cs files, TypeScript for everything else
    if (path.endsWith(".cs")) {
      return this.parseCSharp(path, content, lines, file_blake3);
    }

    // Parse source code with @ast-grep/napi (TypeScript/JS)
    const sgRoot = parse(Lang.TypeScript, content);
    const rootChildren = sgRoot.root().children();

    // ---- Extract top-level declarations by iterating root children ---------
    for (const child of rootChildren) {
      const kind = child.kind();
      const text = child.text();

      switch (kind) {
        case "function_declaration": {
          const name = extractFunctionName(child);
          if (!name) break;
          const range = child.range();
          symbols.push({
            kind: "function",
            name,
            signature: extractSignature(content, range),
            startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
            endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
          });
          topLevelDeclarations.push(name);
          break;
        }

        case "class_declaration": {
          const name = extractClassName(child);
          if (!name) break;
          const range = child.range();
          symbols.push({
            kind: "class",
            name,
            signature: "",
            startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
            endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
          });
          topLevelDeclarations.push(name);
          break;
        }

        case "interface_declaration": {
          const name = extractClassName(child);
          if (!name) break;
          const range = child.range();
          symbols.push({
            kind: "interface",
            name,
            signature: "",
            startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
            endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
          });
          topLevelDeclarations.push(name);
          break;
        }

        case "import_statement": {
          const source = getImportSource(child);
          if (!source) break;

          let importKind: "named" | "default" | "namespace" = "default";
          const specifiers: string[] = [];

          // Walk into import_clause to find specifier nodes
          for (const inner of child.children()) {
            if (inner.kind() !== "import_clause") continue;
            for (const clauseChild of inner.children()) {
              const ck = clauseChild.kind();
              if (ck === "named_imports") {
                importKind = "named";
                for (const namedChild of clauseChild.children()) {
                  if (namedChild.kind() === "import_specifier") {
                    for (const specChild of namedChild.children()) {
                      if (specChild.kind() === "identifier") {
                        specifiers.push(specChild.text());
                      }
                    }
                  }
                }
              } else if (ck === "namespace_import") {
                importKind = "namespace";
                for (const nsChild of clauseChild.children()) {
                  if (nsChild.kind() === "identifier") {
                    specifiers.push(nsChild.text());
                  }
                }
              } else if (ck === "identifier") {
                // Default import: import name from "source"
                specifiers.push(clauseChild.text());
              }
            }
          }

          imports.push({ source, specifiers: specifiers.length > 0 ? specifiers : ["default"], kind: importKind });
          break;
        }

        case "export_statement": {
          const innerText = text;

          // Fix #4: export * from "source"
          if (text.includes("export *")) {
            const allSource = getImportSource(child);
            if (allSource) {
              exports.push({ name: allSource, kind: "all" });
              break;
            }
          }

          // Check for "export default"
          if (innerText.startsWith("export default")) {
            // Fix #1: Check inner children for declarations first
            let extractedFromDecl = false;
            for (const inner of child.children()) {
              const innerKind = inner.kind();
              if (innerKind === "function_declaration") {
                const name = extractFunctionName(inner);
                if (name) {
                  const range = inner.range();
                  symbols.push({
                    kind: "function",
                    name,
                    signature: extractSignature(content, range),
                    startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
                    endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
                  });
                  topLevelDeclarations.push(name);
                  exports.push({ name, kind: "default" });
                  extractedFromDecl = true;
                }
                break;
              } else if (innerKind === "class_declaration") {
                const name = extractClassName(inner);
                if (name) {
                  const range = inner.range();
                  symbols.push({
                    kind: "class",
                    name,
                    signature: "",
                    startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
                    endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
                  });
                  topLevelDeclarations.push(name);
                  exports.push({ name, kind: "default" });
                  extractedFromDecl = true;
                }
                break;
              } else if (innerKind === "interface_declaration") {
                const name = extractClassName(inner);
                if (name) {
                  const range = inner.range();
                  symbols.push({
                    kind: "interface",
                    name,
                    signature: "",
                    startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
                    endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
                  });
                  topLevelDeclarations.push(name);
                  exports.push({ name, kind: "default" });
                  extractedFromDecl = true;
                }
                break;
              }
            }

            if (!extractedFromDecl) {
              // Fallback: text-based extraction for identifiers (e.g., export default UserService)
              const afterDefault = innerText.replace(/^export\s+default\s+/, "");
              const defaultName = afterDefault.split(/[;\s{]/)[0];
              if (defaultName && !defaultName.includes("{")) {
                exports.push({ name: defaultName, kind: "default" });
              }
            }
            break;
          }

          // Non-default export: look through children for the inner declaration
          // Fix #1: Also add inner declarations as symbols and topLevelDeclarations
          let exportedName: string | null = null;
          for (const inner of child.children()) {
            const innerKind = inner.kind();
            if (innerKind === "function_declaration") {
              const name = extractFunctionName(inner);
              if (name) {
                exportedName = name;
                const range = inner.range();
                symbols.push({
                  kind: "function",
                  name,
                  signature: extractSignature(content, range),
                  startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
                  endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
                });
                topLevelDeclarations.push(name);
              }
            } else if (innerKind === "class_declaration") {
              const name = extractClassName(inner);
              if (name) {
                exportedName = name;
                const range = inner.range();
                symbols.push({
                  kind: "class",
                  name,
                  signature: "",
                  startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
                  endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
                });
                topLevelDeclarations.push(name);
              }
            } else if (innerKind === "interface_declaration") {
              const name = extractClassName(inner);
              if (name) {
                exportedName = name;
                const range = inner.range();
                symbols.push({
                  kind: "interface",
                  name,
                  signature: "",
                  startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
                  endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
                });
                topLevelDeclarations.push(name);
              }
            }
          }

          // Fallback: regex-based extraction from text (when AST children didn't reveal the name)
          if (!exportedName) {
            const fnMatch = innerText.match(/export\s+(?:async\s+)?function\s+(\w+)/);
            const clsMatch = innerText.match(/export\s+class\s+(\w+)/);
            const ifaceMatch = innerText.match(/export\s+interface\s+(\w+)/);
            const namedMatch = innerText.match(/export\s+(?:type|const|let|var|enum)\s+(\w+)/);
            exportedName = fnMatch?.[1] ?? clsMatch?.[1] ?? ifaceMatch?.[1] ?? namedMatch?.[1] ?? null;
            if (exportedName) {
              topLevelDeclarations.push(exportedName);
            }
          }

          if (exportedName) {
            exports.push({ name: exportedName, kind: "named" });
          }

          // Check for "export { a, b }" (brace export — standalone, no inner declaration)
          if (!exportedName) {
            const braceMatch = innerText.match(/export\s+\{([^}]+)\}/);
            if (braceMatch) {
              const names = braceMatch[1]
                .split(",")
                .map((s: string) => s.trim().replace(/\s+as\s+\w+/g, ""))
                .filter(Boolean);
              for (const name of names) {
                exports.push({ name, kind: "named" });
              }
            }
          }
          break;
        }
      }
    }

    // ---- Build FileIndex ---------------------------------------------------
    const fileIndex: FileIndex = {
      path,
      file_blake3,
      language: determineLanguage(path),
      imports,
      exports,
      symbols,
      relationships: [],
      last_parsed: new Date().toISOString(),
    };

    const functionCount = symbols.filter((s) => s.kind === "function").length;
    const classCount = symbols.filter((s) => s.kind === "class").length;

    return {
      type: "code",
      path,
      content,
      tags: [],
      metadata: {
        kind: "code" as const,
        language: determineLanguage(path),
        complexity: { lines: lines.length, functions: functionCount, classes: classCount },
        topLevelDeclarations,
      },
      file_blake3,
      last_parsed: new Date().toISOString(),
      fileIndex,
    };
  }

  // ── C# parser (via registerDynamicLanguage) ────────────────────

  private async parseCSharp(
    path: string,
    content: string,
    lines: string[],
    file_blake3: string,
  ): Promise<ParsedSource> {
    ensureCsharpRegistered();

    const symbols: SymbolDetail[] = [];
    const imports: Import[] = [];
    const topLevelDeclarations: string[] = [];

    try {
      const sgRoot = parse("csharp" as any, content);

      for (const child of sgRoot.root().children()) {
        const kind = child.kind();
        const text = child.text();
        const range = child.range();

        switch (kind) {
          case "class_declaration": {
            const name = extractCSharpName(child);
            if (!name) break;
            symbols.push({
              kind: "class",
              name,
              signature: "",
              startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
              endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
            });
            topLevelDeclarations.push(name);
            break;
          }

          case "method_declaration": {
            const name = extractCSharpName(child);
            if (!name || name === ".ctor") break;
            const sig = extractSignature(content, range);
            symbols.push({
              kind: "function",
              name,
              signature: sig,
              startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
              endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
            });
            break;
          }

          case "constructor_declaration": {
            const name = extractCSharpName(child);
            if (!name) break;
            symbols.push({
              kind: "function",
              name: `${name}.ctor`,
              signature: extractSignature(content, range),
              startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
              endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
            });
            break;
          }

          case "interface_declaration": {
            const name = extractCSharpName(child);
            if (!name) break;
            symbols.push({
              kind: "interface",
              name,
              signature: "",
              startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
              endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
            });
            topLevelDeclarations.push(name);
            break;
          }

          case "struct_declaration": {
            const name = extractCSharpName(child);
            if (!name) break;
            symbols.push({
              kind: "struct",
              name,
              signature: "",
              startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
              endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
            });
            topLevelDeclarations.push(name);
            break;
          }

          case "enum_declaration": {
            const name = extractCSharpName(child);
            if (!name) break;
            symbols.push({
              kind: "enum",
              name,
              signature: "",
              startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
              endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
            });
            topLevelDeclarations.push(name);
            break;
          }

          case "using_directive": {
            // Extract namespace from `using X.Y.Z;`
            const ns = text.replace(/^using\s+/, "").replace(/;\s*$/, "").trim();
            if (ns) {
              imports.push({ source: ns, specifiers: ["*"], kind: "namespace" });
            }
            break;
          }
        }
      }
    } catch {
      // C# parsing failed — return content without AST
    }

    const functionCount = symbols.filter((s) => s.kind === "function").length;
    const classCount = symbols.filter((s) => s.kind === "class" || s.kind === "struct").length;

    const fileIndex: FileIndex = {
      path,
      file_blake3,
      language: "csharp",
      imports,
      exports: [],
      symbols,
      relationships: [],
      last_parsed: new Date().toISOString(),
    };

    return {
      type: "code",
      path,
      content,
      tags: [],
      metadata: {
        kind: "code" as const,
        language: "csharp",
        complexity: { lines: lines.length, functions: functionCount, classes: classCount },
        topLevelDeclarations,
      },
      file_blake3,
      last_parsed: new Date().toISOString(),
      fileIndex,
    };
  }
}

// ---- Helper functions -------------------------------------------------------

/**
 * Extract the function name from a function_declaration node.
 * The name is typically the first `identifier` child.
 */
function extractFunctionName(node: {
  children(): { kind(): string; text(): string }[];
}): string | null {
  for (const c of node.children()) {
    if (c.kind() === "identifier") return c.text();
  }
  // Fallback: try the function pattern to get NAME
  return null;
}

/**
 * Extract the class/interface name from a declaration node.
 * For class_declaration: first `type_identifier` child.
 * For interface_declaration: first `type_identifier` child.
 */
function extractClassName(node: {
  children(): { kind(): string; text(): string }[];
}): string | null {
  for (const c of node.children()) {
    if (c.kind() === "type_identifier") return c.text();
  }
  return null;
}

/**
 * Extract the function signature (parameter list) from the raw content
 * based on the function's start position.
 */
function extractSignature(content: string, range: { start: { index: number }; end: { index: number } }): string {
  const fnText = content.slice(range.start.index, range.end.index);
  const parenMatch = fnText.match(/\([^)]*\)/);
  return parenMatch ? parenMatch[0] : "";
}

/**
 * Extract the name from a C# declaration node by looking for the first
 * `identifier` or `type_identifier` child.
 */
function extractCSharpName(node: {
  children(): { kind(): string; text(): string }[];
}): string | null {
  for (const c of node.children()) {
    const k = c.kind();
    if (k === "identifier" || k === "type_identifier") return c.text();
  }
  return null;
}
