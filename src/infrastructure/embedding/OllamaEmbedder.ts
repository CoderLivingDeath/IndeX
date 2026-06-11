import type { Embedding, Embedder } from "../../domain/systems/EmbeddingSystem";

/**
 * An HTTP client embedder that calls Ollama's /api/embeddings endpoint.
 *
 * Features:
 * - POSTs text to Ollama's embedding API and returns a Float32Array vector
 * - Exponential backoff: 1s → 2s → 4s delay between up to 3 attempts
 * - Supports AbortSignal for cancellation
 * - embedBatch for processing multiple texts in parallel
 *
 * @example
 * ```ts
 * const embedder = new OllamaEmbedder("nomic-embed-text", 768);
 * const embedding = await embedder.embed("Hello world");
 * ```
 */
export class OllamaEmbedder implements Embedder {
  readonly model: string;
  readonly dimensions: number;
  private readonly baseUrl: string;

  constructor(
    model: string,
    dimensions: number = 384,
    baseUrl: string = "http://localhost:11434",
  ) {
    this.model = model;
    this.dimensions = dimensions;
    this.baseUrl = baseUrl;
  }

  /**
   * Embeds a single text string by POSTing to Ollama's /api/embeddings.
   *
   * On failure, retries with exponential backoff (1s → 2s → 4s, max 3 attempts).
   * Aborted requests (via signal) are not retried — the AbortError propagates.
   *
   * @param text  - The text to embed
   * @param signal - Optional AbortSignal to cancel the request mid-flight
   * @returns An Embedding with the vector as a Float32Array
   */
  async embed(text: string, signal?: AbortSignal): Promise<Embedding> {
    const delays = [1_000, 2_000];
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}/api/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.model, prompt: text }),
          signal,
        });

        if (!response.ok) {
          const bodyText = await response.text().catch(() => "(no body)");
          throw new Error(
            `Ollama API error: ${response.status} ${response.statusText} — ${bodyText.slice(0, 300)}`,
          );
        }

        const data = (await response.json()) as { embedding: number[] };
        const vector = new Float32Array(data.embedding);

        return {
          vector: vector as unknown as number[],
          model: this.model,
          dimensions: this.dimensions,
          tokens_in: Math.ceil(text.length / 4),
        };
      } catch (err) {
        // Don't retry if the caller explicitly aborted
        if (err instanceof DOMException && err.name === "AbortError") {
          throw err;
        }

        lastError = err instanceof Error ? err : new Error(String(err));

        // Wait before the next attempt (skip wait on the final attempt)
        if (attempt < delays.length) {
          await sleep(delays[attempt]!);
        }
      }
    }

    throw lastError ?? new Error("embed failed after 3 attempts");
  }

  /**
   * Embeds multiple texts by calling embed() for each in parallel.
   *
   * Each call inherits the retry logic and AbortSignal support from embed().
   * If one text fails, the entire batch rejects (use Promise.allSettled
   * externally for partial tolerance).
   *
   * @param texts  - Array of texts to embed
   * @param signal - Optional AbortSignal forwarded to each embed() call
   * @returns An array of Embedding results, one per input text
   */
  async embedBatch(texts: string[], signal?: AbortSignal): Promise<Embedding[]> {
    return Promise.all(texts.map((text) => this.embed(text, signal)));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
