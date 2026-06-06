## 1. IndexingService

- [x] 1.1 **RED**: Write `tests/domain/services/IndexingService.test.ts` — mock-mode all dependencies:
  - Test: scan directory → parse → chunk → embed → upsert pipeline
  - Test: exclude patterns skip matching files
  - Test: multi-model embedding calls all applicable models
- [x] 1.2 **GREEN**: Create `src/domain/services/IndexingService.ts` — orchestrates: scan → filter → parse → chunk → embed (per applicable model) → upsert batch
- [x] 1.3 **TEST**: Run `bun test tests/domain/services/IndexingService.test.ts` — all tests pass

## 2. SearchService

- [x] 2.1 **RED**: Write `tests/domain/services/SearchService.test.ts` — mock-mode:
  - Semantic search via MockEmbedder + MockSourceRepository
  - Keyword search via MockSourceRepository (FTS/BM25)
  - Hybrid search with weighted merging
  - BM25 normalization `(bm25 - min)/(max - min)`
  - Post-filter by tags, source_type, date range
  - Multi-model: results merged, hybrid_weight averaged
  - Empty index returns []
- [x] 2.2 **GREEN**: Create `src/domain/services/SearchService.ts` — three-mode search, BM25 normalization, post-filter, multi-model averaging, configurable hybrid_weight
- [x] 2.3 **TEST**: Run `bun test tests/domain/services/SearchService.test.ts` — all tests pass

## 3. DiffIndexingService

- [x] 3.1 **RED**: Write `tests/domain/services/DiffIndexingService.test.ts` — mock-mode:
  - file_blake3 matches → skip (no re-processing)
  - file_blake3 differs → re-parse, re-chunk, re-embed
  - semantic_blake3 of removed chunk referenced by other file → don't delete
  - FileIndex rebuilt on file change
  - New file → full processing
- [x] 3.2 **GREEN**: Create `src/domain/services/DiffIndexingService.ts` — compare hashes, diff re-processing, cross-file dedup, FileIndex rebuild
- [x] 3.3 **TEST**: Run `bun test tests/domain/services/` — all service tests pass
