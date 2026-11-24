import type { Embedding, Embedder } from "../../domain/systems/EmbeddingSystem";

/**
 * A zero-vector fallback embedder for graceful degradation.
 *
 * Returns a Float32Array of zeros whenever embed() is called, with
 * tokens_in set to 0. Use as a safe default when no real embedder
 * (e.g. Ollama) is available for a source type.
 *
 * @example
 * ```ts
 * const embedder = new LanceDbEmbedder();
 * const embedding = await embedder.embed("any text");
 * // embedding.vector    → Float32Array(384) filled with 0
 * // embedding.model     → "lancedb-fallback"
 * // embedding.dimensions → 384
 * // embedding.tokens_in  → 0
 * ```
 */
export class LanceDbEmbedder implements Embedder {
  readonly model: string;
  readonly dimensions: number;

  constructor(model: string = "lancedb-fallback", dimensions: number = 384) {
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(_text: string): Promise<Embedding> {
    return {
      vector: Array.from({ length: this.dimensions }, () => 0),
      model: this.model,
      dimensions: this.dimensions,
      tokens_in: 0,
    };
  }

  async embedBatch(texts: string[]): Promise<Embedding[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
