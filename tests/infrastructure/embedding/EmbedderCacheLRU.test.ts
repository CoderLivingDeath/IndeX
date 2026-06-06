import { describe, it, expect } from "bun:test";
import { EmbedderCacheLRU } from "../../../src/infrastructure/embedding/EmbedderCacheLRU";
import type { Embedding } from "../../../src/domain/systems/EmbeddingSystem";

/**
 * Helper: create an inline Embedding for testing.
 */
function makeEmbedding(
  model: string,
  vector: number[] = [0.1, 0.2, 0.3],
  tokens_in: number = 10,
): Embedding {
  return { vector, model, dimensions: vector.length, tokens_in };
}

/**
 * Helper: build a cache key in the expected `${model}:${hash}` format.
 */
function cacheKey(model: string, hash: string): string {
  return `${model}:${hash}`;
}

describe("EmbedderCacheLRU", () => {
  // ─── Basic operations ──────────────────────────────────────────

  it("get() returns null for a missing key", async () => {
    const cache = new EmbedderCacheLRU(10);
    const result = await cache.get("nonexistent:key");
    expect(result).toBeNull();
  });

  it("set() stores an embedding and get() retrieves it", async () => {
    const cache = new EmbedderCacheLRU(10);
    const emb = makeEmbedding("model-a", [0.5, 0.6, 0.7]);
    const key = cacheKey("model-a", "abc123");

    await cache.set(key, emb);
    const retrieved = await cache.get(key);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.vector).toEqual([0.5, 0.6, 0.7]);
    expect(retrieved!.model).toBe("model-a");
    expect(retrieved!.dimensions).toBe(3);
    expect(retrieved!.tokens_in).toBe(10);
  });

  it("set() overwrites an existing key", async () => {
    const cache = new EmbedderCacheLRU(10);
    const key = cacheKey("model-a", "abc123");

    await cache.set(key, makeEmbedding("model-a", [0.1, 0.2], 5));
    await cache.set(key, makeEmbedding("model-a", [0.9, 0.8], 20));

    const retrieved = await cache.get(key);
    expect(retrieved!.vector).toEqual([0.9, 0.8]);
    expect(retrieved!.tokens_in).toBe(20);
  });

  // ─── Key format ────────────────────────────────────────────────

  it("uses ${model}:${hash} key format — same hash, different models are distinct", async () => {
    const cache = new EmbedderCacheLRU(10);

    await cache.set(cacheKey("model-a", "samehash"), makeEmbedding("model-a", [0.1]));
    await cache.set(cacheKey("model-b", "samehash"), makeEmbedding("model-b", [0.2]));

    const a = await cache.get(cacheKey("model-a", "samehash"));
    const b = await cache.get(cacheKey("model-b", "samehash"));

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.model).toBe("model-a");
    expect(b!.model).toBe("model-b");
  });

  it("uses ${model}:${hash} key format — same model, different hashes are distinct", async () => {
    const cache = new EmbedderCacheLRU(10);

    await cache.set(cacheKey("model-a", "hash1"), makeEmbedding("model-a", [0.1]));
    await cache.set(cacheKey("model-a", "hash2"), makeEmbedding("model-a", [0.2]));

    const r1 = await cache.get(cacheKey("model-a", "hash1"));
    const r2 = await cache.get(cacheKey("model-a", "hash2"));

    expect(r1!.vector).toEqual([0.1]);
    expect(r2!.vector).toEqual([0.2]);
  });

  // ─── LRU eviction ──────────────────────────────────────────────

  it("evicts the least-recently-used entry when size exceeds maxSize", async () => {
    const cache = new EmbedderCacheLRU(3);

    // Insert 3 items: A, B, C
    await cache.set("key:A", makeEmbedding("m", [0.1]));
    await cache.set("key:B", makeEmbedding("m", [0.2]));
    await cache.set("key:C", makeEmbedding("m", [0.3]));

    // Access A to make it recently-used, then insert D → evicts B (least recently used)
    await cache.get("key:A"); // A becomes most recent
    await cache.set("key:D", makeEmbedding("m", [0.4])); // evicts B

    expect(await cache.get("key:A")).not.toBeNull(); // A was accessed, still alive
    expect(await cache.get("key:B")).toBeNull();       // B was evicted (LRU)
    expect(await cache.get("key:C")).not.toBeNull();   // C still alive
    expect(await cache.get("key:D")).not.toBeNull();   // D newly inserted
  });

  it("evicts in strict LRU order under sequential inserts", async () => {
    const cache = new EmbedderCacheLRU(3);

    await cache.set("key:1", makeEmbedding("m", [0.1]));
    await cache.set("key:2", makeEmbedding("m", [0.2]));
    await cache.set("key:3", makeEmbedding("m", [0.3]));
    await cache.set("key:4", makeEmbedding("m", [0.4])); // evicts 1

    expect(await cache.get("key:1")).toBeNull();
    expect(await cache.get("key:2")).not.toBeNull();
    expect(await cache.get("key:3")).not.toBeNull();
    expect(await cache.get("key:4")).not.toBeNull();
  });

  it("re-inserting an existing key refreshes its LRU position", async () => {
    const cache = new EmbedderCacheLRU(3);

    await cache.set("key:A", makeEmbedding("m", [0.1]));
    await cache.set("key:B", makeEmbedding("m", [0.2]));
    await cache.set("key:C", makeEmbedding("m", [0.3]));

    // Overwrite A — refreshes its position
    await cache.set("key:A", makeEmbedding("m", [0.9]));
    await cache.set("key:D", makeEmbedding("m", [0.4])); // evicts B (oldest)

    expect(await cache.get("key:A")).not.toBeNull();
    expect(await cache.get("key:B")).toBeNull();
    expect(await cache.get("key:C")).not.toBeNull();
    expect(await cache.get("key:D")).not.toBeNull();
  });

  it("retrieving an entry via get() promotes it (does not get evicted next)", async () => {
    const cache = new EmbedderCacheLRU(2);

    await cache.set("key:A", makeEmbedding("m", [0.1]));
    await cache.set("key:B", makeEmbedding("m", [0.2]));

    // Access A — makes A most recent, B is now LRU
    await cache.get("key:A");
    await cache.set("key:C", makeEmbedding("m", [0.3])); // evicts B

    expect(await cache.get("key:A")).not.toBeNull();
    expect(await cache.get("key:B")).toBeNull();
    expect(await cache.get("key:C")).not.toBeNull();
  });

  // ─── Size tracking ─────────────────────────────────────────────

  it("size starts at 0", () => {
    const cache = new EmbedderCacheLRU(10);
    expect(cache.size).toBe(0);
  });

  it("size increases on set()", async () => {
    const cache = new EmbedderCacheLRU(10);
    expect(cache.size).toBe(0);

    await cache.set("k1", makeEmbedding("m", [0.1]));
    expect(cache.size).toBe(1);

    await cache.set("k2", makeEmbedding("m", [0.2]));
    expect(cache.size).toBe(2);
  });

  it("size does not grow on overwrite of existing key", async () => {
    const cache = new EmbedderCacheLRU(10);

    await cache.set("key:A", makeEmbedding("m", [0.1]));
    expect(cache.size).toBe(1);

    await cache.set("key:A", makeEmbedding("m", [0.2]));
    expect(cache.size).toBe(1); // still 1
  });

  it("size reflects eviction — decreases when entries are removed", async () => {
    const cache = new EmbedderCacheLRU(3);

    await cache.set("k1", makeEmbedding("m", [0.1]));
    await cache.set("k2", makeEmbedding("m", [0.2]));
    await cache.set("k3", makeEmbedding("m", [0.3]));
    expect(cache.size).toBe(3);

    await cache.set("k4", makeEmbedding("m", [0.4])); // evicts k1
    expect(cache.size).toBe(3); // stays at max
  });

  // ─── has() method ──────────────────────────────────────────────

  it("has() returns false for a missing key", async () => {
    const cache = new EmbedderCacheLRU(10);
    expect(await cache.has("missing:key")).toBe(false);
  });

  it("has() returns true for a present key", async () => {
    const cache = new EmbedderCacheLRU(10);
    await cache.set("present:key", makeEmbedding("m", [0.1]));
    expect(await cache.has("present:key")).toBe(true);
  });

  it("has() returns false after eviction", async () => {
    const cache = new EmbedderCacheLRU(2);

    await cache.set("k1", makeEmbedding("m", [0.1]));
    await cache.set("k2", makeEmbedding("m", [0.2]));
    await cache.set("k3", makeEmbedding("m", [0.3])); // evicts k1

    expect(await cache.has("k1")).toBe(false);
    expect(await cache.has("k2")).toBe(true);
    expect(await cache.has("k3")).toBe(true);
  });

  // ─── Edge cases ────────────────────────────────────────────────

  it("handles empty cache — get, has, size all behave correctly", async () => {
    const cache = new EmbedderCacheLRU(5);
    expect(cache.size).toBe(0);
    expect(await cache.get("anything")).toBeNull();
    expect(await cache.has("anything")).toBe(false);
  });

  it("accepts default maxSize of 100 when no argument given", () => {
    const cache = new EmbedderCacheLRU();
    expect(cache.size).toBe(0);
  });

  it("throws when maxSize is 0 or negative", () => {
    expect(() => new EmbedderCacheLRU(0)).toThrow();
    expect(() => new EmbedderCacheLRU(-1)).toThrow();
  });

  it("evicts oldest entry when cache is at capacity and new set occurs", async () => {
    const cache = new EmbedderCacheLRU(1);

    await cache.set("only-one", makeEmbedding("m", [0.1]));
    expect(cache.size).toBe(1);

    await cache.set("kicked-out", makeEmbedding("m", [0.2]));
    expect(cache.size).toBe(1);
    expect(await cache.get("only-one")).toBeNull();
    expect(await cache.get("kicked-out")).not.toBeNull();
  });

  it("preserves all entries when under maxSize", async () => {
    const cache = new EmbedderCacheLRU(100);

    const keys = Array.from({ length: 50 }, (_, i) => `key:${i}`);
    for (let idx = 0; idx < keys.length; idx++) {
      await cache.set(keys[idx], makeEmbedding("m", [idx / 50]));
    }

    expect(cache.size).toBe(50);
    for (const k of keys) {
      expect(await cache.get(k)).not.toBeNull();
    }
  });
});
