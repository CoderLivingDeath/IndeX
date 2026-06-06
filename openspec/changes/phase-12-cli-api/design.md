## Context

The final user-facing layer. CLI provides direct terminal access to all IndeX operations. HTTP API (Hono) enables remote integration. Web UI provides visual search. All three call into the use case bundle from the DI container.

## Goals / Non-Goals

**Goals:**
- CLI: All 7 commands (`index`, `search`, `pack`, `chunk`, `embed`, `watch`, `stats`) with flags for mode, tags, output, strategy
- HTTP API (Hono): `GET /api/search`, `GET /api/stats`, `POST /api/index`
- Web UI: Search interface with results display, index status, basic visualization
- Tests for CLI argument parsing and API endpoint behavior

**Non-Goals:**
- No authentication for HTTP API (local-only by default)
- No complex web dashboard (minimal SPA for search and status)

## Decisions

- **CLI uses Bun's argv + simple parser**: Avoids adding `commander` dependency. CLI is 7 commands, each with 2-3 flags — too simple to justify a framework. If CLI grows, `commander` can be added later.
- **Hono for HTTP API**: Lightweight, fast, Bun-native. Handles routing, middleware, and JSON serialization with minimal boilerplate. Supports CORS for the SPA.
- **SPA as static files served by Hono**: Single HTML + JS bundle served from `src/presentation/web/`. No build step — use modern browser ESM imports. Keeps the web UI lightweight.
- **CLI is the primary interface**: HTTP API and Web UI are secondary. The CLI must always be fully functional even if the API is not running.
- **`indeX --help` lists all commands**: Built into the CLI parser. Shows available commands and common flags for discoverability.

## Risks / Trade-offs

- **Web UI adds browser dependency**: The SPA requires a modern browser and the HTTP API running. Mitigation: web UI is optional; all functionality is available via CLI.
- **Cross-platform CLI path handling**: Windows paths differ from Unix. Mitigation: always use `path.resolve()`, test on Windows during CI. Accept paths in both forward-slash and backslash formats.
