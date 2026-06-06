import type { SourceType, ParsedSource } from "../types";

/**
 * Parser for a specific source file type.
 */
export interface SourceParser {
  type: SourceType;
  extensions: string[];
  enabled?: boolean;
  supportsFile(path: string): boolean;
  parse(path: string): Promise<ParsedSource>;
}
