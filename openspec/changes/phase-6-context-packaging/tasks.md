## 1. BLAKE3Deduplicator

- [ ] 1.1 **RED**: Write `tests/infrastructure/context/BLAKE3Deduplicator.test.ts` — dedup by semantic_blake3, duplicate removal keeps max score, O(n) via Map, no side effects on unique entries
- [ ] 1.2 **GREEN**: Create `src/infrastructure/context/BLAKE3Deduplicator.ts` — Map<semantic_blake3, SearchResult>, keeps max score
- [ ] 1.3 **TEST**: Run `bun test tests/infrastructure/context/BLAKE3Deduplicator.test.ts` — all tests pass

## 2. GPTCodeTokenizer

- [ ] 2.1 **RED**: Write `tests/infrastructure/context/GPCTokenizer.test.ts` — count("hello world") returns token number, truncate(text, 50) ≈ 50 tokens, truncate at word boundary (not mid-word), empty text = 0 tokens
- [ ] 2.2 **GREEN**: Create `src/infrastructure/context/GPTCodeTokenizer.ts` — use `gpt-tokenizer` for count, greedy word-safe truncation, implement `Tokenizer` interface
- [ ] 2.3 **TEST**: Run `bun test tests/infrastructure/context/GPCTokenizer.test.ts` — all tests pass

## 3. RAGContextPacker

- [ ] 3.1 **RED**: Write `tests/infrastructure/context/RAGContextPacker.test.ts` — full pipeline: dedup → sort → greedy truncation → markdown, truncated=true when over max_tokens, source_notes from unique paths, format='rag' includes system prompt, format='context' is plain markdown
- [ ] 3.2 **GREEN**: Create `src/infrastructure/context/RAGContextPacker.ts` — orchestrates pipeline with injectable Deduplicator and Tokenizer, implements `ContextPacker`
- [ ] 3.3 **TEST**: Run `bun test tests/infrastructure/context/` — all context tests pass
