import type { Chunk, Chunker } from "../../domain/systems/ChunkingSystem";
import type { TokenEstimator } from "../../domain/systems/HashingSystem";
import type { SourceType } from "../../domain/types";

/**
 * Splits Markdown content by heading boundaries (#, ##, etc.).
 * Sections that exceed maxTokens cause early termination — valid sections
 * collected before the over-long section are returned so the pipeline
 * gets partial results rather than an empty fallback.
 */
export class HeadingChunker implements Chunker {
  readonly type: SourceType = "markdown";
  readonly strategy = "heading";

  constructor(
    private readonly maxTokens: number,
    private readonly tokenEstimator: TokenEstimator,
  ) {}

  async chunk(text: string): Promise<Chunk[]> {
    if (!text) return [];

    const sections = this.extractSections(text);
    if (sections.length === 0) return [];

    const chunks: Chunk[] = [];
    let chunkIndex = 0;

    for (const section of sections) {
      const tokenCount = await this.tokenEstimator.estimate(
        section.fullContent,
      );

      if (tokenCount > this.maxTokens) {
        // Section too long → stop here, return valid sections collected so far
        // Over-long section data is lost — caller should ensure it's handled elsewhere
        break;
      }

      chunks.push({
        content: section.fullContent,
        core_content: section.body,
        chunk_index: chunkIndex++,
        total_chunks: 0,
        strategy: this.strategy,
        size_tokens: tokenCount,
      });
    }

    // Fix total_chunks
    for (const c of chunks) {
      c.total_chunks = chunks.length;
    }

    return chunks;
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
