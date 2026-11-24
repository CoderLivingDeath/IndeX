// ---------------------------------------------------------------------------
// CSharpParser — Phase 13
// Parses .cs files into ParsedSource for indexing (no AST analysis).
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { BLAKE3Hasher } from "../hashing/BLAKE3Hasher";
import type { SourceParser } from "../../domain/ports/SourceParser";
import type { ParsedSource, SourceType } from "../../domain/types";

export class CSharpParser implements SourceParser {
  readonly type: SourceType = "code";
  readonly extensions = [".cs"];
  private readonly hasher = new BLAKE3Hasher();

  supportsFile(path: string): boolean {
    return path.endsWith(".cs");
  }

  async parse(path: string): Promise<ParsedSource> {
    const raw = readFileSync(path, "utf-8");
    const content = raw.replace(/\r\n/g, "\n");
    const fileBlake3 = await this.hasher.hash(content);

    return {
      type: "code",
      path,
      content,
      tags: [],
      metadata: {
        kind: "code",
        language: "csharp",
      },
      file_blake3: fileBlake3,
      last_parsed: new Date().toISOString(),
    };
  }
}
