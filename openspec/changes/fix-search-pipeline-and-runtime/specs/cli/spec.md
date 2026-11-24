## MODIFIED Requirements

### Requirement: CLI with all commands
The system SHALL provide a Commander-based CLI with all IndeX commands.

#### Scenario: CLI has all commands
- **WHEN** running `indeX --help`
- **THEN** the output SHALL list all commands: `embed`, `search`, `pack`, `chunk`, `scan`, `stats`, `clear`, `init`, `sync`, `watch`, `mcp`

#### Scenario: Embed command runs full pipeline
- **WHEN** running `indeX embed ./vault`
- **THEN** it SHALL index all supported files in the directory

#### Scenario: Search command with modes
- **WHEN** running `indeX search "query" --mode hybrid --top-k 5`
- **THEN** it SHALL return top 5 hybrid search results

#### Scenario: Search command forwards tags
- **WHEN** running `indeX search "query" --tags devops`
- **THEN** the tags filter SHALL be passed to the search use case and applied to results

#### Scenario: Search command uses config defaults
- **WHEN** running `indeX search "query"` without `--mode` or `--top-k`
- **THEN** it SHALL use `search.default_mode` and `search.top_k` from the loaded config

#### Scenario: Pack command with sections
- **WHEN** running `indeX pack . --format md -o bundle.md`
- **THEN** it SHALL create a bundled output file

#### Scenario: Sync command listed
- **WHEN** running `indeX --help`
- **THEN** `sync [dir]` SHALL be documented as a command that prunes stale entries and reindexes changed files

#### Scenario: Watch commands
- **WHEN** running `indeX watch start <dir>`, `indeX watch status`, `indeX watch stop`
- **THEN** they SHALL start, check, and stop the background watcher daemon

#### Scenario: Removed legacy index command
- **WHEN** running `indeX index .`
- **THEN** the CLI SHALL report an unknown command instead of silently accepting a dead command

#### Scenario: MCP command documented
- **WHEN** running `indeX --help`
- **THEN** the `mcp` command SHALL be listed

#### Scenario: Machine-readable columns
- **WHEN** running `indeX search "query" --columns chunk,blake3,timestamps`
- **THEN** the output SHALL use the column shapes documented in README
