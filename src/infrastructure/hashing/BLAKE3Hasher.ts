import { blake3 } from "hash-wasm";
import type { Hasher } from "../../domain/systems/HashingSystem";

/**
 * BLAKE3 hasher implementation using hash-wasm (WebAssembly).
 * Uses the one-shot `blake3()` function which accepts string or Uint8Array
 * and returns a 256-bit (64 hex char) digest by default.
 */
export class BLAKE3Hasher implements Hasher {
  readonly algorithm = "BLAKE3";

  async hash(data: string | Uint8Array): Promise<string> {
    return blake3(data);
  }

  async hashFile(path: string): Promise<string> {
    const file = Bun.file(path);
    const content = await file.text();
    return this.hash(content);
  }
}
