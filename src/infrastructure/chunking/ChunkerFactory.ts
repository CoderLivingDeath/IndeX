import type { Chunk, Chunker, ChunkerPipeline } from "../../domain/systems/ChunkingSystem";
import type { TokenEstimator } from "../../domain/systems/HashingSystem";
import type { SourceType } from "../../domain/types";
import { HeadingChunker } from "./HeadingChunker";
import { ParagraphChunker } from "./ParagraphChunker";
import { SentenceChunker } from "./SentenceChunker";
import { OverflowChunker } from "./OverflowChunker";
import { CodeChunker } from "./CodeChunker";

const MIN_MERGE_TOKENS = 50;
const OVERLAP_TOKENS = 32;

/**
 * Factory that builds ChunkerPipeline instances with configurable
 * fallback strategies and post-processing (merge + overlap).
 */
export class ChunkerFactory {
  constructor(
    private readonly maxTokens: number,
    private readonly tokenEstimator: TokenEstimator,
  ) {}

  /**
   * Creates a pipeline with the given ordered strategy chain.
   */
  createPipeline(strategies: string[]): ChunkerPipeline {
    // Build chunker instances from strategy names
    // For fallback chain, we need to wire dependencies properly:
    // heading → paragraph → sentence → overflow
    // where paragraph depends on sentence, sentence depends on overflow

    // Create all chunkers
    const overflowChunker = new OverflowChunker(
      this.maxTokens,
      50,
      this.tokenEstimator,
    );

    const sentenceChunker = new SentenceChunker(
      this.maxTokens,
      this.tokenEstimator,
      overflowChunker,
    );

    const paragraphChunker = new ParagraphChunker(
      this.maxTokens,
      this.tokenEstimator,
      sentenceChunker,
    );

    const headingChunker = new HeadingChunker(
      this.maxTokens,
      this.tokenEstimator,
    );

    const codeChunker = new CodeChunker(
      this.maxTokens,
      this.tokenEstimator,
    );

    // Map strategy names to instances
    const strategyMap: Record<string, Chunker> = {
      heading: headingChunker,
      paragraph: paragraphChunker,
      sentence: sentenceChunker,
      overflow: overflowChunker,
      code: codeChunker,
    };

    // Build the ordered chain
    const chain = strategies
      .map((s) => strategyMap[s])
      .filter(Boolean) as Chunker[];

    // Separate code chunker (used separately for code type)
    const codeChunkerInstance = chain.find(
      (c) => c.type === "code",
    ) as CodeChunker | undefined;

    // Overflow chunker (used separately for generic type)
    const overflowChunkerInstance = chain.find(
      (c) => c instanceof OverflowChunker,
    ) as OverflowChunker | undefined;

    return {
      chunkers: chain,

      chunk: async (
        text: string,
        type: SourceType,
      ): Promise<Chunk[]> => {
        if (!text) return [];

        let activeChain: Chunker[];

        switch (type) {
          case "code": {
            if (codeChunkerInstance) {
              return codeChunkerInstance.chunk(text);
            }
            // Fall back to overflow if no code chunker in chain
            const oc = chain.find((c) => c.type === "generic" || c instanceof OverflowChunker);
            if (oc) {
              const result = await oc.chunk(text);
              return postProcess(result, this.tokenEstimator);
            }
            return [];
          }

          case "generic": {
            const oc = overflowChunkerInstance ?? chain.find((c) => c instanceof OverflowChunker);
            if (oc) {
              const result = await oc.chunk(text);
              return postProcess(result, this.tokenEstimator);
            }
            return [];
          }

          case "markdown":
          case "obsidian":
          default: {
            activeChain = chain.filter((c) => c.type === "markdown" || c.type === "generic");
            if (activeChain.length === 0) {
              activeChain = chain;
            }

            // Try each chunker in order; use first that returns results
            for (const chunker of activeChain) {
              const result = await chunker.chunk(text);
              if (result.length > 0) {
                return postProcess(result, this.tokenEstimator);
              }
            }
            return [];
          }
        }
      },
    };
  }
}

/**
 * Post-processes chunks: merges small chunks and adds overlap.
 */
async function postProcess(
  chunks: Chunk[],
  estimator: TokenEstimator,
): Promise<Chunk[]> {
  if (chunks.length === 0) return chunks;

  // Step 1: Merge small chunks
  const merged = await mergeSmallChunks(chunks, estimator);

  // Step 2: Add overlap
  return addOverlap(merged, estimator);
}

/**
 * Merges consecutive chunks below MIN_MERGE_TOKENS with the previous chunk.
 */
async function mergeSmallChunks(
  chunks: Chunk[],
  estimator: TokenEstimator,
): Promise<Chunk[]> {
  if (chunks.length <= 1) return chunks;

  // Backward-merge approach: push chunks one by one;
  // if the last result entry is below MIN_MERGE_TOKENS, merge current into it.
  const result: Chunk[] = [chunks[0]];

  for (let i = 1; i < chunks.length; i++) {
    const last = result[result.length - 1];
    if (last.size_tokens < MIN_MERGE_TOKENS) {
      // Merge into last result entry (backward merge)
      const mergedContent = last.content + "\n" + chunks[i].content;
      const mergedCore = last.core_content + "\n" + chunks[i].core_content;
      const mergedTokens = await estimator.estimate(mergedContent);
      result[result.length - 1] = {
        content: mergedContent,
        core_content: mergedCore,
        chunk_index: last.chunk_index,
        total_chunks: 0,
        strategy: last.strategy,
        size_tokens: mergedTokens,
      };
    } else {
      result.push(chunks[i]);
    }
  }

  // Post-loop cleanup: if last result entry is still < MIN_MERGE_TOKENS
  // and there's a previous entry, merge backward into it (handles trailing small chunks)
  if (result.length > 1 && result[result.length - 1].size_tokens < MIN_MERGE_TOKENS) {
    const last = result.pop()!;
    const prev = result[result.length - 1];
    const mergedContent = prev.content + "\n" + last.content;
    const mergedCore = prev.core_content + "\n" + last.core_content;
    const mergedTokens = await estimator.estimate(mergedContent);
    result[result.length - 1] = {
      content: mergedContent,
      core_content: mergedCore,
      chunk_index: prev.chunk_index,
      total_chunks: 0,
      strategy: prev.strategy,
      size_tokens: mergedTokens,
    };
  }

  // Re-index
  for (let i = 0; i < result.length; i++) {
    result[i].chunk_index = i;
    result[i].total_chunks = result.length;
  }

  return result;
}

/**
 * Adds OVERLAP_TOKENS of overlap text from the end of each chunk
 * to the beginning of the next chunk's content.
 * Overlap text is NOT included in core_content.
 */
async function addOverlap(
  chunks: Chunk[],
  estimator: TokenEstimator,
): Promise<Chunk[]> {
  if (chunks.length <= 1) return chunks;

  const result: Chunk[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const current = { ...chunks[i] };

    if (i > 0) {
      const prev = chunks[i - 1];
      const totalTokens = prev.size_tokens || 1;
      const charsPerToken = Math.max(
        prev.content.length / totalTokens,
        1,
      );
      const overlapChars = Math.min(
        Math.floor(OVERLAP_TOKENS * charsPerToken),
        prev.content.length,
      );

      if (overlapChars > 0) {
        const overlapText = prev.content.slice(-overlapChars);
        current.content = overlapText + "\n" + current.content;
        current.size_tokens = await estimator.estimate(current.content);
        // Core content stays unchanged (no overlap)
      }
    }

    result.push(current);
  }

  return result;
}
