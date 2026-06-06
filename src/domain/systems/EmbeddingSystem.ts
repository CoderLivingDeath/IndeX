/**
 * A vector embedding produced by an embedder model.
 */
export interface Embedding {
  vector: number[];
  model: string;
  dimensions: number;
  tokens_in: number;
}

/**
 * An embedder that converts text into vector embeddings.
 */
export interface Embedder {
  embed(text: string): Promise<Embedding>;
  readonly model: string;
  readonly dimensions: number;
}

/**
 * A cache for previously computed embeddings (keyed by text hash or ID).
 */
export interface EmbedderCache {
  get(key: string): Promise<Embedding | null>;
  set(key: string, embedding: Embedding): Promise<void>;
}

/**
 * A registry of embedders mapped by source type, with priority ordering.
 */
export interface EmbedderRegistry {
  getEmbedder(sourceType: string): Embedder | null;
  register(sourceType: string, embedder: Embedder, priority: number): void;
}
