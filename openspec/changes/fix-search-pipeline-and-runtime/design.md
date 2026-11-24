## Context

IndeX already has a clean ports-and-adapters layout, a composition root (`src/index.ts`), and a broad test suite. The failures are behavioural, not structural:

- `SearchUseCase` and `SearchService` both embed the query and discard the result; `LanceDbSourceRepository` only enters its ANN branches when `query.filters.vector` is present. No production code sets it, so `semantic` and `hybrid` fall through to keyword search.
- `SearchService` (normalization, hybrid merge, post-filtering) and `LanceDbSourceRepository` (a second hybrid merge with hardcoded 0.7/0.3) implement overlapping ranking logic; the former is instantiated in `createApp()` but never wired into `SearchUseCase`.
- Ingest dedup (`hasSemanticBlake3`) removes entire files from storage when all their chunks already exist elsewhere, so those paths disappear from search results and stats.
- `SyncUseCase` persists the tree snapshot before indexing, permanently hiding a failed pass.
- chokidar 5 removed glob support, but the watcher passes glob strings to `ignored`; `unlink` only logs.
- `createApp()` has an operator-precedence bug that ignores an injected logger; strict `tsc` reports errors because `bun test` does not type-check.

The index schema stays as-is (`sources`, `file_index`, `db_meta`), so no data migration is required beyond recomputing derived stats on the next index.

## Goals / Non-Goals

**Goals:**

- Make `semantic` and `hybrid` search use real ANN results, with a typed query-vector contract and monotonic similarity scores.
- Establish one ranking pipeline with config-driven weights and filters.
- Preserve every indexed file's discoverability while still reusing embeddings for duplicate content.
- Make `sync` failure-safe and idempotent; make `watch` respect ignores and deletions.
- Fix logging precedence, config defaults, CLI option handling, and MCP exposure.
- Make `tsc --noEmit` pass and keep the test suite deterministic.

**Non-Goals:**

- Multi-vector columns per embedding model (the registry still selects one model per source type).
- A normalized `files`/`chunks` schema or data migration tooling.
- Rewriting parsers/chunkers beyond the type fixes needed for a clean typecheck.
- Changing the public CLI output contract beyond adding missing behaviour and correcting docs.

## Decisions

### 1. First-class `SearchQuery.vector`

Add `vector?: number[]` to `SearchQuery`; keep `filters` for non-vector filters and stop reading `filters.vector`.

- **Why:** the repository needs a typed, unambiguous input; the current untyped `Record<string, unknown>` silently allowed the vector to be lost.
- **Alternatives:** keep `filters.vector` (untyped, bug-prone); embed inside the repository (would force a domain adapter to depend on an embedder, violating the ports boundary).

### 2. `SearchService` is the single ranking engine

`SearchUseCase` embeds the query once and delegates to `SearchService.execute(query, vector)`. `SearchService` performs semantic/keyword/hybrid merging with `search.hybrid_weight`, normalization, and post-filtering. The repository's own hybrid branch is not used by the use case (it remains only as a low-level fallback and is documented as such).

- **Why:** the merge/normalization logic and tests already exist in `SearchService`; duplicating it in the repository caused divergent weights.
- **Alternatives:** move all merging into `LanceDbSourceRepository` (couples ranking to storage); keep both (current state, guaranteed drift).

### 3. Cosine distance, similarity score

Vector queries use `vectorSearch(vec).distanceType("cosine")`. The repository maps `distance` to `score = clamp(1 - distance, 0, 1)`; higher is better and results are sorted descending.

- **Why:** the e5-family models are trained for cosine similarity; LanceDB's default L2 distance grows with dissimilarity, which the current code incorrectly sorts descending.
- **Alternatives:** `1 / (1 + distance)` (monotonic but arbitrary scale); L2 with `1 - d/√2` (valid only for normalized vectors and harder to reason about).

### 4. Dedup at embedding level, persist at row level

Add `SourceRepository.getEmbeddingBySemanticHash(hash): Promise<number[] | null>`. During ingest, for each chunk:

1. Compute `semantic_blake3`.
2. If a vector for this hash is already known (in-batch map or repository), reuse it.
3. Always upsert the chunk row for the current file.

`total_deduped_chunks` reports the number of reused vectors (an efficiency metric), not the number of dropped rows.

- **Why:** path attribution is required for search results, stats, and deletion; dropping rows makes files invisible. Reusing vectors keeps the expensive work deduplicated.
- **Alternatives:** normalized file→chunk mapping (correct but a schema change); disable dedup entirely (correct but re-embeds cross-file duplicates); keep row dropping (current bug).

### 5. Failure-safe sync ordering

`SyncUseCase` performs: prune stale paths → index changed files → persist snapshot hash/entries **only if** `idxErrors === 0`. Deletions remain idempotent. If indexing fails, the previous snapshot stays, so the next `sync` retries.

- **Why:** the snapshot is both a fast-path cache and an implicit checkpoint; writing it before the work claims success that did not happen.
- **Alternatives:** per-file checkpoints (more state, more edge cases); always re-index everything (defeats the purpose).

### 6. chokidar 5 ignore predicates

Translate ignore globs into a predicate using the existing `matchesAny()` helper: `ignored: (p) => matchesAny(patterns, p)`. Keep the debounce map and debounce delay unchanged.

- **Why:** chokidar 4+ removed glob strings; passing them silently ignores nothing, which can create an `.indeX/` write → watch → reindex feedback loop.
- **Alternatives:** add `picomatch` directly (duplicate of `globMatcher`); downgrade chokidar (loses v5 fixes).

### 7. Watch deletion is a first-class operation

`WatchUseCase` receives the repository (or a `DeleteUseCase`) and on `unlink` calls `deleteByPath(path)` and `deleteFileIndex(path)`. Add/change continue to go through `DiffIndexingService.diffIndexFile()`.

- **Why:** without it, deleted files stay searchable until a manual `sync`, contradicting "watch keeps the index in sync".
- **Alternatives:** trigger a full `sync` on every unlink (correct but expensive and racy); leave deletion to `sync` (current gap).

### 8. Logger selection is explicit

Replace the mixed `??`/ternary expression with:

```ts
const logger = options?.logger
  ?? (options?.testMode ? new SilentLogger() : new PinoLogger({ ... }));
```

For MCP, create the app with a stderr-backed `PinoLogger` (the constructor already accepts a destination stream) so stdout remains a clean JSON-RPC channel.

- **Why:** the current expression chooses `SilentLogger` whenever any truthy value is passed, including a real logger.
- **Alternatives:** factory function (unnecessary for one call site); remove logger injection (breaks tests and MCP).

### 9. Config defaults use globs and deep clones

Change the Zod default exclude list to the same glob patterns as `defaultConfig` and return `structuredClone(defaultConfig)` from `loadOrDefault()`.

- **Why:** bare names do not match paths under micromatch; shallow copies share nested arrays/maps between callers.
- **Alternatives:** normalize patterns at match time (hides bad defaults); freeze defaults (still shares nested objects).

### 10. Typecheck and tests are gates, not aspirations

- Add `"typecheck": "tsc --noEmit"`.
- Add `"dom"`, `"dom.iterable"` to `lib` and `skipLibCheck: true` for third-party declaration gaps (MCP SDK, Hono, apache-arrow).
- Fix the errors in `src/**`: `exactOptionalPropertyTypes` violations, possible-undefined in chunkers, parser/watch stream types.
- Replace repository-scanning tests with fixture-directory tests; add a real LanceDB `memory://` integration test for semantic/hybrid search and dedup.

### 11. MCP is exposed through the CLI, stdio remains the transport

Add `src/presentation/cli/commands/mcp.ts` (`indeX mcp`), register it in `cli.ts`, and keep `src/presentation/mcp/mcp-entry.ts` as the standalone entry. Document that the server uses stdio, not HTTP/SSE. Build scripts should produce `indeX-mcp` if the `.opencode` config references it, or the config should point at `indeX mcp`.

- **Why:** the existing MCP server is unreachable from a standard install and its config references a non-existent binary.
- **Alternatives:** switch to HTTP/SSE (larger change, conflicts with the stdio implementation and the separate `mcp-server` change); delete MCP entirely (out of scope and loses working code).

## Risks / Trade-offs

- **Score scale changes** → existing callers/tests that assumed descending `_distance` may need updates; document `[0,1]` semantics and update assertions. Rollback is local to the search path.
- **Storage grows** because cross-file duplicate chunks are stored per file → accept for correctness; embeddings are reused, so the dominant cost (inference) stays deduplicated.
- **`getEmbeddingBySemanticHash` adds a query per unique chunk** → batch/deduplicate lookups with an in-memory map; for large first-time indexes the table is empty, and for incremental runs the lookup replaces an embedding call.
- **Snapshot only after success** → a persistently failing file blocks snapshot advancement; sync keeps retrying, which is the desired safety property. Log the failing paths.
- **chokidar predicate cost** → micromatch per event is acceptable at project scale; predicate results are cheap compared with reindexing ignored trees.
- **Typecheck fixes may touch parser/chunker behaviour** → keep changes mechanical (guards/defaults) and covered by existing tests; do not refactor algorithms.
- **MCP stdout contamination** → enforce stderr logging in the MCP command and add a smoke test that stdout contains only the protocol handshake.

## Migration Plan

1. Land the type/contract changes (`SearchQuery.vector`, repository method) with unit tests.
2. Switch `SearchUseCase`/`SearchService` to the vector path and add the LanceDB integration test.
3. Change ingest dedup and sync ordering; re-run `bun test`.
4. Fix watcher/daemon/CLI/config/logging.
5. Add `typecheck`, fix all errors, update README/AGENTS, and build the MCP command.
6. Re-index any local database once (`indeX clear && indeX embed .`) to recompute `total_deduped_chunks`; the LanceDB schema itself is unchanged.

**Rollback:** each step is independently revertible; the search, ingest, and sync changes are confined to their modules. If needed, revert the change and re-run `indeX embed .` to restore previous row counts.

## Open Questions

- Should `search.default_mode` accept `ast` in config, or remain limited to `semantic|keyword|hybrid` with `--ast` as the only AST entry point? (Recommendation: keep the current enum and document `--ast`.)
- Should the standalone `indeX-mcp` binary be built, or should `.opencode/opencode.json` invoke `indeX mcp`? (Recommendation: invoke `indeX mcp`; fewer artifacts.)
- Do we normalize embeddings at ingest to make cosine/L2 equivalent? (Recommendation: no — cosine distance works for both normalized and unnormalized vectors.)
