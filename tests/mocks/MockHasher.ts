import { createHash } from "crypto";
import type { Hasher } from "../../src/domain/systems/HashingSystem";

/**
 * A mock hasher implementation using Node.js crypto (SHA-256).
 * Deterministic and has no WASM dependency — suitable for tests.
 */
export class MockHasher implements Hasher {
  readonly algorithm = "sha256";

  async hash(data: string | Uint8Array): Promise<string> {
    const input = typeof data === "string" ? data : Buffer.from(data);
    return createHash("sha256").update(input).digest("hex");
  }

  async hashFile(path: string): Promise<string> {
    const file = Bun.file(path);
    const content = await file.text();
    return this.hash(content);
  }

  async hashDirectory(_path: string): Promise<string> {
    return "mocked-dir-hash";
  }
}
