## Why

Domain services contain the pure business logic of IndeX — orchestrating parsers, chunkers, embedders, and the repository into meaningful operations. `IndexingService` ties together the full indexing pipeline, `SearchService` implements hybrid search (semantic + keyword + multi-model), and `DiffIndexingService` enables incremental updates via the watcher. These services are tested with mocks, no external infrastructure needed.

## What Changes

- Create `src/domain/services/IndexingService.ts` — scan directory → filter → parse → chunk → embed → upsert, with multi-model support and exclude-pattern filtering
- Create `tests/domain/services/IndexingService.test.ts` before implementation (RED → GREEN), using mocks for everything
- Create `src/domain/services/SearchService.ts` — hybrid search (ANN + BM25) with post-filtering, multi-model score averaging, BM25 normalization
- Create `tests/domain/services/SearchService.test.ts` before implementation
- Create `src/domain/services/DiffIndexingService.ts` — watcher-driven incremental indexing comparing `file_blake3`, re-parsing only changed files, cross-file semantic dedup
- Create `tests/domain/services/DiffIndexingService.test.ts` before implementation

## Capabilities

### New Capabilities
- `indexing-service`: Full-file indexing pipeline — scan directory tree, apply include/exclude filters, parse via ParserRegistry, chunk via ChunkerFactory, embed via EmbedderRegistry, upsert to SourceRepository with multi-model vector columns
- `search-service`: Three-mode search (semantic ANN, keyword BM25, hybrid weighted) with post-filtering by tags/type/date, BM25 normalization `(bm25 - min)/(max - min)`, multi-model score averaging, configurable `filter_mode` (post/pre) and `hybrid_weight`
- `diff-indexing-service`: Incremental indexing comparing `file_blake3` hashes — skip unchanged files, re-process changed files, preserve orphaned `semantic_blake3` entries referenced by other files, rebuild FileIndex only for changed files

### Modified Capabilities
- None

## Impact

- Adds 3 implementation files in `src/domain/services/`
- Adds 3 test files in `tests/domain/services/`
- Zero external dependencies (pure business logic tested with mocks)
- Depends on Phase 1 (all port + system interfaces), Phase 2 (BLAKE3Hasher), Phase 3 (ParserRegistry), Phase 4 (ChunkerFactory), Phase 5 (EmbedderRegistry), Phase 7 (MockSourceRepository)
- Unlocks Phase 9 (use cases wrap these services)
