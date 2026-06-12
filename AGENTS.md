# IndeX — Agent Guide

Bun + TypeScript app for indexing notes and code into LanceDB with hybrid (vector + keyword) search.

---

## Quick start

```bash
bun install
bun test                                  # all tests (481 pass)
bun test tests/domain/types.test.ts       # single file
bun test --coverage                       # coverage report

# Index this project's own code (Ollama must be running)
bun run src/presentation/cli/cli.ts index .

# Search the index
bun run src/presentation/cli/cli.ts search "BLAKE3 hasher" --mode hybrid

# Watch for changes (background daemon)
bun run src/presentation/cli/cli.ts watch start .
bun run src/presentation/cli/cli.ts watch status
bun run src/presentation/cli/cli.ts watch stop
```

There is no compile step — Bun runs TypeScript natively.

## Architecture (Ports & Adapters + DDD)

```
src/
  domain/           # Pure core — ZERO external dependencies
  infrastructure/   # Adapters implementing domain interfaces
  application/      # Use cases orchestrating systems
  presentation/     # CLI (Commander), HTTP API (Hono), Web UI
  config/           # ConfigLoader with Zod validation
  watch/            # Daemon process + health server + config
  index.ts          # DI container / composition root (createApp())
```

- `domain/` must never import from `infrastructure/` or external packages.
- All wiring is in `src/index.ts` (`createApp()`). Add new systems there.
- Mocks live in `tests/mocks/` — use them in use-case tests.

## Entry points

| Layer | File | Key Export |
|-------|------|-----------|
| Library | `src/index.ts` | `createApp(options?)` — wires all systems |
| CLI | `src/presentation/cli/cli.ts` | `createProgram()` — Commander setup |
| Watch daemon | `src/watch/WatchDaemon.ts` | `runDaemon(dir)` — background process |
| HTTP API | `src/presentation/api/server.ts` | `serve(app)` — Hono server |
| Web UI | `src/presentation/web/index.html` | SPA served by Hono |

## CLI (Commander)

Commands are in `src/presentation/cli/commands/*.ts`. Heavy commands
(index, search, pack, chunk, embed, stats) use `loadApp()` from
`app-loader.ts` — lazy imports native modules (~5s first call, cached
thereafter). `clear` and `watch` are lightweight (no app needed).

```bash
# Config + DB are in .indeX/ relative to CWD
bun run src/presentation/cli/cli.ts index ./path
bun run src/presentation/cli/cli.ts search "query" --mode hybrid --top-k 5 --tags devops
bun run src/presentation/cli/cli.ts search "query" --mode ast --columns path,score,ast,content  # AST search
bun run src/presentation/cli/cli.ts search "class" --ast --top-k 3                              # --ast shortcut
bun run src/presentation/cli/cli.ts scan ./path                           # dry-run file filters
bun run src/presentation/cli/cli.ts pack . -o bundle.md --include "**/*.ts" --exclude "**/*.test.ts"
bun run src/presentation/cli/cli.ts chunk ./path
bun run src/presentation/cli/cli.ts embed ./path
bun run src/presentation/cli/cli.ts stats
bun run src/presentation/cli/cli.ts clear                          # rmSync, <200ms
bun run src/presentation/cli/cli.ts watch start <dir> [--port N]   # spawns daemon
bun run src/presentation/cli/cli.ts watch status                   # health endpoint
bun run src/presentation/cli/cli.ts watch stop                     # SIGTERM daemon
```

### Search modes & columns

The `search` command supports multiple modes via `--mode`:

| Mode | Description |
|------|-------------|
| `hybrid` (default) | Vector + keyword combined |
| `semantic` | Pure vector similarity |
| `keyword` | Full-text keyword (FTS) |
| `ast` | Filter by AST structure metadata |

Use `--ast` as a shortcut for `--mode ast`.

Use `--columns` to control output fields (comma-separated):

| Column | Description |
|--------|-------------|
| `match_type` | Search mode that matched |
| `path` | Source file path |
| `score` | Relevance score |
| `type` | Source type (`code`, `markdown`, etc.) |
| `title` | Chunk title |
| `content` | Full text content |
| `tags` | Comma-separated tags |
| `chunk` | Chunk index / total chunks |
| `blake3` | BLAKE3 hashes (file + semantic) |
| `ast` | AST metadata (symbols, imports, exports); `null` for non-code |
| `meta` | Full metadata dict |
| `timestamps` | Created/updated timestamps |
| `model_scores` | Per-model scores in multi-model mode |
| `embedding` | Raw embedding vector |

### scan — preview file filters

Dry-run to see which files match the include/exclude/extension filters
that `index`, `pack`, and `chunk` use. No heavy imports (no `loadApp()`):

```bash
bun run src/presentation/cli/cli.ts scan .
bun run src/presentation/cli/cli.ts scan . --include "**/*.ts" --show-all
bun run src/presentation/cli/cli.ts scan . --config-exclude --no-default-exclude
```

Compiled exe: `bun build --compile --target=bun-windows-x64 ./src/presentation/cli/cli.ts --outfile=dist/indeX`
Then `dist\indeX.exe index .` — no Bun needed.

**Important for compiled exe:** commander needs the full `process.argv`,
not `slice(2)`. The `--dir` and `--port` args to `watch-daemon` are
handled internally; the daemon reads `watch.json` config, not argv.

## Watch daemon

Separate module at `src/watch/`:

- **`WatchDaemon.ts`** — background process, spawns `createApp()` in child process.
  Writes PID to `.indeX/watch.json` in 3 stages (starting → running → health_port)
  so `watch status` gets immediate feedback.
- **`WatchHealthServer.ts`** — `Bun.serve()` on `127.0.0.1` (random port).
  Endpoints: `GET /api/health`, `POST /api/shutdown`.
- **`WatchConfig.ts`** — Zod schema for `.indeX/watch.json`. Also exports
  `isProcessAlive()`, `isBunDevMode()`, `DEFAULT_IGNORED_PATTERNS`.

Signal handlers (SIGTERM/SIGINT) are registered BEFORE `createApp()` to
avoid missing signals during module load. Health server starts before the
watcher for faster CLI feedback.

One daemon per `.indeX/` directory (guard against duplicates in both
`startWatch()` and `runDaemon()`). `*.unref()` so the CLI can exit after
spawning.

## Config

File: `.indeX/config.json` — validated by Zod.

```json
{
  "models": [{ "name": "qllama/multilingual-e5-small", "dimensions": 384, "provider": "ollama" }],
  "universal_model": "qllama/multilingual-e5-small",
  "chunking": { "default_strategy": "heading", "max_chunk_size": 500, "overlap": 32 },
  "search": { "default_mode": "hybrid", "top_k": 10, "hybrid_weight": 0.7 },
  "indexing": {
    "exclude": ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**",
                "**/.tmp/**", "**/.opencode/**", "**/.venv/**", "**/__pycache__/**",
                "**/target/**", "**/vendor/**"]
  }
}
```

## Usage for this project

To index the IndeX codebase itself (useful for code-aware search):

```bash
# 1. Make sure Ollama is running locally on :11434
# 2. Create config (already done, or copy from above)
# 3. Index the project
bun run src/presentation/cli/cli.ts index .

# 4. Search your own code
bun run src/presentation/cli/cli.ts search "createApp composition root" --mode hybrid
bun run src/presentation/cli/cli.ts search "BLAKE3 hasher" --mode semantic --top-k 3
bun run src/presentation/cli/cli.ts search "WatchDaemon health server" --mode keyword

# 5. AST-aware search — find code by structure
bun run src/presentation/cli/cli.ts search "function" --mode ast --top-k 10              # AST mode
bun run src/presentation/cli/cli.ts search "interface" --ast --columns path,score,ast     # --ast shortcut + AST column
bun run src/presentation/cli/cli.ts search "export interface" --ast --columns path,ast,content,type

# 6. Custom output columns
bun run src/presentation/cli/cli.ts search "BLAKE3" --columns path,score,blake3,timestamps
bun run src/presentation/cli/cli.ts search "class" --ast --columns path,score,ast,chunk

# 7. Preview file filters (dry-run)
bun run src/presentation/cli/cli.ts scan .
bun run src/presentation/cli/cli.ts scan . --include "**/*.ts" --show-all

# 8. Watch for changes while developing
bun run src/presentation/cli/cli.ts watch start .
# make some edits...
bun run src/presentation/cli/cli.ts watch status   # verify daemon is healthy
bun run src/presentation/cli/cli.ts watch stop

# Compiled exe (faster, no Bun needed)
bun build --compile --target=bun-windows-x64 ./src/presentation/cli/cli.ts --outfile=dist/indeX
dist\indeX.exe index .
dist\indeX.exe search "BLAKE3" --mode hybrid
```

The watcher uses per-file BLAKE3 diffing (`diffIndexFile()`), so only
changed files get reindexed. First index is full (all files); subsequent
watcher-triggered updates are incremental.

## Known quirks & bugs

- **CachedEmbedder hash collision (critical):** `src/index.ts` uses
  `t.length.toString()` as cache key instead of BLAKE3. Texts of the same
  length produce identical keys, returning WRONG embeddings on collision.
  Fix: replace with `hasher` (BLAKE3Hasher from same file).
- **`@ast-grep/napi` v0.43.0 on Windows** crashes with
  `TODO: ReadSymbol(GetProcAddress { source: 127 })`.
- **`bun run` scripts**: only `"test": "bun test"` exists. Run CLI manually.
- **No linter/formatter config** in the repo.
- **Rename events** arrive as two events (unlink + add), not a single rename.
  Full reindex occurs on rename.
- **LanceDB startup lag**: old LanceDB transactions (279+ files) slow DB
  open to minutes. After clearing `.indeX/lancedb` it's fast again.
- **Dynamic imports in compiled exe**: native addons load on first import
  (~5s). `clear` and `watch` commands avoid this (no `loadApp()`).
- **Watch PID recycling on Windows**: a "live" PID check can match a
  recycled PID from a different process. Acceptable for local tool.
- **Progress counter quirk**: per-file log shows `[N/totalFiles]` while
  final summary shows `[N/(totalFiles - skipped)]`. 5 excluded files =
  appearance of disappearing files.

## Test conventions

- Framework: `bun:test` with `describe`, `expect`, `test`, `beforeAll`, `afterAll`
- Mock pattern: `tests/mocks/Mock*.ts` implement domain interfaces
- Integration test: `tests/integration/full-cycle.test.ts` (real parsers + mocks)
- Snapshot tests are **not** used
- Fixtures: `tests/fixtures/` for sample .md and .ts files
- LanceDB runs in `memory://` mode during tests — no external DB needed
- Ollama is required for real vector search; tests use MockEmbedder

## Import paths

`@/*` maps to `./src/*` (tsconfig.json `paths`). Use this in new code.

## Type checking

`strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
Run `bun test` — Bun's type checking is built into the test runner.

## OpenSpec workflow

```
opsx-propose          → create change proposal with design + tasks
opsx-apply-change     → implement a change's tasks
opsx-archive-change   → archive completed changes
```

## Key files to read

- `ARCHITECTURE.md` — detailed architecture (Russian, most complete ref)
- `DEVELOPMENT_PLAN.md` — TDD implementation order (phases 0–12)
- `src/index.ts` — composition root, all wired dependencies
- `src/presentation/cli/cli.ts` — commander entry point
- `src/presentation/cli/app-loader.ts` — lazy createApp() caching
- `src/presentation/cli/commands/search.ts` — search command (modes, columns)
- `src/presentation/cli/format.ts` — output formatting, column definitions
- `.opencode/context/core/plans/phase-13-ast-search.md` — current active work
