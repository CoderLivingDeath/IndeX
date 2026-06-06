import { describe, it, expect } from "bun:test";
import { LanceDbEmbedder } from "../../../src/infrastructure/embedding/LanceDbEmbedder";

describe("LanceDbEmbedder", () => {
  const model = "lancedb-fallback";
  const dimensions = 384;

  it("returns a zero vector of the configured dimension", async () => {
    const embedder = new LanceDbEmbedder(model, dimensions);
    const result = await embedder.embed("any text");

    expect(result.vector).toHaveLength(dimensions);
  });

  it("all elements of the returned vector are 0", async () => {
    const embedder = new LanceDbEmbedder(model, dimensions);
    const result = await embedder.embed("any text");

    for (const value of result.vector) {
      expect(value).toBe(0);
    }
  });

  it("exposes model as a readonly property", () => {
    const embedder = new LanceDbEmbedder(model, dimensions);

    expect(embedder.model).toBe(model);
  });

  it("exposes dimensions as a readonly property", () => {
    const embedder = new LanceDbEmbedder(model, dimensions);

    expect(embedder.dimensions).toBe(dimensions);
  });

  it("returns correct tokens_in on the embedding", async () => {
    const embedder = new LanceDbEmbedder(model, dimensions);
    const result = await embedder.embed("any text");

    expect(result.tokens_in).toBe(0);
  });

  it("returns consistent zero vectors for different input text", async () => {
    const embedder = new LanceDbEmbedder(model, dimensions);
    const resultA = await embedder.embed("hello world");
    const resultB = await embedder.embed("different text");

    expect(resultA.vector).toEqual(resultB.vector);
  });

  it("supports different dimensions", async () => {
    const small = new LanceDbEmbedder("small", 8);
    const result = await small.embed("test");

    expect(result.vector).toHaveLength(8);
    expect(small.dimensions).toBe(8);
    for (const value of result.vector) {
      expect(value).toBe(0);
    }
  });

  it("all properties are present in the returned Embedding", async () => {
    const embedder = new LanceDbEmbedder(model, dimensions);
    const result = await embedder.embed("any text");

    expect(result).toHaveProperty("vector");
    expect(result).toHaveProperty("model", model);
    expect(result).toHaveProperty("dimensions", dimensions);
    expect(result).toHaveProperty("tokens_in", 0);
  });
});
