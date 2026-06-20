## ADDED Requirements

### Requirement: CLI commands
The system SHALL provide a CLI with all IndeX commands.

#### Scenario: CLI has all commands
- **WHEN** running `indeX --help`
- **THEN** the output SHALL list all commands: `embed`, `search`, `pack`, `chunk`, `scan`, `stats`, `clear`, `init`, `watch`

#### Scenario: embed command
- **WHEN** running `indeX embed ./vault`
- **THEN** it SHALL index all supported files in the directory

#### Scenario: search command
- **WHEN** running `indeX search "query" --mode hybrid --top-k 5`
- **THEN** it SHALL return top 5 hybrid search results

#### Scenario: pack command
- **WHEN** running `indeX pack ./vault -o bundle.md`
- **THEN** it SHALL create a bundled Markdown file

### Requirement: HTTP API
The system SHALL provide a Hono-based HTTP API.

#### Scenario: Search endpoint
- **WHEN** sending `GET /api/search?q=test&mode=hybrid`
- **THEN** it SHALL return JSON search results

#### Scenario: Stats endpoint
- **WHEN** sending `GET /api/stats`
- **THEN** it SHALL return index statistics as JSON

#### Scenario: Index endpoint
- **WHEN** sending `POST /api/index` with `{ path: "./vault" }`
- **THEN** it SHALL start indexing and return a status response

### Requirement: Web UI
The system SHALL provide a lightweight single-page application for search.

#### Scenario: Search interface
- **WHEN** opening the web UI in a browser
- **THEN** it SHALL display a search input and results area
