## Context

After search returns raw `SearchResult[]`, the results must be processed into a form usable by an LLM. This means: deduplicate (same semantic content may appear from different searches or overlapping chunks), sort by relevance, trim to token budget, and format as Markdown with system instructions.

## Goals / Non-Goals

**Goals:**
- `BLAKE3Deduplicator`: O(n) dedup via `Map<semantic_blake3, SearchResult>`, keeps entry with highest `score`
- `GPTCodeTokenizer`: `count(text)` returns GPT token count; `truncate(text, maxTokens)` truncates at word boundary to stay within budget
- `RAGContextPacker.pack(results, options)`: Pipeline — deduplicate → sort desc by score → greedy-fit by token budget → format as Markdown → annotated with `chunks_used`, `total_tokens`, `truncated`, `source_notes`
- Format support: `'context'` (plain Markdown) and `'rag'` (with system prompt for LLM)

**Non-Goals:**
- No re-ranking (results are ordered by original search score)
- No compression or summarization
- No streaming output (PackedContext is returned as one object)

## Decisions

- **Greedy truncation vs. smart selection**: Greedy by score is simple and predictable. Smart selection (maximal marginal relevance) would add complexity for marginal gain. Greedy is the right default, with room for future enhancement.
- **Whole-chunk truncation vs. in-chunk truncation**: Chunks are included or excluded whole. Truncating inside a chunk would lose meaning — the chunk is already the minimal semantic unit.
- **`source_notes` from unique paths**: A set of unique `source.path` values across included chunks. Gives the LLM visibility into which files contributed to the context.
- **`format: 'rag'` adds system prompt**: Prepends `"You are a helpful assistant. Use the following context to answer the user's question."` and wraps content in `<context></context>` tags. This matches common LLM prompt patterns.
- **gpt-tokenizer for token counting**: Compatible with GPT-4 tokenization. Falls back to byte-based approximation if not available (same pattern as TokenEstimatorSimple).

## Risks / Trade-offs

- **Greedy by score may miss diversity**: Top-scoring chunks may all come from the same file. Acceptable for v1 — the search service already includes hybrid weights that surface diverse results.
- **No overlap removal within context**: Chunks may have overlapping content (due to the 32-token overlap in chunking). Dedup only catches exact `semantic_blake3` matches, not partial overlaps. Acceptable for v1; overlap is small (32 tokens).
