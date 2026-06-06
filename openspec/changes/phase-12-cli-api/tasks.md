## 1. CLI

- [ ] 1.1 **RED**: Write tests for CLI commands — CLI parses `index <path>`, `search <query>`, `pack <path> -o <file>`, `chunk <path>`, `embed <path>`, `watch <path>`, `stats` commands with correct flags, --help lists all commands
- [ ] 1.2 **GREEN**: Create `src/presentation/cli/cli.ts` — import `createApp()` from DI container, wire each command to the corresponding use case
- [ ] 1.3 **TEST**: Run `bun test tests/presentation/cli/` — all CLI tests pass

## 2. HTTP API

- [ ] 2.1 Install `hono` dependency
- [ ] 2.2 **RED**: Write tests for API endpoints — `GET /api/search?q=...` returns JSON results, `GET /api/stats` returns stats JSON, `POST /api/index` returns status response
- [ ] 2.3 **GREEN**: Create `src/presentation/api/server.ts` — Hono app wrapping use cases, CORS enabled for SPA
- [ ] 2.4 **TEST**: Run `bun test tests/presentation/api/` — all API tests pass

## 3. Web UI

- [ ] 3.1 **GREEN**: Create `src/presentation/web/index.html` — minimal SPA with search input, results display, index trigger button
- [ ] 3.2 **GREEN**: Serve static files from Hono (src/presentation/web/*)
