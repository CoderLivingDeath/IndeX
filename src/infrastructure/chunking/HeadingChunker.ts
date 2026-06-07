import type { Chunk, Chunker } from "../../domain/systems/ChunkingSystem";
import type { TokenEstimator } from "../../domain/systems/HashingSystem";
import type { SourceType } from "../../domain/types";

/**
 * Splits Markdown content by heading boundaries (#, ##, etc.).
 * Sections that exceed maxTokens are delegated to the fallback chunker
 * (paragraph → sentence → overflow chain) so no content is lost.
 * Each chunk includes its heading as context, and oversized sections
 * are split at paragraph/sentence boundaries while preserving the heading.
 */
export class HeadingChunker implements Chunker {
  readonly type: SourceType = "markdown";
  readonly strategy = "heading";

  constructor(
    private readonly maxTokens: number,
    private readonly tokenEstimator: TokenEstimator,
    private readonly fallback?: Chunker,
  ) {}

  async chunk(text: string): Promise<Chunk[]> {
    if (!text) return [];

    const sections = this.extractSections(text);
    if (sections.length === 0) return [];

    const chunks: Chunk[] = [];
    let chunkIndex = 0;

    for (let si = 0; si < sections.length; si++) {
      const section = sections[si];
      const tokenCount = await this.tokenEstimator.estimate(
        section.fullContent,
      );

      if (tokenCount <= this.maxTokens) {
        chunks.push({
          content: section.fullContent.trim(),
          core_content: section.body.trim(),
          chunk_index: chunkIndex++,
          total_chunks: 0,
          strategy: this.strategy,
          size_tokens: tokenCount,
        });
        continue;
      }

      // Section too long — delegate to fallback chain
      if (this.fallback) {
        const subChunks = await this.fallback.chunk(section.body);
        for (const sc of subChunks) {
          // Prepend section heading to every sub-chunk for context
          const heading = section.heading || this.findSecondLevelHeading(section.body);
          const withHeading = heading
            ? heading + "\n\n" + sc.content
            : sc.content;
          const tokenCount2 = await this.tokenEstimator.estimate(withHeading);
          chunks.push({
            content: withHeading,
            core_content: sc.core_content || sc.content,
            chunk_index: chunkIndex++,
            total_chunks: 0,
            strategy: this.strategy,
            size_tokens: tokenCount2,
          });
        }
      } else {
        // No fallback — just add oversized section as-is (better than losing data)
        chunks.push({
          content: section.fullContent.trim(),
          core_content: section.body.trim(),
          chunk_index: chunkIndex++,
          total_chunks: 0,
          strategy: this.strategy,
          size_tokens: tokenCount,
        });
      }
    }

    // Fix total_chunks
    for (const c of chunks) {
      c.total_chunks = chunks.length;
    }

    return chunks;
  }

  /** Find a second-level heading inside body as fallback context. */
  private findSecondLevelHeading(text: string): string {
    const m = text.match(/^##\s+(.+)$/m);
    return m ? m[0].trim() : "";
  }

  /**
   * Extracts heading-delimited sections from Markdown text.
   * Returns { heading, body, fullContent } for each section.
   */
  private extractSections(
    text: string,
  ): Array<{ heading: string; body: string; fullContent: string }> {
    const lines = text.split("\n");
    const sections: Array<{
      heading: string;
      bodyLines: string[];
      fullContent: string;
    }> = [];

    let currentHeading = "";
    let currentBodyLines: string[] = [];
    let currentFullLines: string[] = [];

    for (const line of lines) {
      const headingMatch = line.match(/^#{1,6}\s/);
      if (headingMatch) {
        // Save previous section
        if (currentFullLines.length > 0) {
          sections.push({
            heading: currentHeading,
            bodyLines: [...currentBodyLines],
            fullContent: currentFullLines.join("\n"),
          });
        }

        currentHeading = line;
        currentBodyLines = [];
        currentFullLines = [line];
      } else {
        currentFullLines.push(line);
        if (currentHeading) {
          currentBodyLines.push(line);
        }
      }
    }

    // Save last section
    if (currentFullLines.length > 0) {
      sections.push({
        heading: currentHeading,
        bodyLines: [...currentBodyLines],
        fullContent: currentFullLines.join("\n"),
      });
    }

    return sections.map((s) => ({
      heading: s.heading,
      body: s.bodyLines.join("\n").trim(),
      fullContent: s.fullContent.trim(),
    }));
  }
}
