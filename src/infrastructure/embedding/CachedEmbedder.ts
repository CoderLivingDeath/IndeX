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
}
