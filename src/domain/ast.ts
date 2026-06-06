// ---------------------------------------------------------------------------
// AST Model — Phase 1
// ---------------------------------------------------------------------------

/**
 * Kinds of symbols that can be extracted from source code.
 */
export type SymbolKind =
  | "function"
  | "class"
  | "interface"
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
