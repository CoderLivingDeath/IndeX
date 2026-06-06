import type { Chunk, Chunker } from "../../domain/systems/ChunkingSystem";
import type { TokenEstimator } from "../../domain/systems/HashingSystem";
import type { SourceType } from "../../domain/types";
import { SentenceChunker } from "./SentenceChunker";

/**
 * Splits text by paragraph boundaries (blank lines).
 * Paragraphs that exceed maxTokens are delegated to SentenceChunker.
 */
export class ParagraphChunker implements Chunker {
  readonly type: SourceType = "markdown";
  readonly strategy = "paragraph";

  constructor(
    private readonly maxTokens: number,
    private readonly tokenEstimator: TokenEstimator,
    private readonly fallback: SentenceChunker,
  ) {}

  async chunk(text: string): Promise<Chunk[]> {
    if (!text) return [];

    const paragraphs = this.splitParagraphs(text);
    if (paragraphs.length === 0) return [];

    const chunks: Chunk[] = [];
    let chunkIndex = 0;

    for (const paragraph of paragraphs) {
      const tokenCount = await this.tokenEstimator.estimate(paragraph);

      if (tokenCount <= this.maxTokens) {
        chunks.push(this.makeChunk(paragraph, tokenCount, chunkIndex++));
      } else {
        // Paragraph too long → delegate to SentenceChunker
        const subChunks = await this.fallback.chunk(paragraph);
        for (const sc of subChunks) {
          chunks.push({
            ...sc,
            chunk_index: chunkIndex++,
            total_chunks: 0,
          });
        }
      }
    }

    // Fix total_chunks
    for (const c of chunks) {
      c.total_chunks = chunks.length;
    }

    return chunks;
  }

  /**
   * Splits text into paragraphs by blank line boundaries.
   */
  private splitParagraphs(text: string): string[] {
    return text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  private makeChunk(
    content: string,
    tokenCount: number,
    index: number,
  ): Chunk {
    return {
      content,
      core_content: content,
      chunk_index: index,
      total_chunks: 0,
      strategy: this.strategy,
      size_tokens: tokenCount,
    };
  }
}
