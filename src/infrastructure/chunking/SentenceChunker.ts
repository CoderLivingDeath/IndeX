import type { Chunk, Chunker } from "../../domain/systems/ChunkingSystem";
import type { TokenEstimator } from "../../domain/systems/HashingSystem";
import type { SourceType } from "../../domain/types";
import { OverflowChunker } from "./OverflowChunker";

const DEFAULT_ABBREVIATIONS = [
  "Mr",
  "Mrs",
  "Dr",
  "e.g",
  "i.e",
  "vs",
  "etc",
  "Jr",
  "Sr",
  "St",
];

/**
 * Splits text at sentence boundaries (.!?) with abbreviation protection.
 * Single sentences that exceed maxTokens are delegated to OverflowChunker.
 */
export class SentenceChunker implements Chunker {
  readonly type: SourceType = "markdown";
  readonly strategy = "sentence";
  private readonly abbreviations: string[];

  constructor(
    private readonly maxTokens: number,
    private readonly tokenEstimator: TokenEstimator,
    private readonly fallback: OverflowChunker,
    abbreviations?: string[],
  ) {
    // Normalize abbreviations: strip trailing dot for comparison
    this.abbreviations = (abbreviations ?? DEFAULT_ABBREVIATIONS).map((a) =>
      a.endsWith(".") ? a.slice(0, -1) : a,
    );
  }

  async chunk(text: string): Promise<Chunk[]> {
    if (!text) return [];

    const sentences = this.splitSentences(text);
    if (sentences.length === 0) return [];

    // Estimate tokens for each sentence
    const sentenceTokenCounts = await Promise.all(
      sentences.map((s) => this.tokenEstimator.estimate(s)),
    );

    const chunks: Chunk[] = [];
    let currentGroup: string[] = [];
    let currentTokens = 0;
    let chunkIndex = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const tokenCount = sentenceTokenCounts[i];

      // Single sentence exceeds maxTokens → delegate to overflow
      if (tokenCount > this.maxTokens && currentGroup.length === 0) {
        const overflowChunks = await this.fallback.chunk(sentence);
        for (const oc of overflowChunks) {
          chunks.push({
            ...oc,
            chunk_index: chunkIndex++,
            total_chunks: 0,
          });
        }
        continue;
      }

      // Check if adding this sentence would exceed maxTokens
      if (currentTokens + tokenCount > this.maxTokens && currentGroup.length > 0) {
        // Flush current group
        chunks.push(
          this.makeChunk(currentGroup.join(" "), currentTokens, chunkIndex++),
        );
        currentGroup = [];
        currentTokens = 0;
      }

      currentGroup.push(sentence);
      currentTokens += tokenCount;
    }

    // Flush last group
    if (currentGroup.length > 0) {
      chunks.push(
        this.makeChunk(currentGroup.join(" "), currentTokens, chunkIndex++),
      );
    }

    // Fix total_chunks
    for (const c of chunks) {
      c.total_chunks = chunks.length;
    }

    return chunks;
  }

  /**
   * Splits text into individual sentences, respecting abbreviations.
   */
  private splitSentences(text: string): string[] {
    const boundaries = this.findSentenceBoundaries(text);
    if (boundaries.length === 0) return [text.trim()].filter(Boolean);

    const sentences: string[] = [];
    let start = 0;

    for (const boundary of boundaries) {
      const sentence = text.slice(start, boundary).trim();
      if (sentence) {
        sentences.push(sentence);
      }
      start = boundary;
    }

    // Remaining text after last boundary
    const remaining = text.slice(start).trim();
    if (remaining) {
      sentences.push(remaining);
    }

    return sentences;
  }

  /**
   * Finds positions of sentence-ending punctuation that are NOT abbreviations.
   */
  private findSentenceBoundaries(text: string): number[] {
    const boundaries: number[] = [];
    const regex = /[.!?](?:\s|$)/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const pos = match.index;

      // Check if the word before the punctuation is an abbreviation
      const beforeText = text.slice(0, pos);
      const precedingWords = beforeText.split(/[\s\n]/);
      const lastWord = precedingWords[precedingWords.length - 1] || "";
      const candidate = lastWord.replace(/[.!?]+$/, "").replace(/^[\W]+/, "");

      if (!this.abbreviations.includes(candidate)) {
        // Boundary is after the punctuation
        boundaries.push(pos + 1);
      }
    }

    return boundaries;
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
