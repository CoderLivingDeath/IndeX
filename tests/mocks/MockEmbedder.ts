import type { Embedding, Embedder } from "../../src/domain/systems/EmbeddingSystem";

/**
 * A mock embedder with configurable model name, dimensions, and return values.
 * By default returns a zero vector of the configured dimension.
 * Useful for testing embedding pipeline logic without a real model.
 */
export class MockEmbedder implements Embedder {
  readonly model: string;
  readonly dimensions: number;

  private _customEmbedding: Embedding | null = null;

  constructor(model: string, dimensions: number) {
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<Embedding> {
    if (this._customEmbedding !== null) {
      return this._customEmbedding;
    }

    return {
      vector: Array.from({ length: this.dimensions }, () => 0),
      model: this.model,
      dimensions: this.dimensions,
      tokens_in: Math.max(1, Math.round(text.length / 4)),
    };
  }

  /** Override the next return value of embed() for testing edge cases. */
  setMockReturnValue(embedding: Embedding): void {
    this._customEmbedding = embedding;
  }

  /** Reset to default behavior (zero vector + approximated token count). */
  resetMockReturnValue(): void {
    this._customEmbedding = null;
  }
}
