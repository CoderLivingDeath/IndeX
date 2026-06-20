## ADDED Requirements

### Requirement: MCP server with HTTP (SSE) transport
The system SHALL provide an MCP-compatible server over HTTP with SSE transport, exposing all IndeX tools with typed schemas.

#### Scenario: Server starts on configurable port
- **WHEN** running `indeX mcp --port 3100`
- **THEN** the server SHALL listen on `http://127.0.0.1:3100` and respond to MCP requests

#### Scenario: Server uses SSE transport
- **WHEN** an agent connects to `GET /sse`
- **THEN** it SHALL receive an SSE event stream for MCP messages
- **WHEN** the agent sends `POST /messages` with a JSON-RPC request
- **THEN** the server SHALL process it and respond via the SSE stream

#### Scenario: Server reuses createApp() systems
- **WHEN** the MCP server starts
- **THEN** it SHALL use the existing `App` instance from `createApp()` — no duplicate wiring

#### Scenario: Lazy loading on first call
- **WHEN** running `indeX mcp`
- **THEN** native module imports SHALL be lazy-loaded via `loadApp()` (~5s first call, cached thereafter)

### Requirement: Tool — search
The MCP server SHALL expose the `search` tool with typed parameters.

#### Scenario: Search tool definition
- **WHEN** calling `tools/list`
- **THEN** the server SHALL return a `search` tool with parameters: `query` (string, required), `mode` (enum: hybrid/semantic/keyword/ast, optional, default hybrid), `top_k` (integer, optional, default 10), `columns` (string, optional)

#### Scenario: Search tool execution
- **WHEN** calling `tools/call` with `{ name: "search", arguments: { query: "BLAKE3 hasher", mode: "hybrid" } }`
- **THEN** the server SHALL return structured search results with path, score, content, type, and requested columns

### Requirement: Tool — embed
The MCP server SHALL expose the `embed` tool for indexing files.

#### Scenario: Embed tool definition
- **WHEN** calling `tools/list`
- **THEN** the server SHALL return an `embed` tool with parameter: `path` (string, required)

#### Scenario: Embed tool execution
- **WHEN** calling `tools/call` with `{ name: "embed", arguments: { path: "./src" } }`
- **THEN** the server SHALL index the directory and return statistics: `total_files`, `total_chunks`, `total_deduped_chunks`

### Requirement: Tool — pack
The MCP server SHALL expose the `pack` tool for bundling files.

#### Scenario: Pack tool definition
- **WHEN** calling `tools/list`
- **THEN** the server SHALL return a `pack` tool with parameters: `path` (string, required), `format` (enum: jsonl/md, optional, default jsonl), `meta` (boolean, optional), `ast` (boolean, optional), `content` (boolean, optional), `links` (boolean, optional), `include` (string, optional), `exclude` (string, optional)

#### Scenario: Pack tool execution
- **WHEN** calling `tools/call` with `{ name: "pack", arguments: { path: ".", format: "md", content: true, meta: true } }`
- **THEN** the server SHALL return packed output as text

### Requirement: Tool — stats
The MCP server SHALL expose the `stats` tool for index statistics.

#### Scenario: Stats tool definition
- **WHEN** calling `tools/list`
- **THEN** the server SHALL return a `stats` tool with no required parameters

#### Scenario: Stats tool execution
- **WHEN** calling `tools/call` with `{ name: "stats" }`
- **THEN** the server SHALL return index statistics as structured JSON

### Requirement: Tool — scan
The MCP server SHALL expose the `scan` tool for dry-running file filters.

#### Scenario: Scan tool definition
- **WHEN** calling `tools/list`
- **THEN** the server SHALL return a `scan` tool with parameters: `path` (string, required), `include` (string, optional), `exclude` (string, optional)

#### Scenario: Scan tool execution
- **WHEN** calling `tools/call` with `{ name: "scan", arguments: { path: "." } }`
- **THEN** the server SHALL return a list of matching files

### Requirement: Tool — clear
The MCP server SHALL expose the `clear` tool for deleting the index.

#### Scenario: Clear tool definition
- **WHEN** calling `tools/list`
- **THEN** the server SHALL return a `clear` tool with no required parameters

#### Scenario: Clear tool execution
- **WHEN** calling `tools/call` with `{ name: "clear" }`
- **THEN** the server SHALL delete `.indeX/` config and DB

### Requirement: Tool — chunk
The MCP server SHALL expose the `chunk` tool for splitting files into chunks.

#### Scenario: Chunk tool definition
- **WHEN** calling `tools/list`
- **THEN** the server SHALL return a `chunk` tool with parameter: `path` (string, required)

#### Scenario: Chunk tool execution
- **WHEN** calling `tools/call` with `{ name: "chunk", arguments: { path: "./src" } }`
- **THEN** the server SHALL return chunk statistics

### Requirement: Tool — watch_start / watch_status / watch_stop
The MCP server SHALL expose watch daemon tools.

#### Scenario: Watch tools definition
- **WHEN** calling `tools/list`
- **THEN** the server SHALL return `watch_start` (params: `dir` string required, `port` integer optional), `watch_status` (no params), `watch_stop` (no params) tools

#### Scenario: Watch tools execution
- **WHEN** calling `tools/call` with `{ name: "watch_start", arguments: { dir: "." } }`
- **THEN** the server SHALL start the watch daemon and return status
- **WHEN** calling `tools/call` with `{ name: "watch_status" }`
- **THEN** the server SHALL return daemon health status
- **WHEN** calling `tools/call` with `{ name: "watch_stop" }`
- **THEN** the server SHALL stop the watch daemon

### Requirement: Resource — stats and config
The MCP server SHALL expose resources for reading index data.

#### Scenario: Stats resource
- **WHEN** calling `resources/read` with URI `indeX://stats`
- **THEN** the server SHALL return current index statistics as structured content

#### Scenario: Config resource
- **WHEN** calling `resources/read` with URI `indeX://config`
- **THEN** the server SHALL return the current configuration

### Requirement: Prompt templates
The MCP server SHALL expose prompt templates for common agent workflows.

#### Scenario: Prompt definitions
- **WHEN** calling `prompts/list`
- **THEN** the server SHALL return prompts: `search-code`, `pack-context`, `index-status`

#### Scenario: Prompt execution
- **WHEN** calling `prompts/get` with name `search-code`
- **THEN** the server SHALL return a prompt template with arguments for query and mode

### Requirement: CLI `indeX mcp` command
The CLI SHALL have an `mcp` command to start the server.

#### Scenario: MCP command
- **WHEN** running `indeX mcp --port 3100`
- **THEN** it SHALL start the MCP server on the specified port
- **WHEN** running `indeX mcp --help`
- **THEN** it SHALL show usage with port option
- **WHEN** running `indeX mcp` without port
- **THEN** it SHALL use the default port from config (3100) or fallback to 3100

### Requirement: MCP config in .indeX/config.json
The config SHALL support an optional `mcp` section.

#### Scenario: Config with MCP settings
- **WHEN** `.indeX/config.json` has `mcp.port` and `mcp.host`
- **THEN** the MCP server SHALL use those values
- **WHEN** the `mcp` section is absent
- **THEN** the MCP server SHALL use defaults (port 3100, host 127.0.0.1)

### Requirement: Structured JSON responses
All MCP tool responses SHALL return structured JSON, not raw CLI text.

#### Scenario: JSON output for all tools
- **WHEN** calling any tool via `tools/call`
- **THEN** the response SHALL be a structured JSON object, not raw console output

#### Scenario: Error responses
- **WHEN** a tool call fails
- **THEN** the response SHALL include a clear error message and MCP error code (not a crash)
