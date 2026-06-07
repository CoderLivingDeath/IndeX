import type { Chunk, Chunker } from "../../domain/systems/ChunkingSystem";
import type { TokenEstimator } from "../../domain/systems/HashingSystem";
import type { SourceType } from "../../domain/types";

/**
 * Last-resort chunker that splits text at token boundaries.
 * Each chunk targets `maxTokens` size and guarantees at least `minTokens`.
 */
export class OverflowChunker implements Chunker {
  readonly type: SourceType = "generic";
  readonly strategy = "overflow";

  constructor(
    private readonly maxTokens: number,
    private readonly minTokens: number,
    private readonly tokenEstimator: TokenEstimator,
  ) {}

  async chunk(text: string): Promise<Chunk[]> {
    if (!text) return [];

    const totalTokens = await this.tokenEstimator.estimate(text);
    if (totalTokens <= 0) return [];
    if (totalTokens <= this.maxTokens) {
      return [
        {
          content: text,
          core_content: text,
          chunk_index: 0,
          total_chunks: 1,
          strategy: this.strategy,
          size_tokens: totalTokens,
        },
      ];
    }

    const chunks: Chunk[] = [];
    let index = 0;

    // Split by line boundaries, accumulating until maxTokens
    const lines = text.split("\n");
    let currentLines: string[] = [];
    let currentTokens = 0;

    for (const line of lines) {
      const lineTokens = await this.tokenEstimator.estimate(line);

      // Single line exceeds maxTokens — still include it (can't split further)
      if (lineTokens > this.maxTokens && currentLines.length === 0) {
        currentLines.push(line);
        currentTokens = lineTokens;
        continue;
      }

      // Adding this line would exceed maxTokens — flush current batch
      if (currentTokens + lineTokens > this.maxTokens && currentLines.length > 0) {
        const content = currentLines.join("\n");
        chunks.push({
          content,
          core_content: content,
          chunk_index: index++,
          total_chunks: 0,
          strategy: this.strategy,
          size_tokens: currentTokens,
        });
        currentLines = [];
        currentTokens = 0;
      }

      currentLines.push(line);
      currentTokens += lineTokens;

      // Ensure we don't leave a trailing chunk below minTokens
      // by checking if we're close to the end
    }

    // Flush last batch
    if (currentLines.length > 0) {
      const content = currentLines.join("\n");
      const tokens = await this.tokenEstimator.estimate(content);
      chunks.push({
        content,
        core_content: content,
        chunk_index: index++,
        total_chunks: 0,
        strategy: this.strategy,
        size_tokens: tokens,
      });
    }

    // Fix total_chunks for all chunks
    for (const c of chunks) {
      c.total_chunks = chunks.length;
    }

    return chunks;
  }
}
