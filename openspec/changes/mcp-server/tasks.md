## 1. Dependency Setup

- [x] 1.1 Install `@modelcontextprotocol/sdk` dependency
- [x] 1.2 Add optional `mcp` section to `ConfigLoader` Zod schema (port, host)
- [x] 1.3 Create `src/presentation/mcp/` directory structure

## 2. MCP Server Core

- [x] 2.1 Create `McpTransport` — HTTP SSE transport wrapper using `@modelcontextprotocol/sdk`
- [x] 2.2 Create `McpToolRegistry` — register tool definitions with JSON Schema inputs for all 10 tools (search, embed, pack, chunk, stats, clear, scan, watch_start, watch_status, watch_stop)
- [x] 2.3 Create `IndeXMcpServer` system — wires transport + tool registry + resource handlers + prompt templates
- [x] 2.4 Implement `IndeXMcpServer.start(port)` — starts HTTP server on configurable port
- [x] 2.5 Implement resource handlers for `indeX://stats` and `indeX://config`
- [x] 2.6 Implement prompt templates: `search-code`, `pack-context`, `index-status`

## 3. Tool Handlers

- [x] 3.1 Implement `handleSearch` — calls `app.search.execute()`, returns structured results
- [x] 3.2 Implement `handleEmbed` — calls `app.index.execute()`, returns stats
- [x] 3.3 Implement `handlePack` — calls `app.pack.execute()`, returns packed output
- [x] 3.4 Implement `handleStats` — calls `app.del.stats()`, returns JSON
- [x] 3.5 Implement `handleScan` — dry-run file filter preview
- [x] 3.6 Implement `handleClear` — calls `app.del.clear()`, returns confirmation
- [x] 3.7 Implement `handleChunk` — calls `app.chunk.execute()`, returns chunk stats
- [x] 3.8 Implement `handleWatchStart` / `handleWatchStatus` / `handleWatchStop` — proxy to watch daemon

## 4. DI Integration

- [x] 4.1 Add `McpServer` to `App` interface in `src/index.ts`
- [x] 4.2 Wire `McpServer` in `createApp()` — instantiate with existing use cases
- [x] 4.3 Ensure `McpServer` is lazy-instantiated (no heavy imports on app creation)

## 5. CLI Integration

- [x] 5.1 Create `src/presentation/cli/commands/mcp.ts` — `registerMcp(program)` with `--port` option
- [x] 5.2 Register `mcp` command in `cli.ts` (lightweight — no `loadApp()` in registration)
- [x] 5.3 Wire `mcp` handler to call `app.mcp.start(port)` after `loadApp()`

## 6. Tests

- [x] 6.1 Write unit tests for McpToolRegistry — tool definitions registered correctly
- [x] 6.2 Write unit tests for tool handlers — each handler returns expected structured output
- [x] 6.3 Write integration test: start MCP server, verify HTTP endpoint works with MCP headers
- [x] 6.4 Write CLI test: `indeX mcp` command parsing

## 7. Documentation & Polish

- [x] 7.1 Add `.opencode/opencode.json` with MCP server config for opencode
- [x] 7.2 Run full test suite — all existing tests pass (506/506)
- [x] 7.3 Build compiled exe — `bun build --compile` (275MB, `dist/indeX.exe`)
