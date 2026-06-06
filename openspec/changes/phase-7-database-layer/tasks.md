## 1. MockSourceRepository

- [ ] 1.1 **GREEN**: Create `tests/mocks/MockSourceRepository.ts` — in-memory Map<id, SourceData> + Map<path, FileIndex>, implements ALL SourceRepository methods including upsertBatch, search (linear scan), stats (object size counts), hasSemanticBlake3, hasModelEmbedding, fileIndex methods

## 2. LanceDbSourceRepository

- [ ] 2.1 **RED**: Write `tests/infrastructure/lancedb/LanceDbSourceRepository.test.ts` — in-memory LanceDB mode (`connect("memory://")`):
  - **sources table**: upsert → getById, getByPath, getBySourceId, upsertBatch → batch retrieve, delete → verify removal, deleteBySourceId, deleteByPath
  - **embeddings**: multi-column vect_{model_name}, hasSemanticBlake3, hasModelEmbedding
  - **file_index**: upsertFileIndex, getFileIndex, deleteFileIndex, getFileBlake3ByPath
  - **cleanup**: dropAll deletes all data
- [ ] 2.2 **GREEN**: Create `src/infrastructure/lancedb/LanceDbSourceRepository.ts`:
  - Two tables: `sources` with all SourceData fields, `file_index` with path/file_blake3/language/imports/exports/symbols
  - Multi-column vectors: `vect_{model_name}` per embedding model
  - Hybrid search: ANN (cosine) + FTS (BM25)
  - Implements `SourceRepository` interface fully
- [ ] 2.3 **TEST**: Run `bun test tests/infrastructure/lancedb/LanceDbSourceRepository.test.ts` — all tests pass
