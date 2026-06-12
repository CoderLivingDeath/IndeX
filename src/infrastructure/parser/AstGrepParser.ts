// ---------------------------------------------------------------------------
// AstGrepParser — Phase 3
// Parses TypeScript/JavaScript/Python/JSON source files into ParsedSource +
// FileIndex data. Uses @ast-grep/napi for AST-level queries.
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
import { initDynamicLanguages, getLanguageForFile } from "./astGrepDynamic";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Strip surrounding quotes from a string.
 */
function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}

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
  return null;
}

/**
 * Extract the class/interface name from a declaration node.
 * For class_declaration/interface_declaration: first `type_identifier` child.
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
function extractSignature(
  content: string,
  range: { start: { index: number }; end: { index: number } },
): string {
  const fnText = content.slice(range.start.index, range.end.index);
  const parenMatch = fnText.match(/\([^)]*\)/);
  return parenMatch ? parenMatch[0] : "";
}

// ── Parser class ───────────────────────────────────────────────────────────

export class AstGrepParser implements SourceParser {
  readonly type: SourceType = "code";
  readonly extensions = [".ts", ".tsx", ".js", ".jsx", ".cs", ".py", ".json"];
  private hasher = new BLAKE3Hasher();
  private dynamicInitialized = false;

  supportsFile(path: string): boolean {
    return this.extensions.some((ext) => path.endsWith(ext));
  }

  async parse(path: string): Promise<ParsedSource> {
    // Init dynamic languages once on first parse
    if (!this.dynamicInitialized) {
      initDynamicLanguages();
      this.dynamicInitialized = true;
    }

    const content = await Bun.file(path).text();
    const lines = content.split("\n");
    const file_blake3 = await this.hasher.hash(content);

    // Dispatch to language-specific parser
    if (path.endsWith(".py")) {
      return this.parsePython(path, content, lines, file_blake3);
    }
    if (path.endsWith(".json")) {
      return this.parseJson(path, content, lines, file_blake3);
    }
    if (path.endsWith(".cs")) {
      return this.parseCSharp(path, content, lines, file_blake3);
    }

    // TypeScript / JavaScript via built-in Lang
    const lang = getLanguageForFile(path);
    const napiLang = lang === "JavaScript" ? Lang.JavaScript : Lang.TypeScript;
    return this.parseTSLike(path, content, lines, file_blake3, napiLang);
  }

  // ── TypeScript/JavaScript parser (built-in Lang) ──────────────────────

  private async parseTSLike(
    path: string,
    content: string,
    lines: string[],
    file_blake3: string,
    lang: Lang,
  ): Promise<ParsedSource> {
    const symbols: SymbolDetail[] = [];
    const imports: Import[] = [];
    const exports: Export[] = [];
    const topLevelDeclarations: string[] = [];

    const sgRoot = parse(lang, content);
    const rootChildren = sgRoot.root().children();

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
          const source = this.getImportSource(child);
          if (!source) break;

          let importKind: "named" | "default" | "namespace" = "default";
          const specifiers: string[] = [];

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
                specifiers.push(clauseChild.text());
              }
            }
          }

          imports.push({
            source,
            specifiers: specifiers.length > 0 ? specifiers : ["default"],
            kind: importKind,
          });
          break;
        }

        case "export_statement": {
          const innerText = text;

          // export * from "source"
          if (text.includes("export *")) {
            const allSource = this.getImportSource(child);
            if (allSource) {
              exports.push({ name: allSource, kind: "all" });
              break;
            }
          }

          // export default
          if (innerText.startsWith("export default")) {
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
              const afterDefault = innerText.replace(/^export\s+default\s+/, "");
              const defaultName = afterDefault.split(/[;\s{]/)[0];
              if (defaultName && !defaultName.includes("{")) {
                exports.push({ name: defaultName, kind: "default" });
              }
            }
            break;
          }

          // Non-default export
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

          // Fallback: regex extraction
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

          // export { a, b }
          if (!exportedName) {
            const braceMatch = innerText.match(/export\s+\{([^}]+)\}/);
            if (braceMatch) {
              const names = braceMatch[1]!
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

    // Build FileIndex
    const fileIndex = this.buildFileIndex(
      path, file_blake3, determineLanguage(path),
      imports, exports, symbols, [],
    );

    return this.buildResult(
      path, content, lines, file_blake3, fileIndex,
      symbols, topLevelDeclarations,
    );
  }

  // ── Python parser ────────────────────────────────────────────────────

  private async parsePython(
    path: string,
    content: string,
    lines: string[],
    file_blake3: string,
  ): Promise<ParsedSource> {
    const symbols: SymbolDetail[] = [];
    const imports: Import[] = [];
    const exports: Export[] = [];
    const topLevelDeclarations: string[] = [];

    const sgRoot = parse("python", content);

    for (const child of sgRoot.root().children()) {
      const kind = child.kind();

      switch (kind) {
        case "function_definition": {
          const name = this.getPythonIdentifier(child);
          if (!name) break;
          const range = child.range();
          symbols.push({
            kind: "function",
            name,
            signature: this.extractPythonSignature(content, range),
            startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
            endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
          });
          topLevelDeclarations.push(name);
          break;
        }

        case "class_definition": {
          const name = this.getPythonIdentifier(child);
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

        case "import_statement": {
          // import os, sys  or  import json as j
          for (const inner of child.children()) {
            if (inner.kind() === "dotted_name") {
              imports.push({
                source: inner.text(),
                specifiers: ["*"],
                kind: "namespace",
              });
            } else if (inner.kind() === "aliased_import") {
              // import json as j  → source is the dotted_name child
              for (const aliasChild of inner.children()) {
                if (aliasChild.kind() === "dotted_name") {
                  imports.push({
                    source: aliasChild.text(),
                    specifiers: ["*"],
                    kind: "namespace",
                  });
                }
              }
            }
          }
          break;
        }

        case "import_from_statement": {
          // from pathlib import Path, PurePath
          // from typing import Optional, List as PyList
          let source = "";
          const specifiers: string[] = [];

          for (const inner of child.children()) {
            const ik = inner.kind();
            if (ik === "dotted_name") {
              // First dotted_name is the source module
              if (!source) {
                source = inner.text();
              } else {
                specifiers.push(inner.text());
              }
            } else if (ik === "aliased_import") {
              // from X import Y as Z → get Y as the specifier
              for (const aliasChild of inner.children()) {
                if (aliasChild.kind() === "dotted_name") {
                  specifiers.push(aliasChild.text());
                }
              }
            }
          }

          if (source) {
            imports.push({
              source,
              specifiers: specifiers.length > 0 ? specifiers : ["*"],
              kind: "named",
            });
          }
          break;
        }
      }
    }

    const fileIndex = this.buildFileIndex(
      path, file_blake3, "python",
      imports, exports, symbols, [],
    );

    return this.buildResult(
      path, content, lines, file_blake3, fileIndex,
      symbols, topLevelDeclarations,
    );
  }

  // ── JSON parser ──────────────────────────────────────────────────────

  private async parseJson(
    path: string,
    content: string,
    lines: string[],
    file_blake3: string,
  ): Promise<ParsedSource> {
    const symbols: SymbolDetail[] = [];
    const imports: Import[] = [];
    const exports: Export[] = [];
    const topLevelDeclarations: string[] = [];

    const sgRoot = parse("json", content);

    // Extract top-level keys from JSON objects as declarations
    for (const child of sgRoot.root().children()) {
      if (child.kind() === "object") {
        for (const pair of child.children()) {
          if (pair.kind() === "pair") {
            // First child of a pair is the key (string)
            const pairChildren = pair.children();
            if (pairChildren.length > 0 && pairChildren[0]!.kind() === "string") {
              const key = stripQuotes(pairChildren[0]!.text());
              topLevelDeclarations.push(key);
            }
          }
        }
      }
    }

    const fileIndex = this.buildFileIndex(
      path, file_blake3, "json",
      imports, exports, symbols, [],
    );

    return this.buildResult(
      path, content, lines, file_blake3, fileIndex,
      symbols, topLevelDeclarations,
    );
  }

  // ── C# parser (regex-based, no native dependency) ────────────────────

  private async parseCSharp(
    path: string,
    content: string,
    lines: string[],
    file_blake3: string,
  ): Promise<ParsedSource> {
    const symbols: SymbolDetail[] = [];
    const imports: Import[] = [];
    const topLevelDeclarations: string[] = [];

    // Extract using statements
    const usingRegex = /^using\s+([\w.]+);\s*$/gm;
    let usingMatch: RegExpExecArray | null;
    while ((usingMatch = usingRegex.exec(content)) !== null) {
      imports.push({ source: usingMatch[1]!, specifiers: ["*"], kind: "namespace" });
    }

    // Extract top-level namespace/class/struct/interface/enum declarations
    const declRegex =
      /(?:public|private|internal|protected|static|abstract|sealed|readonly|partial|\s)*\s+(class|struct|interface|enum)\s+(\w+)/gm;
    let declMatch: RegExpExecArray | null;
    while ((declMatch = declRegex.exec(content)) !== null) {
      const kind = declMatch[1]!;
      const name = declMatch[2]!;
      const lineNum = content.substring(0, declMatch.index).split("\n").length;
      const symbolKind = kind === "class" ? "class" : kind === "interface" ? "interface" : kind === "struct" ? "struct" : "enum";
      symbols.push({
        kind: symbolKind,
        name,
        signature: "",
        startPosition: { line: lineNum, column: 0 },
        endPosition: { line: lineNum, column: 0 },
      });
      topLevelDeclarations.push(name);
    }

    // Extract method declarations
    const methodRegex =
      /(?:(?:public|private|internal|protected|static|virtual|override|abstract|sealed|async|\s))*\s+([\w<>[\],\s]+)\s+(\w+)\s*\(([^)]*)\)\s*(?:{|;)/gm;
    let methodMatch: RegExpExecArray | null;
    while ((methodMatch = methodRegex.exec(content)) !== null) {
      const returnType = methodMatch[1]!.trim();
      const name = methodMatch[2]!;
      const params = methodMatch[3]!.trim();

      if (["if", "for", "while", "foreach", "switch", "catch", "using"].includes(returnType)) continue;
      if (["class", "struct", "interface", "enum", "namespace"].includes(returnType)) continue;
      if (name === "get" || name === "set") continue;
      if (name.startsWith("this")) continue;

      const lineNum = content.substring(0, methodMatch.index).split("\n").length;
      symbols.push({
        kind: "function",
        name,
        signature: `(${params})`,
        startPosition: { line: lineNum, column: 0 },
        endPosition: { line: lineNum, column: 0 },
      });
    }

    const fileIndex = this.buildFileIndex(
      path, file_blake3, "csharp",
      imports, [], symbols, [],
    );

    return this.buildResult(
      path, content, lines, file_blake3, fileIndex,
      symbols, topLevelDeclarations,
    );
  }

  // ── Shared helpers ───────────────────────────────────────────────────

  private getImportSource(node: {
    children(): { kind(): string; text(): string }[];
  }): string {
    for (const c of node.children()) {
      if (c.kind() === "string") return stripQuotes(c.text());
    }
    return "";
  }

  private getPythonIdentifier(node: {
    children(): { kind(): string; text(): string }[];
  }): string | null {
    for (const c of node.children()) {
      if (c.kind() === "identifier") return c.text();
    }
    return null;
  }

  private extractPythonSignature(
    content: string,
    range: { start: { index: number }; end: { index: number } },
  ): string {
    const fnText = content.slice(range.start.index, range.end.index);
    const parenMatch = fnText.match(/\([^)]*\)/);
    return parenMatch ? parenMatch[0] : "";
  }

  private buildFileIndex(
    path: string,
    file_blake3: string,
    language: string,
    imports: Import[],
    exports: Export[],
    symbols: SymbolDetail[],
    relationships: string[],
  ): FileIndex {
    return {
      path,
      file_blake3,
      language,
      imports,
      exports,
      symbols,
      relationships,
      last_parsed: new Date().toISOString(),
    };
  }

  private buildResult(
    path: string,
    content: string,
    lines: string[],
    file_blake3: string,
    fileIndex: FileIndex,
    symbols: SymbolDetail[],
    topLevelDeclarations: string[],
  ): ParsedSource {
    const functionCount = symbols.filter((s) => s.kind === "function").length;
    const classCount = symbols.filter((s) => s.kind === "class").length;

    return {
      type: "code",
      path,
      content,
      tags: [],
      metadata: {
        kind: "code" as const,
        language: fileIndex.language,
        complexity: { lines: lines.length, functions: functionCount, classes: classCount },
        topLevelDeclarations,
      },
      file_blake3,
      last_parsed: new Date().toISOString(),
      fileIndex,
    };
  }
}

// ── Standalone helper ──────────────────────────────────────────────────────

/**
 * Determine language from file extension.
 */
function determineLanguage(path: string): string {
  if (path.endsWith(".cs")) return "csharp";
  if (path.endsWith(".tsx")) return "typescriptreact";
  if (path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".jsx")) return "javascriptreact";
  if (path.endsWith(".js")) return "javascript";
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".json")) return "json";
  return "typescript";
}
