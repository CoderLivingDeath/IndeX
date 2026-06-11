# IndeX — Agent Guide

Bun + TypeScript app for indexing notes and code into LanceDB with hybrid (vector + keyword) search.

---

## Quick start

```bash
bun install
bun test                          # all tests
bun test tests/domain/types.test.ts   # single file
```

There is no compile step — Bun runs TypeScript natively with zero config.

## Architecture (Ports & Adapters + DDD)

```
src/
  domain/           # Pure core — ZERO external dependencies (types, interfaces only)
  infrastructure/   # Adapters implementing domain interfaces (parsers, chunkers, embedders, DB)
  application/      # Use cases orchestrating systems
  presentation/     # CLI, HTTP API (Hono), Web UI
  config/           # ConfigLoader with zod validation
  index.ts          # DI container / composition root (createApp())
```

- `domain/` must never import from `infrastructure/` or external packages — enforce this.
- All wiring is in `src/index.ts` (`createApp()`). When adding a new system, wire it there.
- Mocks live in `tests/mocks/` — use them in use-case tests, not real adapters.

## Entry points

| Layer | File | Function |
|-------|------|----------|
| Library | `src/index.ts` | `createApp()` |
| CLI | `src/presentation/cli/cli.ts` | `main()` |
| HTTP API | `src/presentation/api/server.ts` | `serve()` |
| Web UI | `src/presentation/web/index.html` | SPA served by Hono |

The CLI can be run as:
```bash
bun run src/presentation/cli/cli.ts index ./path
bun run src/presentation/cli/cli.ts search "query"
```

## CLI commands

```
index   <path>       Index supported files
search  <query>      Search (--mode semantic|keyword|hybrid|ast, --top-k N, --tags ...)
pack    <path>       Pack files into Markdown bundle (-o file, --include, --exclude)
chunk   <path>       Chunk files
embed   <path>       Generate embeddings
watch   <path>       Watch for changes
stats                Index statistics
clear                Clear all data
```

## Build standalone executable

Compile the CLI into a standalone Windows `.exe` (no Bun required to run):

```bash
bun build --compile --target=bun-windows-x64 ./src/presentation/cli/cli.ts --outfile=dist/indeX
```

Output goes to `dist/indeX.exe`. `dist/` is in `.gitignore`.

Run the compiled binary:
```bash
dist\indeX.exe index ./path
dist\indeX.exe search "query"
```

## Config

File: `.indeX/config.json` (gitignored) — validated by zod.

Key fields:
- `models[]`: embedder models with `name`, `dimensions`, `provider` (ollama|lancedb)
- `universal_model`: must exist in `models[]`
- `chunking.default_strategy`: heading|paragraph|sentence|code|overflow
- `chunking.max_chunk_size`: default 500, `overlap`: default 32
- `search.default_mode`: semantic|keyword|hybrid
- `indexing.exclude`: default skips node_modules, .git, .tmp, dist, build, .opencode

## Known quirks & bugs

- **CachedEmbedder hash collision (Phase 13, critical):** `src/index.ts:198` — uses `t.length.toString()` as cache key instead of BLAKE3. Texts of the same length collide. Fix: replace with the `hasher` from line 156.
- **No `bun run` scripts exist** beyond `"test": "bun test"`. Run the CLI manually.
- **No linter/formatter config** found in the repo.
- **Rename events** are two events (unlink + add), not a single rename. Full reindex occurs on rename.

## Test conventions

- Framework: `bun:test` with `describe`, `expect`, `test`, `beforeAll`, `afterAll`
- Mock pattern: `tests/mocks/Mock*.ts` implement domain interfaces
- Integration test at `tests/integration/full-cycle.test.ts` (uses real parsers + mocks)
- TDD workflow: each module developed as Red (test) → Green (impl) → Test → Refactor
- Snapshot tests are **not** used
- Tests use `tests/fixtures/` for sample .md and .ts files

## Import paths

`@/*` maps to `./src/*` (configured in tsconfig.json `paths`). Use this in new code.

## Dev workflow

1. `bun test` — all tests must be green
2. Type checking is strict (`strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
3. LanceDB runs in `memory://` mode during tests — no external DB needed
4. Ollama is required for real vector search (embeddings); tests use MockEmbedder

## OpenSpec workflow

The project uses OpenSpec for change proposals:
1. `opsx-propose` — create a change proposal with design + tasks
2. `opsx-apply-change` — implement a change's tasks
3. `opsx-archive-change` — archive completed changes

## Files to read when exploring

- `ARCHITECTURE.md` — detailed architecture doc (in Russian, but the most complete reference)
- `DEVELOPMENT_PLAN.md` — TDD implementation order (phases 0–12)
- `.opencode/context/core/plans/phase-13-ast-search.md` — current active work plan
- `src/index.ts` — composition root showing all wired dependencies
