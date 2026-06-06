import type { Embedding, Embedder } from "../../domain/systems/EmbeddingSystem";

/**
 * A parallel multi-model embedder that runs multiple embedders concurrently
 * and collects their results into a `Record<string, Embedding>`.
 *
 * Unlike individual Embedders, MultiModelEmbedder is NOT itself an Embedder.
 * It returns a Record mapping model keys to their Embedding results,
 * tolerating partial failures via Promise.allSettled — failed embedders are
 * silently omitted from the result.
 */
export class MultiModelEmbedder {
  constructor(private readonly embedders: Record<string, Embedder>) {}

  /**
   * Runs all inner embedders in parallel via Promise.allSettled and returns
   * a record of successful results keyed by the embedder's record key.
   *
   * @param text - The text to embed through all configured embedders
   * @returns A record mapping embedder keys to their Embedding results.
   *          Failing embedders are silently omitted. Returns `{}` when
   *          all embedders fail or none are configured.
   */
  async embedAll(text: string): Promise<Record<string, Embedding>> {
    const keys = Object.keys(this.embedders);
    if (keys.length === 0) {
      return {};
    }

    const values = Object.values(this.embedders);
    const results = await Promise.allSettled(
      values.map((e) => e.embed(text)),
    );

    const output: Record<string, Embedding> = {};

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === "fulfilled") {
        output[keys[i]!] = result.value;
      }
    }

    return output;
  }
}
