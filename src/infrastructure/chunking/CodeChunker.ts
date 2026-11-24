import type { Chunk, Chunker } from "../../domain/systems/ChunkingSystem";
import type { TokenEstimator } from "../../domain/systems/HashingSystem";
import type { SourceType } from "../../domain/types";
import { parse, Lang } from "@ast-grep/napi";

/**
 * Splits TypeScript code by function and class boundaries as indivisible units.
 * Each function or class is one chunk. Non-declaration code is grouped separately.
 * There is no overlap between code chunks.
 */
export class CodeChunker implements Chunker {
  readonly type: SourceType = "code";
  readonly strategy = "code";

  constructor(
    private readonly maxTokens: number,
    private readonly tokenEstimator: TokenEstimator,
  ) {}

  async chunk(text: string): Promise<Chunk[]> {
    if (!text.trim()) return [];

    let sgRoot: ReturnType<typeof parse>;
    try {
      sgRoot = parse(Lang.TypeScript, text);
    } catch {
      // If parsing fails, return the whole text as one chunk
      const tokenCount = await this.tokenEstimator.estimate(text);
      return [
        {
          content: text,
          core_content: text,
          chunk_index: 0,
          total_chunks: 1,
          strategy: this.strategy,
          size_tokens: tokenCount,
        },
      ];
    }

    const topLevelNodes = sgRoot.root().children();

    // Sort all top-level nodes by source position
    const sortedNodes = [...topLevelNodes]
      .map((node) => ({ node, range: node.range() }))
      .sort((a, b) => a.range.start.index - b.range.start.index);

    const chunks: Chunk[] = [];
    let cursor = 0;
    let chunkIndex = 0;

    // Walk through nodes in source order, interleaving decl and non-decl chunks
    for (const { node, range } of sortedNodes) {
      const kind = node.kind();
      if (kind === "function_declaration" || kind === "class_declaration") {
        // Emit non-declaration text before this declaration (if any)
        if (cursor < range.start.index) {
          const otherText = text.slice(cursor, range.start.index).trim();
          if (otherText) {
            const tokenCount = await this.tokenEstimator.estimate(otherText);
            chunks.push({
              content: otherText,
              core_content: otherText,
              chunk_index: chunkIndex++,
              total_chunks: 0,
              strategy: this.strategy,
              size_tokens: tokenCount,
            });
          }
          cursor = range.start.index;
        }

        // Emit declaration as a separate chunk
        const declText = node.text();
        const tokenCount = await this.tokenEstimator.estimate(declText);
        chunks.push({
          content: declText,
          core_content: declText,
          chunk_index: chunkIndex++,
          total_chunks: 0,
          strategy: this.strategy,
          size_tokens: tokenCount,
        });
        cursor = range.end.index;
      }
    }

    // Emit any remaining non-declaration text after the last declaration
    if (cursor < text.length) {
      const remainingText = text.slice(cursor).trim();
      if (remainingText) {
        const tokenCount = await this.tokenEstimator.estimate(remainingText);
        chunks.push({
          content: remainingText,
          core_content: remainingText,
          chunk_index: chunkIndex++,
          total_chunks: 0,
          strategy: this.strategy,
          size_tokens: tokenCount,
        });
      }
    }

    // If no chunks were emitted, return whole text as one chunk
    if (chunks.length === 0) {
      const tokenCount = await this.tokenEstimator.estimate(text);
      chunks.push({
        content: text,
        core_content: text,
        chunk_index: 0,
        total_chunks: 1,
        strategy: this.strategy,
        size_tokens: tokenCount,
      });
      return chunks;
    }

    // Fix total_chunks
    for (const c of chunks) {
      c.total_chunks = chunks.length;
    }

    return chunks;
  }
}
