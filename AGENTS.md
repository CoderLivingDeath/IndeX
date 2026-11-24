# IndeX — Agent Guide

Bun + TypeScript indexer: parses code/notes, chunks, embeds via Ollama, stores in LanceDB, exposes hybrid (vector + FTS + AST) search through CLI, HTTP API, MCP and a React UI.

## Commands

```bash
bun install
bun run typecheck                         # tsc --noEmit (strict); bun test does NOT typecheck
bun test                                  # full suite
bun test tests/domain/types.test.ts       # single file
bun run build:web                         # React SPA -> dist/web (gitignored)
bun run serve:web                        # API + UI on http://localhost:3000
bun run serve:web -- --memory            # in-memory DB

# CLI has no npm bin script; run the entrypoint directly. DB/config live in ./.indeX/
bun run src/presentation/cli/cli.ts embed .
bun run src/presentation/cli/cli.ts search "query" --mode hybrid --tags devops
bun run src/presentation/cli/cli.ts sync .
bun run src/presentation/cli/cli.ts watch start . && bun run src/presentation/cli/cli.ts watch status
bun run src/presentation/cli/cli.ts mcp   # stdio MCP; stdout is protocol-only
```

Commands: `init`, `embed`, `search`, `pack`, `chunk`, `scan`, `stats`, `sync`, `clear`, `watch`, `mcp`. There is no `index` command. Heavy commands lazy-load native modules (~5 s first call); `init`/`clear`/`scan`/`watch` are lightweight. Search/pack flags, sections and `--columns` are documented in `README.md`.

## Architecture

```
src/
  domain/          pure core: types, ast, ports, services, systems
  infrastructure/  adapters: parsers, chunking, embedding, LanceDB, watcher, logger
  application/     use cases (Index/Search/Pack/Chunk/Embed/Sync/Watch/Delete)
  presentation/    CLI (Commander), HTTP API (Hono), MCP (stdio)
  config/          ConfigLoader (Zod, hierarchical lookup)
  watch/           daemon, health server, watch config
  index.ts         createApp() composition root
web/               React 19 + MUI SPA source; builds to dist/web
```

- `domain/` must not import from `infrastructure/` or external packages.
- Wire new systems in `src/index.ts`; use cases receive DI group interfaces from `src/application/di/Systems.ts`.
- `SearchUseCase` embeds the query once and delegates to `SearchService`; `SearchService` is the only ranking engine (semantic/keyword/hybrid merge with `search.hybrid_weight`).
- `SearchQuery.vector` is the query embedding contract. `LanceDbSourceRepository` uses cosine distance and scores `clamp(1 - distance, 0, 1)`; missing vectors mean no semantic results, not a keyword fallback.
- Ingest dedup is at embedding level: duplicate `semantic_blake3` reuses a vector but still persists per-file chunk rows. Full `embed` deletes a file's old rows before upsert (idempotent).
- `SyncUseCase` persists its tree snapshot only after a zero-error pass.
- `ChokidarWatcher` translates globs to a predicate (chokidar 5 has no glob support); `WatchUseCase` deletes chunks/file index on `unlink`.
- Hono serves `dist/web`; `src/presentation/api/web-build.ts` builds it. `serve:web` auto-builds when sources are newer. API tests build the SPA in `beforeAll`.
- MCP uses stdio. Use `indeX mcp` (`.opencode/opencode.json` does); logs go to stderr, stdout must stay JSON-RPC.

## Tests

- `bun:test`; mocks in `tests/mocks/` implement domain ports. LanceDB runs in `memory://`.
- File-based tests must use temp fixture dirs, never the repo root (that caused a 5 s timeout).
- `tests/integration/semantic-search.test.ts` uses real in-memory LanceDB; `tests/integration/full-cycle.test.ts` uses real parsers + mocks.
- Ollama is not needed for tests (MockEmbedder). Real vector search needs Ollama on `:11434`.
- `bun test` does not typecheck. Keep `bun run typecheck` at zero; strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` are enabled for `src`, `tests`, and `web`.

## Config

`.indeX/config.json`, validated by Zod. Resolution: current dir → parent dirs → `~/.config/indeX/config.json` → defaults.
Default excludes are globs and include `**/.indeX/**`, `**/.opencode/**`, `**/node_modules/**`, etc. CLI search falls back to `search.default_mode` / `search.top_k`; `--tags` is forwarded.

## Quirks / limitations

- No linter/formatter config; no compile step for Bun TS. React UI needs `build:web`.
- `bun run` scripts: `test`, `typecheck`, `build:web`, `serve:web` only.
- Compiled CLI exe: Commander needs full `process.argv`; native addons load on first import (~5 s). `clear`/`watch` avoid them.
- `@ast-grep/napi` v0.43.0 can crash on Windows with `TODO: ReadSymbol(GetProcAddress { source: 127 })`.
- Multi-model embedding is not fully implemented: `EmbedderRegistry.getEmbedder()` selects one model per source type.
- Rename events arrive as unlink + add; full reindex occurs on rename.
- Old LanceDB transactions can slow DB open; `clear` recreates it.
- Watch PID checks can hit a recycled PID on Windows.
- `total_tokens` / `total_deduped_chunks` in `/api/stats` describe the last indexing run, not the whole DB; file/chunk counts are live.
- `POST /api/index` resolves the path to absolute before indexing, otherwise relative-path duplicates appear.

## OpenSpec

```bash
openspec status --change <name> --json
openspec instructions apply --change <name> --json
```

Workflow: `opsx-propose` → implement → `opsx-apply-change` → `opsx-archive-change`.

## Key files

- `src/index.ts` — composition root
- `src/domain/services/SearchService.ts`, `IndexingService.ts`, `DiffIndexingService.ts`
- `src/infrastructure/lancedb/LanceDbSourceRepository.ts`
- `src/presentation/api/server.ts`, `api/web-build.ts`
- `web/src/App.tsx`, `components/ResultCard.tsx`, `theme.ts`
- `src/presentation/cli/commands/` — one file per command
