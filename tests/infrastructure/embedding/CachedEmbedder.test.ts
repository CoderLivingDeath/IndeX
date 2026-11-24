/**
 * RED phase — CachedEmbedder.test.ts
 *
 * Tests for the CachedEmbedder proxy/decorator that wraps an Embedder
 * with an EmbedderCache. On embed(), it computes a cache key using
 * the hasher, checks the cache first, and only delegates to the inner
 * embedder on a cache miss.
 *
 * Acceptance Criteria:
 *  1. Cache hit: inner embedder is NOT called, cached value returned
 *  2. Cache miss: inner embedder IS called and result is cached
 *  3. Cache key derivation uses hasher.hash(text)
 *  4. Decorated embedder exposes model and dimensions from inner embedder
 */

import { describe, it, expect } from "bun:test";
import { CachedEmbedder } from "../../../src/infrastructure/embedding/CachedEmbedder";
import type { Embedding, Embedder, EmbedderCache } from "../../../src/domain/systems/EmbeddingSystem";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a spy embedder that records embed() calls and returns
 * a deterministic Embedding based on model/dimensions.
 */
function createSpyEmbedder(
  model: string,
  dimensions: number,
): Embedder & { embedCalls: string[] } {
  const embedCalls: string[] = [];
  return {
    model,
    dimensions,
    embedCalls,
    embed: async (text: string): Promise<Embedding> => {
      embedCalls.push(text);
      return {
        vector: Array.from({ length: dimensions }, (_, i) => i + 1),
        model,
        dimensions,
        tokens_in: text.length,
      };
    },
    embedBatch: async (texts: string[]): Promise<Embedding[]> =>
      Promise.all(texts.map((text) => {
        embedCalls.push(text);
        return Promise.resolve({
          vector: Array.from({ length: dimensions }, (_, i) => i + 1),
          model,
          dimensions,
          tokens_in: text.length,
        });
      })),
  };
}

/**
 * Creates a mock EmbedderCache backed by a plain Map.
 * Tracks set() calls for inspection.
 */
function createMockCache(): EmbedderCache & {
  entries: Map<string, Embedding>;
  setCalls: Array<{ key: string; embedding: Embedding }>;
} {
  const entries = new Map<string, Embedding>();
  const setCalls: Array<{ key: string; embedding: Embedding }> = [];
  return {
    entries,
    setCalls,
    async get(key: string): Promise<Embedding | null> {
      return entries.get(key) ?? null;
    },
    async set(key: string, embedding: Embedding): Promise<void> {
      setCalls.push({ key, embedding });
      entries.set(key, embedding);
    },
  };
}

/**
 * Creates a mock hasher that records hash() calls.
 * @param fixedHash — if provided, hash() always returns this value
 *                    otherwise returns "mock-hash:${text}"
 */
function createMockHasher(
  fixedHash?: string,
): { hash(data: string | Uint8Array): Promise<string> } & { hashCalls: string[]; algorithm: string } {
  const hashCalls: string[] = [];
  if (fixedHash !== undefined) {
    return {
      hashCalls,
      algorithm: "mock",
      hash: async (data: string | Uint8Array) => {
        const text = typeof data === "string" ? data : new TextDecoder().decode(data);
        hashCalls.push(text);
        return fixedHash;
      },
    };
  }
  return {
    hashCalls,
    algorithm: "mock",
    hash: async (data: string | Uint8Array) => {
      const text = typeof data === "string" ? data : new TextDecoder().decode(data);
      hashCalls.push(text);
      return `mock-hash:${text}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("CachedEmbedder", () => {
  // -----------------------------------------------------------------------
  // AC 1: Cache hit — inner embedder NOT called, cached value returned
  // -----------------------------------------------------------------------
  it("returns cached embedding on cache hit without calling inner embedder", async () => {
    // Arrange
    const inner = createSpyEmbedder("test-model", 4);
    const cache = createMockCache();
    const hasher = createMockHasher("fixed-hash");

    const cachedEmb: Embedding = {
      vector: [9, 9, 9, 9],
      model: "test-model",
      dimensions: 4,
      tokens_in: 99,
    };
    await cache.set("test-model:fixed-hash", cachedEmb);

    const cachedEmbedder = new CachedEmbedder(inner, cache, hasher);

    // Act
    const result = await cachedEmbedder.embed("some text");

    // Assert — inner embedder NOT called, cached value returned
    expect(inner.embedCalls).toHaveLength(0);
    expect(result).toEqual(cachedEmb);
  });

  it("returns cached embedding for different text that hashes to same key", async () => {
    // Arrange — hasher always returns the same fixed hash regardless of text
    const inner = createSpyEmbedder("collision-model", 2);
    const cache = createMockCache();
    const hasher = createMockHasher("same-hash");

    const cachedEmb: Embedding = {
      vector: [7, 7],
      model: "collision-model",
      dimensions: 2,
      tokens_in: 10,
    };
    await cache.set("collision-model:same-hash", cachedEmb);

    const cachedEmbedder = new CachedEmbedder(inner, cache, hasher);

    // Act — different text, but hasher produces same hash
    const result = await cachedEmbedder.embed("completely different text");

    // Assert — cache hit on different text due to hash collision
    expect(inner.embedCalls).toHaveLength(0);
    expect(result).toEqual(cachedEmb);
  });

  // -----------------------------------------------------------------------
  // AC 2: Cache miss — inner embedder IS called, result is cached
  // -----------------------------------------------------------------------
  it("calls inner embedder and caches result on cache miss", async () => {
    // Arrange
    const inner = createSpyEmbedder("miss-model", 3);
    const cache = createMockCache();
    const hasher = createMockHasher("miss-hash");
    const cachedEmbedder = new CachedEmbedder(inner, cache, hasher);

    // Act
    const result = await cachedEmbedder.embed("hello");

    // Assert — inner embedder was called once with the correct text
    expect(inner.embedCalls).toHaveLength(1);
    expect(inner.embedCalls[0]).toBe("hello");

    // Assert — result shape matches what inner embedder would return
    expect(result.vector).toEqual([1, 2, 3]);
    expect(result.model).toBe("miss-model");
    expect(result.dimensions).toBe(3);
    expect(result.tokens_in).toBe(5); // "hello".length

    // Assert — result was stored in cache
    const cached = await cache.get("miss-model:miss-hash");
    expect(cached).not.toBeNull();
    expect(cached!.vector).toEqual([1, 2, 3]);
    expect(cached!.model).toBe("miss-model");
  });

  it("stores embedding in cache with correct key on miss", async () => {
    // Arrange
    const inner = createSpyEmbedder("store-model", 2);
    const cache = createMockCache();
    const hasher = createMockHasher("store-hash");
    const cachedEmbedder = new CachedEmbedder(inner, cache, hasher);

    // Act
    await cachedEmbedder.embed("store me");

    // Assert — exactly one set() call with the expected key
    expect(cache.setCalls).toHaveLength(1);
    expect(cache.setCalls[0]!.key).toBe("store-model:store-hash");
    expect(cache.setCalls[0]!.embedding.vector).toEqual([1, 2]);
  });

  // -----------------------------------------------------------------------
  // AC 1 + 2 (combined): Miss then subsequent hit with same text
  // -----------------------------------------------------------------------
  it("hits cache on second call with same text (miss → hit lifecycle)", async () => {
    // Arrange
    const inner = createSpyEmbedder("lifecycle-model", 2);
    const cache = createMockCache();
    const hasher = createMockHasher("lifecycle-hash");
    const cachedEmbedder = new CachedEmbedder(inner, cache, hasher);

    // Act — first call: cache miss
    const first = await cachedEmbedder.embed("repeat");

    // Assert — inner embedder called once
    expect(inner.embedCalls).toHaveLength(1);
    expect(cache.setCalls).toHaveLength(1);

    // Act — second call with same text: should be cache hit
    const second = await cachedEmbedder.embed("repeat");

    // Assert — inner embedder still called only once; results identical
    expect(inner.embedCalls).toHaveLength(1);
    expect(cache.setCalls).toHaveLength(1); // no additional set()
    expect(second).toEqual(first);
  });

  // -----------------------------------------------------------------------
  // AC 3: Cache key derivation uses hasher.hash(text)
  // -----------------------------------------------------------------------
  it("computes cache key using hasher.hash(text) in ${model}:${hash} format", async () => {
    // Arrange
    const inner = createSpyEmbedder("key-model", 2);
    const cache = createMockCache();
    const hasher = createMockHasher("known-hash");
    const cachedEmbedder = new CachedEmbedder(inner, cache, hasher);

    // Act
    await cachedEmbedder.embed("some input");

    // Assert — hasher was called with the exact input text
    expect(hasher.hashCalls).toHaveLength(1);
    expect(hasher.hashCalls[0]).toBe("some input");

    // Assert — cache key follows ${model}:${hashResult} format
    const cached = await cache.get("key-model:known-hash");
    expect(cached).not.toBeNull();
  });

  it("uses different cache keys for different texts via hasher", async () => {
    // Arrange — dynamic hash: "mock-hash:${text}"
    const inner = createSpyEmbedder("multi-key", 2);
    const cache = createMockCache();
    const hasher = createMockHasher();
    const cachedEmbedder = new CachedEmbedder(inner, cache, hasher);

    // Act — embed two different texts
    await cachedEmbedder.embed("first");
    await cachedEmbedder.embed("second");

    // Assert — each text hashed separately, different cache keys
    expect(hasher.hashCalls).toHaveLength(2);
    expect(hasher.hashCalls[0]).toBe("first");
    expect(hasher.hashCalls[1]).toBe("second");

    const key1 = "multi-key:mock-hash:first";
    const key2 = "multi-key:mock-hash:second";

    expect(await cache.get(key1)).not.toBeNull();
    expect(await cache.get(key2)).not.toBeNull();
    expect(inner.embedCalls).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // AC 4: Exposes model and dimensions from inner embedder
  // -----------------------------------------------------------------------
  it("exposes model property from inner embedder", () => {
    // Arrange
    const inner = createSpyEmbedder("my-model", 128);
    const cachedEmbedder = new CachedEmbedder(inner, createMockCache(), createMockHasher());

    // Act & Assert
    expect(cachedEmbedder.model).toBe("my-model");
  });

  it("exposes dimensions property from inner embedder", () => {
    // Arrange
    const inner = createSpyEmbedder("dim-model", 384);
    const cachedEmbedder = new CachedEmbedder(inner, createMockCache(), createMockHasher());

    // Act & Assert
    expect(cachedEmbedder.dimensions).toBe(384);
  });

  it("model and dimensions match inner embedder values", () => {
    // Arrange
    const inner = createSpyEmbedder("readonly-model", 256);
    const cachedEmbedder = new CachedEmbedder(inner, createMockCache(), createMockHasher());

    // Assert
    expect(cachedEmbedder.model).toBe("readonly-model");
    expect(cachedEmbedder.dimensions).toBe(256);

    // TypeScript ensures readonly — the following would cause a compile error:
    //   cachedEmbedder.model = "other";     // Error: Cannot assign to 'model' because it is a read-only property
    //   cachedEmbedder.dimensions = 512;    // Error: Cannot assign to 'dimensions' because it is a read-only property
  });

  // -----------------------------------------------------------------------
  // Interface conformance
  // -----------------------------------------------------------------------
  it("satisfies the Embedder interface shape", () => {
    // Arrange — verify structural compatibility
    const inner = createSpyEmbedder("iface-model", 64);
    const cachedEmbedder: Embedder = new CachedEmbedder(inner, createMockCache(), createMockHasher());

    // Act & Assert
    expect(typeof cachedEmbedder.embed).toBe("function");
    expect(typeof cachedEmbedder.model).toBe("string");
    expect(typeof cachedEmbedder.dimensions).toBe("number");
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  it("handles empty string text (miss → cache)", async () => {
    // Arrange
    const inner = createSpyEmbedder("empty-model", 2);
    const cache = createMockCache();
    const hasher = createMockHasher("empty-hash");
    const cachedEmbedder = new CachedEmbedder(inner, cache, hasher);

    // Act
    const result = await cachedEmbedder.embed("");

    // Assert — inner embedder called with empty string
    expect(inner.embedCalls).toHaveLength(1);
    expect(inner.embedCalls[0]).toBe("");
    expect(result.tokens_in).toBe(0); // "".length

    // Assert — result cached
    const cached = await cache.get("empty-model:empty-hash");
    expect(cached).not.toBeNull();
    expect(cached!.tokens_in).toBe(0);
  });

  it("cache key includes model prefix so same hash for different models does not collide", async () => {
    // Arrange — two cached embedders sharing the same cache and hasher
    const cache = createMockCache();
    const hasher = createMockHasher("shared-hash");

    const innerA = createSpyEmbedder("model-a", 3);
    const innerB = createSpyEmbedder("model-b", 4);

    const cachedA = new CachedEmbedder(innerA, cache, hasher);
    const cachedB = new CachedEmbedder(innerB, cache, hasher);

    // Act — embed same text with both models
    const resultA = await cachedA.embed("same text");
    const resultB = await cachedB.embed("same text");

    // Assert — each embedder was called (different cache keys due to model prefix)
    expect(innerA.embedCalls).toHaveLength(1);
    expect(innerB.embedCalls).toHaveLength(1);

    // Assert — results come from the correct inner embedders
    expect(resultA.dimensions).toBe(3);
    expect(resultB.dimensions).toBe(4);

    // Assert — two distinct cache entries exist (no collision)
    expect(await cache.get("model-a:shared-hash")).not.toBeNull();
    expect(await cache.get("model-b:shared-hash")).not.toBeNull();
    expect((await cache.get("model-a:shared-hash"))!.vector).toEqual([1, 2, 3]);
    expect((await cache.get("model-b:shared-hash"))!.vector).toEqual([1, 2, 3, 4]);
  });

  it("second call with different text causes a new cache miss", async () => {
    // Arrange
    const inner = createSpyEmbedder("multi-miss", 2);
    const cache = createMockCache();
    const hasher = createMockHasher(); // dynamic: "mock-hash:${text}"
    const cachedEmbedder = new CachedEmbedder(inner, cache, hasher);

    // Act — first text
    const first = await cachedEmbedder.embed("alpha");

    // Act — second text (different)
    const second = await cachedEmbedder.embed("beta");

    // Assert — both caused calls to inner embedder (both were misses)
    expect(inner.embedCalls).toHaveLength(2);
    expect(inner.embedCalls[0]).toBe("alpha");
    expect(inner.embedCalls[1]).toBe("beta");

    // Assert — results differ
    expect(first.vector).toEqual([1, 2]);
    expect(second.vector).toEqual([1, 2]); // same embedder, same dimensions
  });
});
