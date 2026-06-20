## Context

IndeX has a Commander CLI and a Hono HTTP API, but neither speaks MCP. AI agents (Claude Code, Cursor, etc.) need MCP tools to interact with the index natively. The MCP HTTP (SSE) transport lets agents connect to a persistent server, discover tools via `tools/list`, and invoke them via `tools/call`.

The existing `createApp()` DI container already wires all use cases (`SearchUseCase`, `EmbedUseCase`, `PackUseCase`, etc.) and systems (`LanceDbSourceRepository`, `OllamaEmbedder`, etc.). The MCP server should reuse these — not duplicate the wiring.

The project already has a watch daemon with a health server (`src/watch/WatchHealthServer.ts`) on a random port. The MCP server follows a similar pattern: standalone HTTP server that can run as a daemon or foreground.

## Goals / Non-Goals

**Goals:**
- MCP HTTP (SSE) server exposing all IndeX tools with typed schemas
- Tools: `search`, `embed`, `pack`, `chunk`, `stats`, `clear`, `scan`, `watch_start`, `watch_status`, `watch_stop`
- Resource URIs for reading packed output, stats, indexed file content
- Prompt templates for common agent workflows
- CLI command `indeX mcp` to start the server
- Configurable port (default 3100)
- Reuse existing `createApp()` systems — no duplication
- Lazy-loaded native modules (same pattern as other heavy commands)

**Non-Goals:**
- No stdio transport (HTTP only per user choice)
- No authentication/authorization (local tool, same as watch daemon)
- No breaking changes to existing CLI or API
- No changes to the indexing pipeline or search logic
- No Web UI — MCP is for agents, not humans

## Decisions

### 1. Architecture: MCP server as a standalone system in createApp()

**Decision:** Add `McpServer` system that wraps `App` (all use cases) and starts an HTTP (SSE) server. Register it in `createApp()` under `app.mcp`. The CLI command `indeX mcp --port 3100` calls `app.mcp.start()`.

**Rationale:** Reuses all existing use cases. No need to rewire dependencies. Same pattern as `WatchDaemon` which starts a background server.

**Alternatives considered:**
- Standalone script (rejected: duplicates DI wiring)
- Plug into the Hono API (rejected: MCP uses SSE streaming, not REST)

### 2. Transport: HTTP with SSE (Server-Sent Events)

**Decision:** Use `@modelcontextprotocol/sdk` HTTP transport with SSE. The server exposes `GET /sse` for the event stream and `POST /messages` for client requests.

**Rationale:** The SDK handles MCP protocol framing, JSON-RPC, and transport. SSE is standard for MCP HTTP transport — agents connect to SSE stream and send POST requests.

### 3. Tool definitions: typed JSON Schema inputs

**Decision:** Each tool has a `JsonSchema` input definition generated from tool parameters. Output is structured JSON (not raw CLI text).

**Rationale:** MCP tools communicate via typed JSON Schema. Agents use the schema to discover valid inputs. Structured output lets agents parse results programmatically.

### 4. Lazy loading: heavy imports on first `mcp` call

**Decision:** `indeX mcp` calls `loadApp()` (lazy native imports, ~5s first call), then creates the MCP server. Subsequent calls use cached `app`.

**Rationale:** Same pattern as `search`, `pack`, `embed` commands. Keeps `--help` fast.

### 5. Config: optional `mcp` section in `.indeX/config.json`

**Decision:** Add optional `mcp` config:

```json
{
  "mcp": {
    "port": 3100,
    "host": "127.0.0.1"
  }
}
```

**Rationale:** Port 3100 is unlikely to conflict with the watch daemon (random port) or the Hono API (not yet port-bound). Host defaults to localhost for security.

### 6. Resource URIs

Resources expose data via `resources/read`:

| URI | Returns |
|-----|---------|
| `indeX://stats` | Current index statistics |
| `indeX://config` | Current config |

Additional file-level resources can be added later.

### 7. Prompt templates

Reusable `prompts/get` templates for common agent tasks:

| Prompt | Description |
|--------|-------------|
| `search-code` | Search with mode and column selection |
| `pack-context` | Pack files for LLM context analysis |
| `index-status` | Check index stats and daemon health |

## Risks / Trade-offs

- **MCP SDK maturity**: `@modelcontextprotocol/sdk` is relatively new. Risk of API changes. — Mitigation: pin version in `package.json`.
- **SSE connection lifecycle**: Agent disconnects leave orphaned server. — Mitigation: same pattern as watch daemon — server runs until explicitly stopped or CLI exits.
- **Port conflict**: Port 3100 might be in use. — Mitigation: user can configure port, or server picks random port (like watch daemon).
- **Lazy load delay**: First `mcp` call takes ~5s. — Mitigation: already accepted pattern for all heavy commands.
