## 1. Mocks

- [ ] 1.1 **GREEN**: Create `tests/mocks/MockChunker.ts` — implements `Chunker` interface, returns configurable Chunk[]
- [ ] 1.2 **GREEN**: Create `tests/mocks/MockTokenEstimator.ts` — implements `TokenEstimator`, returns configurable counts

## 2. HeadingChunker

- [ ] 2.1 **RED**: Write `tests/infrastructure/chunking/HeadingChunker.test.ts` — split md by headings ≤ max_tokens → one chunk per section, section > max_tokens → falls through, core_content = body without overlap, chunk_index and total_chunks correct
- [ ] 2.2 **GREEN**: Create `src/infrastructure/chunking/HeadingChunker.ts` — use `MarkdownAstParser` (remark) for heading extraction, implement `Chunker` interface
- [ ] 2.3 **TEST**: Run `bun test tests/infrastructure/chunking/HeadingChunker.test.ts` — all tests pass

## 3. ParagraphChunker

- [ ] 3.1 **RED**: Write `tests/infrastructure/chunking/ParagraphChunker.test.ts` — split by blank lines, paragraph ≤ max_tokens → chunk, paragraph > max_tokens → recursive SentenceChunker call
- [ ] 3.2 **GREEN**: Create `src/infrastructure/chunking/ParagraphChunker.ts` — implement `Chunker`, split on `\n\n`, recursive delegation
- [ ] 3.3 **TEST**: Run `bun test tests/infrastructure/chunking/ParagraphChunker.test.ts` — all tests pass

## 4. SentenceChunker

- [ ] 4.1 **RED**: Write `tests/infrastructure/chunking/SentenceChunker.test.ts` — split by .!?, abbreviation protection (Mr., Dr., e.g.), never splits a sentence, overlong sentence → OverflowChunker
- [ ] 4.2 **GREEN**: Create `src/infrastructure/chunking/SentenceChunker.ts` — regex-based sentence splitting with abbreviation list
- [ ] 4.3 **TEST**: Run `bun test tests/infrastructure/chunking/SentenceChunker.test.ts` — all tests pass

## 5. OverflowChunker

- [ ] 5.1 **RED**: Write `tests/infrastructure/chunking/OverflowChunker.test.ts` — forced token-boundary split, min_tokens validation
- [ ] 5.2 **GREEN**: Create `src/infrastructure/chunking/OverflowChunker.ts` — split at token boundary closest to max_tokens
- [ ] 5.3 **TEST**: Run `bun test tests/infrastructure/chunking/OverflowChunker.test.ts` — all tests pass

## 6. CodeChunker

- [ ] 6.1 **RED**: Write `tests/infrastructure/chunking/CodeChunker.test.ts` — function → one chunk, class → one chunk, no overlap for code, indivisible units
- [ ] 6.2 **GREEN**: Create `src/infrastructure/chunking/CodeChunker.ts` — parse by function/class boundaries, implement `Chunker`
- [ ] 6.3 **TEST**: Run `bun test tests/infrastructure/chunking/CodeChunker.test.ts` — all tests pass

## 7. ChunkerFactory + Pipeline

- [ ] 7.1 **RED**: Write `tests/infrastructure/chunking/ChunkerFactory.test.ts` — createPipeline builds ordered fallback chain, merge < 50 token chunks, 32-token overlap on content (not core_content), pipeline handles all strategies
- [ ] 7.2 **GREEN**: Create `src/infrastructure/chunking/ChunkerFactory.ts` — factory builds ChunkerPipeline with fallback chain, merge logic, overlap logic
- [ ] 7.3 **TEST**: Run `bun test tests/infrastructure/chunking/` — all chunking tests pass
