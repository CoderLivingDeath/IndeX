## ADDED Requirements

### Requirement: CLI mcp command
The CLI SHALL expose the existing stdio MCP server through an `mcp` command.

#### Scenario: Start MCP over stdio
- **WHEN** running `indeX mcp`
- **THEN** the process SHALL start the MCP server over stdio and keep running until stdin closes or a termination signal arrives

#### Scenario: Help output
- **WHEN** running `indeX mcp --help`
- **THEN** it SHALL describe the command and state that the transport is stdio

#### Scenario: Stdout is protocol-only
- **WHEN** the MCP server is running
- **THEN** stdout SHALL contain only MCP JSON-RPC messages and all logs SHALL be written to stderr

#### Scenario: Graceful shutdown
- **WHEN** stdin closes or SIGTERM/SIGINT is received
- **THEN** the server SHALL close the transport and exit with status 0

#### Scenario: Startup failure
- **WHEN** the application cannot be created
- **THEN** the command SHALL write the error to stderr and exit non-zero without corrupting stdout

### Requirement: MCP launcher configuration
Repository configuration that launches MCP SHALL reference an existing executable or command.

#### Scenario: OpenCode config resolves
- **WHEN** `.opencode/opencode.json` declares the IndeX MCP server
- **THEN** its command SHALL resolve to an installed binary or `indeX mcp`

#### Scenario: No missing binary
- **WHEN** a build or install completes
- **THEN** every MCP command referenced by project configuration SHALL exist

#### Scenario: Tool count documented
- **WHEN** documentation describes the MCP tool set
- **THEN** it SHALL match the tools actually registered by `McpToolRegistry`
