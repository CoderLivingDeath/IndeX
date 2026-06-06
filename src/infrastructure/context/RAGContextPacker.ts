import type { SearchResult } from "../../domain/types";
import type { ContextPacker, Deduplicator, PackedContext, Tokenizer } from "../../domain/systems/ContextPackagingSystem";

/**
 * Packs search results into a formatted Markdown context for LLM consumption.
 *
 * Pipeline:
 * 1. Deduplicate results via injectable Deduplicator
 * 2. Sort by score descending
 * 3. Greedy-fit into token budget
 * 4. Format as Markdown with optional RAG wrapper
 */
export class RAGContextPacker implements ContextPacker {
  private readonly deduplicator: Deduplicator;
  private readonly tokenizer: Tokenizer;
  private readonly DEFAULT_MAX_TOKENS = 8192;

  constructor(deduplicator: Deduplicator, tokenizer: Tokenizer) {
    this.deduplicator = deduplicator;
    this.tokenizer = tokenizer;
  }

  async pack(
    results: SearchResult[],
    options?: { maxTokens?: number; format?: "rag" | "context" },
  ): Promise<PackedContext> {
    const maxTokens = options?.maxTokens ?? this.DEFAULT_MAX_TOKENS;
    const format = options?.format ?? "context";

    // Step 1: Deduplicate
    const deduped = await this.deduplicator.deduplicate(results);

    if (deduped.length === 0) {
      return {
        markdown: "",
        chunks_used: 0,
        total_tokens: 0,
        truncated: false,
        source_notes: [],
      };
    }

    // Step 2: Sort by score descending (stable)
    const sorted = [...deduped].sort((a, b) => b.score - a.score);

    // Step 3: Greedy-fit into token budget
    const included: Array<{ result: SearchResult; tokens: number }> = [];
    let totalTokens = 0;

    for (const result of sorted) {
      const tokens = await this.tokenizer.count(result.source.content);
      if (totalTokens + tokens <= maxTokens) {
        included.push({ result, tokens });
        totalTokens += tokens;
      } else {
        break; // Budget exceeded — stop
      }
    }

    // Step 4: Format as Markdown
    const parts = included.map(
      ({ result }) => `### Source: ${result.source.path}\n${result.source.content}\n`,
    );
    const markdown = parts.join("");

    // Step 5: Collect unique source paths
    const sourceNotes = [...new Set(included.map(({ result }) => result.source.path))];

    // Build result
    const packed: PackedContext = {
      markdown,
      chunks_used: included.length,
      total_tokens: totalTokens,
      truncated: included.length < sorted.length,
      source_notes: sourceNotes,
    };

    // Step 6: Wrap for RAG format if requested
    if (format === "rag") {
      packed.markdown =
        "You are a helpful assistant. Use the following context to answer the user's question.\n\n<context>\n" +
        markdown +
        "</context>";
    }

    return packed;
  }
}
