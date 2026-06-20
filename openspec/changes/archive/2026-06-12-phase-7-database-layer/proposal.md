## Why

Persistent storage is the backbone of IndeX. Every indexed chunk, its embeddings, and its file-level AST data must be stored and retrievable. LanceDB provides an embedded vector database with both ANN (Approximate Nearest Neighbor) and FTS (Full-Text Search via BM25) — no external server required. This phase implements `LanceDbSourceRepository` as the `SourceRepository` port adapter.

## What Changes

- Create `tests/mocks/MockSourceRepository.ts` — in-memory implementation for unit tests in downstream phases (Phases 8-9)
- Create `src/infrastructure/lancedb/LanceDbSourceRepository.ts` — full LanceDB adapter with two tables (`sources` and `file_index`)
- Create `tests/infrastructure/lancedb/LanceDbSourceRepository.test.ts` before implementation (RED → GREEN)
- Implement all `SourceRepository` methods: upsert, upsertBatch, getById, getByPath, getBySourceId, delete, deleteBySourceId, deleteByPath, search (ANN + FTS), hasSemanticBlake3, hasModelEmbedding, getSourceIdsByHash, getFileBlake3ByPath, stats
- Implement FileIndex methods: upsertFileIndex, getFileIndex, deleteFileIndex
- Multi-column vector support: `vect_{model_name}` for each embedding model

## Capabilities

### New Capabilities
- `mock-source-repository`: In-memory `SourceRepository` implementation for unit testing all downstream services and use cases
- `lancedb-source-repository`: Full `SourceRepository` adapter using LanceDB with two tables (`sources` for chunks, `file_index` for AST), multi-column vector embeddings (`vect_{model_name}`), hybrid search (ANN cosine similarity + FTS BM25), and comprehensive stats

### Modified Capabilities
- None

## Impact

- Adds 1 implementation file in `src/infrastructure/lancedb/`
- Adds 1 test file in `tests/infrastructure/lancedb/`
- Adds 1 mock file in `tests/mocks/`
- New dependency: `@lancedb/lancedb` (LanceDB Node.js binding)
- Depends on Phase 1 (SourceRepository port interface, SourceData, FileIndex types)
- Unlocks Phase 8 (IndexingService, SearchService need persistent storage) and Phase 9 (all use cases)
