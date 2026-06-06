import type { Embedding, Embedder } from "../../domain/systems/EmbeddingSystem";

/**
 * A null embedder that always throws "no embedder available".
 * Used as a fallback when no real embedder is configured for a source type.
 *
 * Implements the Embedder interface to satisfy structural type checks,
 * but rejects every call to embed() with an error.
 */
export class NullEmbedder implements Embedder {
  readonly model: string = "null";
  readonly dimensions: number = 0;

  async embed(_text: string): Promise<Embedding> {
    throw new Error("no embedder available");
  }
}
