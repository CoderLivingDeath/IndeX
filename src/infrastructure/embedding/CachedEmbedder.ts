import type { Embedding, Embedder } from "../../domain/systems/EmbeddingSystem";
import type { EmbedderCache } from "../../domain/systems/EmbeddingSystem";
import type { Hasher } from "../../domain/systems/HashingSystem";

/**
 * A proxy/decorator that wraps an Embedder with an LRU cache.
 *
 * On embed(), it computes a cache key as `${model}:${hash(text)}`,
 * checks the cache, and only calls the inner embedder on a cache miss.
 * Results from the inner embedder are stored in the cache for future calls.
 */
export class CachedEmbedder implements Embedder {
  readonly model: string;
  readonly dimensions: number;

  constructor(
    private readonly embedder: Embedder,
    private readonly cache: EmbedderCache,
    private readonly hasher: Hasher,
  ) {
    this.model = embedder.model;
    this.dimensions = embedder.dimensions;
  }

  async embed(text: string): Promise<Embedding> {
    const hash = await this.hasher.hash(text);
    const key = `${this.embedder.model}:${hash}`;

    const cached = await this.cache.get(key);
    if (cached !== null) {
      return cached;
    }

    const result = await this.embedder.embed(text);
    await this.cache.set(key, result);
    return result;
  }

  async embedBatch(texts: string[]): Promise<Embedding[]> {
    const results: Embedding[] = new Array(texts.length);
    const missIndices: number[] = [];
    const missTexts: string[] = [];
    const keys: string[] = new Array(texts.length);

    for (let i = 0; i < texts.length; i++) {
      const hash = await this.hasher.hash(texts[i]!);
      const key = `${this.embedder.model}:${hash}`;
      keys[i] = key;
      const cached = await this.cache.get(key);
      if (cached !== null) {
        results[i] = cached;
      } else {
        missIndices.push(i);
        missTexts.push(texts[i]!);
      }
    }

    if (missTexts.length > 0) {
      const embeds = await this.embedder.embedBatch(missTexts);
      for (let j = 0; j < missTexts.length; j++) {
        const idx = missIndices[j]!;
        results[idx] = embeds[j]!;
        await this.cache.set(keys[idx]!, embeds[j]!);
      }
    }

    return results;
  }
}
