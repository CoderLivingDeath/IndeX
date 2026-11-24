import { describe, expect, test } from "bun:test";

import type { Embedding, Embedder, EmbedderCache, EmbedderRegistry } from "../../../src/domain/systems/EmbeddingSystem";

describe("Embedding interface", () => {
  test("all fields are present", () => {
    const emb: Embedding = {
      vector: [0.1, 0.2, 0.3],
      model: "text-embedding-3-small",
      dimensions: 3,
      tokens_in: 10,
    };

    expect(Array.isArray(emb.vector)).toBe(true);
    expect(emb.vector.every((v) => typeof v === "number")).toBe(true);
    expect(typeof emb.model).toBe("string");
    expect(typeof emb.dimensions).toBe("number");
    expect(typeof emb.tokens_in).toBe("number");
  });
});

describe("Embedder interface", () => {
  test("all members are present", () => {
    const embedder: Embedder = {
      model: "text-embedding-3-small",
      dimensions: 1536,
      embed: async (text: string) => ({
        vector: [0.1, 0.2],
        model: "text-embedding-3-small",
        dimensions: 1536,
        tokens_in: text.split(" ").length,
      }),
      embedBatch: async (texts: string[]) =>
        texts.map((text) => ({
          vector: [0.1, 0.2],
          model: "text-embedding-3-small",
          dimensions: 1536,
          tokens_in: text.split(" ").length,
        })),
    };

    expect(typeof embedder.embed).toBe("function");
    expect(embedder.model).toBe("text-embedding-3-small");
    expect(embedder.dimensions).toBe(1536);
  });

  test("embed returns Embedding", async () => {
    const embedder: Embedder = {
      model: "test-model",
      dimensions: 2,
      embed: async (text: string) => ({
        vector: text === "hello" ? [0.5, 0.5] : [0.0, 0.0],
        model: "test-model",
        dimensions: 2,
        tokens_in: 1,
      }),
      embedBatch: async (texts: string[]) =>
        texts.map((text) => ({
          vector: text === "hello" ? [0.5, 0.5] : [0.0, 0.0],
          model: "test-model",
          dimensions: 2,
          tokens_in: 1,
        })),
    };

    const result = await embedder.embed("hello");
    expect(result.vector).toEqual([0.5, 0.5]);
    expect(result.model).toBe("test-model");
  });
});

describe("EmbedderCache interface", () => {
  test("all methods are present", () => {
    const cache: EmbedderCache = {
      get: async () => null,
      set: async () => {},
    };

    expect(typeof cache.get).toBe("function");
    expect(typeof cache.set).toBe("function");
  });

  test("get returns Embedding or null", async () => {
    const cache: EmbedderCache = {
      get: async (key: string) =>
        key === "cached"
          ? { vector: [1.0], model: "m", dimensions: 1, tokens_in: 5 }
          : null,
      set: async () => {},
    };

    const cached = await cache.get("cached");
    expect(cached).not.toBeNull();
    expect(cached!.vector).toEqual([1.0]);

    const miss = await cache.get("missing");
    expect(miss).toBeNull();
  });

  test("set stores values", async () => {
    let stored: { key: string; emb: Embedding } | null = null;
    const cache: EmbedderCache = {
      get: async () => null,
      set: async (key: string, emb: Embedding) => {
        stored = { key, emb };
      },
    };

    const emb: Embedding = { vector: [0.9], model: "m", dimensions: 1, tokens_in: 2 };
    await cache.set("mykey", emb);
    expect(stored).not.toBeNull();
    expect(stored!.key).toBe("mykey");
  });
});

describe("EmbedderRegistry interface", () => {
  test("all methods are present", () => {
    const registry: EmbedderRegistry = {
      getEmbedder: () => null,
      register: () => {},
    };

    expect(typeof registry.getEmbedder).toBe("function");
    expect(typeof registry.register).toBe("function");
  });

  test("getEmbedder returns Embedder or null", () => {
    const mockEmbedder: Embedder = {
      model: "test",
      dimensions: 128,
      embed: async () => ({ vector: [], model: "test", dimensions: 128, tokens_in: 0 }),
      embedBatch: async (texts: string[]) =>
        texts.map(() => ({ vector: [], model: "test", dimensions: 128, tokens_in: 0 })),
    };

    const entries = new Map<string, Embedder>([["code", mockEmbedder]]);
    const registry: EmbedderRegistry = {
      getEmbedder(sourceType: string) {
        return entries.get(sourceType) ?? null;
      },
      register(sourceType: string, embedder: Embedder) {
        entries.set(sourceType, embedder);
      },
    };

    expect(registry.getEmbedder("code")).not.toBeNull();
    expect(registry.getEmbedder("markdown")).toBeNull();
  });

  test("register accepts priority parameter", () => {
    const registry: EmbedderRegistry = {
      getEmbedder: () => null,
      register: (sourceType: string, embedder: Embedder, priority: number) => {},
    };

    // Should accept 3 arguments without error
    expect(registry.register.length).toBe(3);
  });
});
