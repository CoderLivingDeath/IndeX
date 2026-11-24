## 1. Types and repository contract

- [x] 1.1 Add `vector?: number[]` to `SearchQuery` in `src/domain/types.ts`; document that `score` is a `[0,1]` relevance value and that `filters` is no longer used for vectors.
- [x] 1.2 Add `getEmbeddingBySemanticHash(hash: string): Promise<number[] | null>` to `src/domain/ports/SourceRepository.ts` and implement it in `tests/mocks/MockSourceRepository.ts`.
- [x] 1.3 Implement `getEmbeddingBySemanticHash()` in `src/infrastructure/lancedb/LanceDbSourceRepository.ts` (return `null` for missing table, missing hash, or empty vector).
- [x] 1.4 Change vector queries in `LanceDbSourceRepository.search()` to use `query.vector` instead of `query.filters.vector` and apply `.distanceType("cosine")`.
- [x] 1.5 Map cosine distance to `score = clamp(1 - distance, 0, 1)` and sort results by descending score in all vector paths.
- [x] 1.6 Return an empty result set for `semantic`/`hybrid` when `query.vector` is missing or empty; remove the silent keyword fallback for those modes.
- [x] 1.7 Remove the repository's production hybrid merge (or gate it behind the typed vector path and configured weight) so only one ranking layer merges results.
- [x] 1.8 Add repository tests in `tests/infrastructure/LanceDbSourceRepository.test.ts` for cosine scoring, missing vector, tag filtering, and `getEmbeddingBySemanticHash()`.

## 2. Search pipeline

- [x] 2.1 Change `SearchService` to accept a precomputed vector (`execute(query, vector)`), embed nothing internally, and pass the vector to the repository's semantic leg.
- [x] 2.2 Use `search.hybrid_weight` in `SearchService.mergeHybrid()` and remove hardcoded `0.7/0.3` from the production path.
- [x] 2.3 Forward `tags`, `source_types`, and `min_score` from `SearchUseCase` through `SearchService` to the repository without dropping any field.
- [x] 2.4 Rewrite `SearchUseCase.execute()` to embed the query exactly once, delegate to `SearchService`, and return its results.
- [x] 2.5 Update `SearchSystems` in `src/application/di/Systems.ts` to expose the ranking engine (or its config) needed for delegation.
- [x] 2.6 Update `src/index.ts` to construct a single `SearchService` and inject it into `SearchUseCase`; wrap the search embedder in `CachedEmbedder`.
- [x] 2.7 Delete or explicitly mark the unused direct-repository search path so no code bypasses the ranking engine.
- [x] 2.8 Update `tests/application/SearchUseCase.test.ts` to assert vector handoff, single embedding, filter forwarding, and empty-query behaviour.
- [x] 2.9 Update `tests/domain/services/SearchService.test.ts` for the new signature, config-driven weight, `[0,1]` scores, and missing-vector behaviour.

## 3. Ingest dedup

- [x] 3.1 Add an in-batch `Map<semanticHash, number[]>` and use `repo.getEmbeddingBySemanticHash()` as the cross-batch lookup in `IndexingService`.
- [x] 3.2 Stop skipping chunk rows: always build a `SourceData` row for every chunk and upsert it, reusing the vector when available.
- [x] 3.3 Count reused vectors in `total_deduped_chunks` and keep `total_tokens` accounting based on persisted chunks.
- [x] 3.4 Apply the same embedding-reuse logic to `DiffIndexingService.reprocessFile()`.
- [x] 3.5 Ensure `DiffIndexingService` still appends the AST summary and rebuilds the `FileIndex` on every reprocess.
- [x] 3.6 Add a test proving a file whose chunks all duplicate another file still appears in `getAllPaths()` and search results.
- [x] 3.7 Add a test proving duplicate chunks do not trigger a second embedder call within one run.

## 4. Sync reliability

- [x] 4.1 In `SyncUseCase.execute()`, perform prune and reindex before writing the snapshot hash/entries.
- [x] 4.2 Persist the snapshot only when `delErrors === 0` and `idxErrors === 0`; otherwise keep the previous values and log failing paths.
- [x] 4.3 Return accurate `deleted`, `indexed`, `skipped`, and `errors` counts and log a summary on both success and failure.
- [x] 4.4 Ensure pruning and indexing are idempotent so a retry after failure converges.
- [x] 4.5 Add tests for: unchanged tree no-op, deletion pruning, modified reindex, failed pass keeps old snapshot, retry indexes the missed file.

## 5. Watch reliability

- [x] 5.1 In `ChokidarWatcher`, translate the configured glob patterns into an `ignored` predicate using `matchesAny()` from `src/shared/globMatcher.ts`.
- [x] 5.2 Add tests that `node_modules/`, `.git/`, and `.indeX/` paths are ignored and that a predicate (not raw glob strings) is passed to chokidar.
- [x] 5.3 Inject the repository (or `DeleteUseCase`) into `WatchUseCase` and delete chunks plus file index on `unlink`.
- [x] 5.4 Update `src/index.ts` to pass the repository when constructing `WatchUseCase`.
- [x] 5.5 Add `WatchUseCase` tests for add/change delegation, unlink deletion, and missing-path tolerance.
- [x] 5.6 Fix daemon spawn in `src/watch/index.ts`: resolve the dev entrypoint relative to the CLI module and keep the compiled `watch-daemon` subcommand.
- [x] 5.7 Validate the resolved entrypoint exists before spawning; on failure reset config to `stopped` and exit non-zero.
- [x] 5.8 Ensure `WatchDaemon` writes `error` + `pid: null` on watcher startup failure and `stopped` on SIGTERM/SIGINT.
- [x] 5.9 Verify `watch start`/`status`/`stop` manually on Windows, including the health endpoint and stale PID handling.

## 6. Config, DI, CLI

- [x] 6.1 Change the Zod default `indexing.exclude` in `ConfigLoader.ts` to glob patterns matching `defaultConfig`.
- [x] 6.2 Return a deep clone (`structuredClone(defaultConfig)`) from `loadOrDefault()`.
- [x] 6.3 Fix the logger selection precedence in `createApp()` so an injected logger is used and `testMode` only applies as a fallback.
- [x] 6.4 Update `commands/search.ts` to forward `--tags` and to use `config.search.default_mode` / `config.search.top_k` when flags are omitted.
- [x] 6.5 Remove the dead `index` command import/registration and delete or archive `src/presentation/cli/commands/index.ts`.
- [x] 6.6 Verify `sync` appears in `indeX --help` and that `embed` remains the only full-index command.
- [x] 6.7 Align `--columns` output (flat vs nested `chunk`/`blake3`/`timestamps`) with README; update whichever side diverges.
- [x] 6.8 Add config-loader tests for glob defaults and deep-clone isolation.

## 7. MCP CLI

- [x] 7.1 Create `src/presentation/cli/commands/mcp.ts` and register it in `cli.ts` as `indeX mcp`.
- [x] 7.2 Start the MCP app with a stderr-backed `PinoLogger` (or `SilentLogger`) so stdout carries only JSON-RPC messages.
- [x] 7.3 Keep `src/presentation/mcp/mcp-entry.ts` working for standalone/stdio use and share the startup helper with the CLI command.
- [x] 7.4 Update `.opencode/opencode.json` to reference `indeX mcp` (or add a build script that actually produces the referenced binary).
- [x] 7.5 Add a smoke test that `indeX mcp` writes protocol output to stdout and logs to stderr.
- [x] 7.6 Update the MCP tool count in README/proposal text to match `McpToolRegistry` (10 tools).

## 8. Typecheck and tests

- [x] 8.1 Add `"typecheck": "tsc --noEmit"` to `package.json`.
- [x] 8.2 Update `tsconfig.json` with `lib: ["esnext", "dom", "dom.iterable"]` and `skipLibCheck: true`; keep strict/exactOptionalPropertyTypes enabled for project code.
- [x] 8.3 Fix `exactOptionalPropertyTypes` call sites in `PackUseCase`, `SearchUseCase`, `ChokidarWatcher`, and `createApp`.
- [x] 8.4 Fix possible-undefined errors in `ChunkerFactory`, `HeadingChunker`, `SentenceChunker`, and `CodeChunker` with explicit guards/defaults (no casts).
- [x] 8.5 Fix parser and watcher typing errors in `AstGrepParser`, `CSharpParser`, `ObsidianParser`, `OllamaEmbedder`, `PinoLogger`, `WatchDaemon`, `WatchHealthServer`, and `watch/index.ts`.
- [x] 8.6 Replace `tests/presentation/mcp.test.ts`'s `path: "."` with a temporary fixture directory so the chunk test cannot time out.
- [x] 8.7 Add an in-memory LanceDB integration test: index one document, search with a semantically related query, assert the document is returned in `semantic` and `hybrid` modes.
- [x] 8.8 Run `bun run typecheck` and fix remaining errors until it exits 0.
- [x] 8.9 Run `bun test` and confirm a fully green suite with no timeout failures.

## 9. Documentation and verification

- [x] 9.1 Update `README.md`: search modes and vector behaviour, `--tags`, config defaults, `sync`/`mcp` commands, `--columns` shapes, and dedup wording.
- [x] 9.2 Update `AGENTS.md`: remove the stale CachedEmbedder bug, the `index` command, the old test count, and the false "bun test type-checks" claim; document `bun run typecheck`.
- [x] 9.3 Update `openspec/specs`-facing docs if any archived spec assumptions changed (search score scale, dedup semantics).
- [x] 9.4 Run a manual end-to-end check on a fixture directory: `init` → `embed` → `search --mode semantic` → `search --mode hybrid --tags ...` → `sync` → `watch start/status/stop`.
- [x] 9.5 Re-index the project once (`indeX clear && indeX embed .`) to recompute stats with the new dedup semantics.
- [x] 9.6 Run `openspec validate fix-search-pipeline-and-runtime` and confirm the change is valid.
