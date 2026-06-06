import type { SourceParser } from "./SourceParser";

/**
 * Registry of source parsers, keyed by file extension / type.
 */
export interface SourceParserRegistry {
  getParser(path: string): SourceParser | null;
  register(parser: SourceParser): void;
}
