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

    // Approximate character-to-token ratio for splitting
    const charsPerToken = text.length / totalTokens;
    const chunkCharSize = Math.max(
      Math.floor(this.maxTokens * charsPerToken),
      1,
    );
    const minChunkCharSize = Math.floor(this.minTokens * charsPerToken);

    const chunks: Chunk[] = [];
    let offset = 0;
    let index = 0;

    while (offset < text.length) {
      let end = Math.min(offset + chunkCharSize, text.length);

      // Ensure we don't leave a trailing chunk below minChunkCharSize
      const remaining = text.length - end;
      if (remaining > 0 && remaining < minChunkCharSize) {
        // Merge remaining into this chunk
        end = text.length;
      }

      const content = text.slice(offset, end);
      const tokenCount = await this.tokenEstimator.estimate(content);

      chunks.push({
        content,
        core_content: content,
        chunk_index: index,
        total_chunks: 0, // will fix after we know total
        strategy: this.strategy,
        size_tokens: tokenCount,
      });

      offset = end;
      index++;
    }

    // Fix total_chunks for all chunks
    for (const c of chunks) {
      c.total_chunks = chunks.length;
    }

    return chunks;
  }
}
