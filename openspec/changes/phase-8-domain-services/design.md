## Context

Domain services contain the pure business logic — they orchestrate infrastructure components (parsers, chunkers, embedders, repository) without knowing their concrete implementations. This is the core of the Ports & Adapters architecture: all dependencies are injected as interfaces, and all tests use mocks.

## Goals / Non-Goals

**Goals:**
- `IndexingService.index(directory)`: Scan → filter → for each file: parse → chunk → embed → upsert. Handles multi-model embedding and exclude patterns.
- `SearchService.search(query, options)`: Three modes — semantic (ANN), keyword (BM25), hybrid (weighted combination). BM25 normalization `(bm25 - min)/(max - min)`. Multi-model result merging. Post-filter by tags/type/date.
- `DiffIndexingService.diffIndex(filePath)`: Compare `file_blake3` → skip if unchanged; re-parse, re-chunk, re-embed if changed; handle cross-file `semantic_blake3` dedup (don't delete hashes still referenced by other files).

**Non-Goals:**
- No batching/queueing (single-file-at-a-time for diff indexing is sufficient)
- No progress reporting or streaming (return final result synchronously)

## Decisions

- **IndexingService iterates files sequentially**: File-level parallelism would complicate error handling and may exhaust memory with large repos. Sequential is simpler and predictable. Embedding batching within each file provides sufficient throughput.
- **Search post-filter as default**: ANN first, filter second. Pre-filter (filter before ANN) reduces vector search space but can miss relevant results if the filter is too restrictive. Post-filter is safer for discovery-oriented search.
- **BM25 normalization across current results**: Normalize using min/max of the current result set, not global corpus statistics. This makes hybrid scores relative to the query, which is more intuitive.
- **Multi-model score averaging**: If a chunk is found by two models, the `avg_semantic` is the mean of their cosine scores. This prevents models voting multiple times on the same chunk.
- **DiffIndexing handles cross-file references**: Before deleting a stale chunk, check if another file references the same `semantic_blake3`. This prevents data loss when two files share identical content (e.g., copied code snippets).

## Risks / Trade-offs

- **Sequential indexing may be slow for large vaults**: 10K files × 200ms per file = 33 minutes. Acceptable for initial index (one-time cost). Future optimization: parallel file processing with a worker pool.
- **Post-filter degrades recall with strict filters**: If `tags: ["rare-tag"]` and there are few results, the post-filtered pool may be too small. Mitigation: request `top_k * 2` before filtering.
