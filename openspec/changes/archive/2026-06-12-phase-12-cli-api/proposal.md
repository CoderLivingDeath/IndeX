## Why

IndeX needs user-facing interfaces. The CLI provides immediate command-line access to all operations (`index`, `search`, `pack`, `chunk`, `embed`, `watch`, `stats`). The HTTP API (Hono) enables remote access and integration with other tools. A lightweight web UI (SPA) provides a visual search interface. Without these, the system has no way for users to interact with it.

## What Changes

- Create `src/presentation/cli/cli.ts` — CLI entry point with all commands using Bun's built-in argument parsing or `commander`:
  - `indeX index <path>` — full indexing
  - `indeX search <query>` — search with `--mode`, `--tags`, `--top-k`
  - `indeX pack <path> -o <file>` — file packaging
  - `indeX chunk <path>` — chunking with `--strategy`
  - `indeX embed <path>` — embedding generation
  - `indeX watch <path>` — watch and auto-index
  - `indeX stats` — database statistics
- Create `src/presentation/api/server.ts` — Hono HTTP API:
  - `GET /api/search?q=...&mode=hybrid&top_k=10`
  - `GET /api/stats`
  - `POST /api/index` with directory path in body
- Create `src/presentation/web/` — lightweight SPA for search and visualization
- Write tests for CLI commands and API endpoints before implementation (RED → GREEN)

## Capabilities

### New Capabilities
- `cli`: Complete command-line interface for all IndeX operations — index, search, pack, chunk, embed, watch, stats
- `http-api`: Hono-based HTTP API exposing search, stats, and index endpoints for remote integration
- `web-ui`: Single-page application for visual search and system status

### Modified Capabilities
- None

## Impact

- Adds files in `src/presentation/cli/`, `src/presentation/api/`, `src/presentation/web/`
- New dependency: `hono` (HTTP API), optional `commander` (CLI)
- Depends on Phase 11 (DI container providing all use cases)
- Production-ready: all preceding phases must be complete and tested
