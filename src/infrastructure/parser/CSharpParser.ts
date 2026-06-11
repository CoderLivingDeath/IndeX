// ---------------------------------------------------------------------------
// CSharpParser — Phase 13
// Parses .cs files into ParsedSource for indexing (no AST analysis).
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { BLAKE3Hasher } from "../hashing/BLAKE3Hasher";
import type { SourceParser } from "../../domain/ports/SourceParser";
import type { ParsedSource, SourceType } from "../../domain/types";

export class CSharpParser implements SourceParser {
  private readonly hasher = new BLAKE3Hasher();

  supportsFile(path: string): boolean {
    return path.endsWith(".cs");
  }

  async parse(path: string): Promise<ParsedSource> {
    const raw = readFileSync(path, "utf-8");
    const content = raw.replace(/\r\n/g, "\n");
    const fileBlake3 = await this.hasher.hash(content);

    return {
      type: "code" as SourceType,
      title: path.split(/[\\/]/).pop() ?? path,
      content,
      tags: [],
      path,
      file_blake3: fileBlake3,
      semantic_blake3: fileBlake3,
      metadata: {
        kind: "code",
        language: "csharp",
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
}
