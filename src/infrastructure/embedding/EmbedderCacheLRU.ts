import type { Embedding, EmbedderCache } from "../../domain/systems/EmbeddingSystem";

/**
 * In-memory LRU cache for embeddings keyed by `${model}:${hash}`.
 *
 * Evicts the least-recently-used entry when the cache exceeds `maxSize`.
 * Accessing an entry via get() or has() promotes it to most-recently-used,
 * protecting it from eviction.
 *
 * @example
 * ```ts
 * const cache = new EmbedderCacheLRU(100);
 * await cache.set("nomic-embed-text:abc123", embedding);
 * const found = await cache.get("nomic-embed-text:abc123");
 * ```
 */
export class EmbedderCacheLRU implements EmbedderCache {
  private readonly _map: Map<string, Embedding>;
  private readonly _maxSize: number;

  constructor(maxSize: number = 100) {
    if (maxSize <= 0) {
      throw new Error(`EmbedderCacheLRU maxSize must be > 0, got ${maxSize}`);
    }
    this._map = new Map<string, Embedding>();
    this._maxSize = maxSize;
  }

  /** Number of entries currently in the cache. */
  get size(): number {
    return this._map.size;
  }

  /**
   * Retrieves an embedding by key.
   * Promotes the key to most-recently-used on hit.
   * Returns `null` when the key is absent.
   */
  async get(key: string): Promise<Embedding | null> {
    if (!this._map.has(key)) {
      return null;
    }

    // Promote to most-recently-used by re-inserting
    const value = this._map.get(key)!;
    this._map.delete(key);
    this._map.set(key, value);

    return value;
  }

  /**
   * Stores an embedding by key.
   * If the key already exists its value is overwritten and its LRU position
   * is refreshed. If the cache is at capacity the least-recently-used entry
   * is evicted before insertion.
   */
  async set(key: string, embedding: Embedding): Promise<void> {
    // If key exists, remove it first so re-insertion puts it at the end
    if (this._map.has(key)) {
      this._map.delete(key);
    }

    // Evict the least-recently-used entry when at capacity
    if (this._map.size >= this._maxSize) {
      const oldestKey = this._map.keys().next().value;
      if (oldestKey !== undefined) {
        this._map.delete(oldestKey);
      }
    }

    this._map.set(key, embedding);
  }

  /**
   * Checks whether a key exists in the cache.
   * Promotes the key to most-recently-used when present.
   */
  has(key: string): boolean {
    if (!this._map.has(key)) {
      return false;
    }

    // Promote to most-recently-used by re-inserting
    const value = this._map.get(key)!;
    this._map.delete(key);
    this._map.set(key, value);

    return true;
  }

  /** Removes all entries from the cache. */
  clear(): void {
    this._map.clear();
  }
}
