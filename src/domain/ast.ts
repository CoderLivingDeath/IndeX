// ---------------------------------------------------------------------------
// AST Model — Phase 1
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable AST summary to prepend to embedding content.
 * Returns undefined for files without code structure.
 */
export function generateAstSummary(fileIndex: FileIndex): string {
  const lines: string[] = [];

  if (fileIndex.imports.length > 0) {
    const parts = fileIndex.imports.map(
      (imp) => `${imp.source} → ${imp.specifiers.join(", ")}`,
    );
    lines.push(`imports: ${parts.join("; ")}`);
  }

  if (fileIndex.exports.length > 0) {
    const parts = fileIndex.exports.map(
      (exp) => `${exp.kind} ${exp.name}`,
    );
    lines.push(`exports: ${parts.join(", ")}`);
  }

  if (fileIndex.symbols.length > 0) {
    const parts = fileIndex.symbols.map(
      (sym) => `${sym.kind} ${sym.name}${sym.signature ? `(${sym.signature})` : ""}`,
    );
    lines.push(`symbols: ${parts.join(", ")}`);
  }

  if (lines.length === 0) return "";
  return `--- AST ---\n${lines.join("\n")}`;
}

/**
 * Kinds of symbols that can be extracted from source code.
 */
export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "struct"
  | "type"
  | "enum"
  | "variable"
  | "method"
  | "property"
  | "parameter"
  | "module";

/**
 * A single symbol (function, class, variable, etc.) found in a file.
 */
export interface SymbolDetail {
  kind: SymbolKind;
  name: string;
  signature: string;
  startPosition: { line: number; column: number };
  endPosition: { line: number; column: number };
}

/**
 * An import statement found in a file.
 */
export interface Import {
  source: string;
  specifiers: string[];
  kind: "named" | "default" | "namespace";
}

/**
 * An export statement found in a file.
 */
export interface Export {
  name: string;
  kind: "named" | "default" | "all";
}

/**
 * A relationship between two code entities (calls, extends, imports, etc.).
 */
export interface Relationship {
  type: "calls" | "extends" | "implements" | "imports" | "exports";
  source: string;
  target: string;
}

/**
 * Indexed metadata for a single file's AST.
 */
export interface FileIndex {
  path: string;
  file_blake3: string;
  language: string;
  imports: Import[];
  exports: Export[];
  symbols: SymbolDetail[];
  relationships: Relationship[];
  last_parsed: string; // ISO 8601
}
