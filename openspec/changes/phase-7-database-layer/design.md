## Context

IndeX needs a persistent, local, serverless vector database for storing chunk embeddings and file AST indices. LanceDB is an embedded vector DB written in Rust with Lance columnar format — it supports ANN (via IVF-PQ), FTS (BM25), and runs in-process with no external server.

## Goals / Non-Goals

**Goals:**
- Two LanceDB tables: `sources` (chunks with embeddings) and `file_index` (AST summaries)
- `sources` table schema: all `SourceData` fields including multi-column `vect_{model_name}` vectors
- `file_index` table schema: path (primary key), file_blake3, language, imports, exports, symbols, relationships, last_parsed
- Full CRUD: upsert, getById, getByPath, delete, search (ANN + FTS), stats
- Hybrid search: ANN (cosine similarity) + BM25 FTS with normalizable weights
- Multi-column ANN: search each `vect_{model}` column independently and merge results
- `MockSourceRepository`: In-memory Map-based implementation for unit tests
- In-memory LanceDB mode for unit tests (no filesystem dependency)

**Non-Goals:**
- No table migrations (schema is defined at creation time and assumed stable)
- No replication or sharding
- No backup/restore (local filesystem suffices for a personal tool)

## Decisions

- **Two-table design**: Separates chunk data from file-level AST data. `file_index` has one row per file; `sources` has many rows per file. This avoids duplicating AST data across every chunk.
- **Multi-column vectors**: Each embedding model gets its own column (`vect_nomic_embed_text`, `vect_mxbai_embed_large`). LanceDB supports querying specific vector columns. This is more space-efficient than storing all vectors in one column with a model discriminator.
- **`chunk_id = source_id:chunk_index`**: Enables lookups by source without knowing individual chunk IDs. `getBySourceId(source_id)` returns all chunks for a file.
- **MockSourceRepository in-memory**: Uses `Map<string, SourceData>` for zero-dependency fast tests. All search operations are simplified (linear scan + in-memory sort) — correctness for orchestration logic, not search quality.
- **LanceDB in-memory mode**: `lancedb.connect("memory://")` creates a temporary database. Tests don't write to disk, don't need cleanup, and run fast.

## Risks / Trade-offs

- **LanceDB vector search quality**: IVF-PQ is approximate. For a personal note-taking app with <100K chunks, exact search (brute force) would work fine. Mitigation: configure IVF-PQ with conservative parameters (high probe count).
- **Windows compatibility**: LanceDB ships prebuilt binaries for win32-x64. Verify with `bun add @lancedb/lancedb` during development.
