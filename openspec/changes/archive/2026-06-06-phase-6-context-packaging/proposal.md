## Why

After search returns raw results, they need to be deduplicated, sorted, token-counted, truncated, and formatted into a prompt-ready Markdown document for an LLM. Without the Context Packaging System, search results are unusable for RAG. This phase builds the BLAKE3-based deduplicator, GPT-compatible tokenizer, and the RAGContextPacker that orchestrates the full pipeline.

## What Changes

- Create `src/infrastructure/context/BLAKE3Deduplicator.ts` — O(n) dedup by `semantic_blake3` keeping max score entry
- Create `tests/infrastructure/context/BLAKE3Deduplicator.test.ts` before implementation (RED → GREEN)
- Create `src/infrastructure/context/GPTCodeTokenizer.ts` — token counting and truncation using gpt-tokenizer
- Create `tests/infrastructure/context/GPCTokenizer.test.ts` before implementation
- Create `src/infrastructure/context/RAGContextPacker.ts` — orchestrates dedup → sort → greedy truncation → markdown formatting with system prompt
- Create `tests/infrastructure/context/RAGContextPacker.test.ts` before implementation

## Capabilities

### New Capabilities
- `blake3-deduplicator`: O(n) deduplication of search results by `semantic_blake3` hash, keeping the entry with the highest `score`
- `gpt-tokenizer`: Token counting with GPT-compatible tokenizer (`gpt-tokenizer` or `tiktoken`), word-safe truncation to `max_tokens`
- `rag-context-packer`: End-to-end pipeline — deduplicate → sort by score (desc) → greedy-fit by token budget → format as RAG-ready Markdown with system prompt, `source_notes`, `truncated` flag, and chunk metadata

### Modified Capabilities
- None

## Impact

- Adds 3 implementation files in `src/infrastructure/context/`
- Adds 3 test files in `tests/infrastructure/context/`
- New dependency: `gpt-tokenizer` or `tiktoken`
- Depends on Phase 1 (PackedContext, ContextOptions, Deduplicator, Tokenizer, ContextPacker interfaces), Phase 2 (BLAKE3 hasher)
- Unlocks Phase 8 (SearchService returns results → ContextPacker formats them) and Phase 9 (PackUseCase)
