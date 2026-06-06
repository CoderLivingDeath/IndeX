import { describe, it, expect } from "bun:test";
import { BLAKE3Hasher } from "../../../src/infrastructure/hashing/BLAKE3Hasher";

describe("BLAKE3Hasher", () => {
  const hasher = new BLAKE3Hasher();

  it("hash('hello') returns a 64-character hex string", async () => {
    const result = await hasher.hash("hello");
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hash('hello') !== hash('world')", async () => {
    const [a, b] = await Promise.all([
      hasher.hash("hello"),
      hasher.hash("world"),
    ]);
    expect(a).not.toBe(b);
  });

  it("hashFile(path) matches hash(content) for the same file", async () => {
    const content = "BLAKE3 test file content";
    const path = "/tmp/blake3-test-file.txt";
    await Bun.write(path, content);
    const fileHash = await hasher.hashFile(path);
    const contentHash = await hasher.hash(content);
    expect(fileHash).toBe(contentHash);
  });

  it("hash('') returns a valid 64-character hex string", async () => {
    const result = await hasher.hash("");
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hash is deterministic — same input always returns same output", async () => {
    const input = "determinism-test-" + Math.random();
    const [a, b] = await Promise.all([
      hasher.hash(input),
      hasher.hash(input),
    ]);
    expect(a).toBe(b);
  });

  it("hash algorithm property is 'BLAKE3'", () => {
    expect(hasher.algorithm).toBe("BLAKE3");
  });
});
