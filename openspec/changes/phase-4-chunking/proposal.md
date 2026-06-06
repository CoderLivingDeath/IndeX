## Why

Raw parsed content is too large to embed as a single vector. The chunking system splits documents into semantic units (paragraphs, functions, classes) sized for embedding models (max 512 tokens). Without chunking, there is no way to create searchable embeddings with meaningful granularity. The pipeline architecture (heading → paragraph → sentence → overflow) ensures graceful degradation for content of any structure.

## What Changes

- Create `tests/mocks/MockChunker.ts` and `tests/mocks/MockTokenEstimator.ts` for downstream tests
- Create `src/infrastructure/chunking/HeadingChunker.ts` — splits Markdown by headings
- Create `tests/infrastructure/chunking/HeadingChunker.test.ts` before implementation (RED → GREEN)
- Create `src/infrastructure/chunking/ParagraphChunker.ts` — splits by blank lines, delegates to SentenceChunker for long paragraphs
- Create `tests/infrastructure/chunking/ParagraphChunker.test.ts` before implementation
- Create `src/infrastructure/chunking/SentenceChunker.ts` — splits at sentence boundaries with abbreviation protection
- Create `tests/infrastructure/chunking/SentenceChunker.test.ts` before implementation
- Create `src/infrastructure/chunking/OverflowChunker.ts` — forced token-boundary split as last resort
- Create `tests/infrastructure/chunking/OverflowChunker.test.ts` before implementation
- Create `src/infrastructure/chunking/CodeChunker.ts` — splits code by function/class boundaries (indivisible units)
- Create `tests/infrastructure/chunking/CodeChunker.test.ts` before implementation
- Create `src/infrastructure/chunking/ChunkerFactory.ts` — builds pipeline with fallback chain + merge + overlap
- Create `tests/infrastructure/chunking/ChunkerFactory.test.ts` before implementation

## Capabilities

### New Capabilities
- `heading-chunker`: Split Markdown by heading levels, return whole sections as chunks (or delegate to fallback if section > max_tokens)
- `paragraph-chunker`: Split by blank-line boundaries, recursively delegate long paragraphs to sentence chunker
- `sentence-chunker`: Sentence-boundary split with abbreviation protection (Mr., Dr., etc.)
- `overflow-chunker`: Last-resort token-boundary split when no other strategy fits
- `code-chunker`: Function/class-aware code splitting — each function/class is an indivisible chunk
- `chunker-factory`: Build configurable pipeline (`heading → paragraph → sentence → overflow`) with overlap (32 tokens), min-chunk merge (50 tokens), and per-strategy `core_content` extraction

### Modified Capabilities
- None

## Impact

- Adds 7 implementation files in `src/infrastructure/chunking/`
- Adds 7 test files in `tests/infrastructure/chunking/`
- Adds 2 mock files in `tests/mocks/`
- Depends on Phase 1 (Chunk, ChunkStrategy, Chunker, ChunkerPipeline interfaces), Phase 2 (TokenEstimator)
- Uses `MarkdownAstParser` (from Phase 10) for heading extraction — can use a stub initially
- Unlocks Phase 6 (ContextPacker needs chunks) and all services/use cases
