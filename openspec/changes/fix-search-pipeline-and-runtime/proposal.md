## Why

The core promise of IndeX — semantic and hybrid search — is currently not delivered: the query embedding is computed and then discarded, so `semantic`/`hybrid` silently degrade to keyword search and vector search code is unreachable. At the same time, several runtime paths (sync, watch, logging, config defaults, dedup) can silently lose data or misbehave, and the project does not type-check under its own strict tsconfig. Fixing these is a prerequisite for trusting the index and for any further feature work.

## What Changes

- **Search actually uses vectors** — embed the query once, pass the vector through a typed `SearchQuery.vector`, run ANN search with cosine distance, and convert distance to a similarity score. Semantic and hybrid modes return real semantic matches.
- **One ranking pipeline** — `SearchUseCase` delegates to `SearchService`; `SearchService` is the single place for semantic/keyword/hybrid merging and uses `search.hybrid_weight` from config. The repository's duplicate hybrid branch is removed from the production path.
- **Filters and defaults work** — `--tags`, `source_types`, `min_score`, `search.default_mode` and `search.top_k` are honored by the CLI and use case instead of being hardcoded/ignored.
- **Repository search contract** — `vectorSearch(...).distanceType("cosine")`; deterministic `[0,1]` similarity scores; exact tag matching; `getEmbeddingBySemanticHash()` for embedding reuse.
- **Dedup at embedding level, not row level** — every file keeps its own chunk rows (path stays discoverable); already-known `semantic_blake3` values reuse an existing vector instead of deleting the file from the index.
- **Sync is failure-safe** — tree snapshot is persisted only after a successful indexing pass; a failed sync is retried next run instead of being skipped forever.
- **Watch is safe and quiet** — chokidar ignore rules use predicates/regexes (chokidar 5 has no glob support); `unlink` removes the file from the index; daemon launch uses a resolvable entrypoint and never leaves a bogus `starting` state.
- **Config defaults are effective** — default exclude patterns use glob syntax; the default object is deep-cloned; search defaults are typed and validated.
- **DI correctness** — injected `logger` is used (operator-precedence bug fixed); query embedding goes through the shared cache; dead wiring removed.
- **CLI truthfulness** — accurate `--help`, `sync` listed, dead `index` command removed, and the existing `mcp` server is reachable via an `indeX mcp` command.
- **Quality gates** — `bun run typecheck` (`tsc --noEmit`) passes with zero errors, the suite is deterministic (no timeout-by-repository-scan), and README/AGENTS match reality.

**BREAKING**: `SearchQuery.filters.vector` is replaced by the first-class `SearchQuery.vector`; `total_deduped_chunks` now counts reused embeddings, not skipped rows.

## Capabilities

### New Capabilities

- `sync-use-case`: tree-snapshot based prune/reindex contract, including failure-safe snapshot persistence and idempotent reruns.
- `watch-daemon`: daemon lifecycle — spawn target resolution, status transitions, duplicate protection, health reporting.
- `mcp-cli`: CLI exposure of the existing stdio MCP server (`indeX mcp`), help output, and executable mapping.
- `developer-quality-gates`: strict typecheck, deterministic tests, and documentation/CLI consistency checks.

### Modified Capabilities

- `search-use-case`: vector handoff, config-driven defaults, tags/source_types/min_score forwarding, delegation to `SearchService`.
- `search-service`: single ranking engine; hybrid weight from config; cosine similarity scoring; no discarded embedding.
- `lancedb-source-repository`: typed query vector, cosine distance, exact tag filtering, embedding lookup by semantic hash.
- `domain-types`: `SearchQuery.vector` and documented score semantics.
- `indexing-service`: dedup reuses embeddings while persisting every file's chunk rows.
- `diff-indexing-service`: parity with full indexing for embedding reuse, AST summary, and file-index rebuild.
- `chokidar-watcher`: ignore matcher predicates, debounce, and delete-event delivery under chokidar 5.
- `watch-use-case`: `unlink` deletes chunks and file index; add/change reindex behavior preserved.
- `config-loader`: glob-safe defaults, deep-cloned defaults, validated search defaults.
- `cli`: search tags/defaults, accurate help, `sync` listed, dead `index` removed.
- `di-container`: logger precedence, shared cached query embedder, single search pipeline wiring.

## Impact

- **Search**: `src/application/SearchUseCase.ts`, `src/domain/services/SearchService.ts`, `src/infrastructure/lancedb/LanceDbSourceRepository.ts`, `src/domain/types.ts`
- **Ingest**: `src/domain/services/IndexingService.ts`, `src/domain/services/DiffIndexingService.ts`, `src/infrastructure/lancedb/LanceDbSourceRepository.ts`
- **Sync / watch**: `src/application/SyncUseCase.ts`, `src/infrastructure/watcher/ChokidarWatcher.ts`, `src/application/WatchUseCase.ts`, `src/watch/index.ts`, `src/watch/WatchDaemon.ts`
- **Wiring / config / CLI**: `src/index.ts`, `src/config/ConfigLoader.ts`, `src/presentation/cli/cli.ts`, `src/presentation/cli/commands/*`
- **MCP**: `src/presentation/cli/commands/mcp.ts` (new), `package.json` build scripts, `.opencode/opencode.json`
- **Quality**: `package.json` (`typecheck` script), `tests/**` (deterministic fixtures, new integration tests), `README.md`, `AGENTS.md`
- **Dependencies**: no new runtime dependencies; `chokidar` v5 ignore semantics used as intended
- **Follow-ups (not in this change)**: true multi-model vectors (separate columns per model), Docker/packaging, and a larger parser/chunker type cleanup beyond the errors required for typecheck.

## Non-goals

- Implementing genuine multi-model embeddings (current registry still selects one model per source).
- Redesigning the data model into a normalized `files`/`chunks` schema.
- Changing the public index format or migrating existing LanceDB databases (schema remains compatible).
