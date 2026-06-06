import type { Embedder, EmbedderRegistry } from "../../src/domain/systems/EmbeddingSystem";

/**
 * A mock embedder registry that returns pre-configured embedders by source type.
 * Useful for testing registry-dependent logic without a real registry.
 */
export class MockEmbedderRegistry implements EmbedderRegistry {
  private readonly embedders = new Map<string, Embedder>();

  constructor(embedders: Record<string, Embedder> = {}) {
    for (const [sourceType, embedder] of Object.entries(embedders)) {
      this.embedders.set(sourceType, embedder);
    }
  }

  getEmbedder(sourceType: string): Embedder | null {
    return this.embedders.get(sourceType) ?? null;
  }

  register(sourceType: string, embedder: Embedder, _priority: number): void {
    this.embedders.set(sourceType, embedder);
  }
}
