## Why

IndeX currently has a CLI and HTTP API, but AI agents (Claude Code, Cursor, etc.) interact best through the Model Context Protocol (MCP). Without an MCP server, agents can't natively search the index, pack context, or manage the index — they'd need to shell out to `indeX` CLI commands, which is fragile and unstructured. An MCP server with HTTP (SSE) transport gives agents structured tool access, typed responses, and persistent connection to the index.

## What Changes

- **New MCP server** — wraps all IndeX CLI tools as MCP tools over HTTP (SSE) transport
- **Tools**: `search`, `embed`, `pack`, `chunk`, `stats`, `clear`, `scan`, `watch_start`, `watch_status`, `watch_stop`
- **Resources**: read access to indexed files, pack output, stats via MCP resource URIs
- **Prompts**: reusable prompt templates for common agent tasks (search code, pack context, analyze repo)
- **Config**: MCP server settings in `.indeX/config.json` (port, allowed origins)

## Capabilities

### New Capabilities
- `mcp-server`: MCP-compatible server exposing all IndeX tools over HTTP (SSE) transport, with typed tool definitions, resource URIs, and prompt templates for AI agents

### Modified Capabilities
<!-- No existing capabilities change — this is a pure addition -->

## Impact

- **src/presentation/mcp/**: New directory — MCP server (transport layer, tool registry, request handlers)
- **src/index.ts**: `createApp()` registers MCP server alongside existing systems
- **src/presentation/cli/cli.ts**: New `mcp` CLI command to start the server (`indeX mcp`)
- **src/config/ConfigLoader.ts**: Optional `mcp` section in config schema (port, origins)
- **openspec/specs/mcp-server/spec.md**: New spec for MCP server capability
- **Dependencies**: `@modelcontextprotocol/sdk` for MCP protocol types and HTTP transport
