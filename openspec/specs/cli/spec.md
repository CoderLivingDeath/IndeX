## ADDED Requirements

### Requirement: CLI with all commands
The system SHALL provide a Commander-based CLI with all IndeX commands.

#### Scenario: CLI has all commands
- **WHEN** running `indeX --help`
- **THEN** the output SHALL list all commands: `embed`, `search`, `pack`, `chunk`, `scan`, `stats`, `clear`, `init`, `watch`

#### Scenario: Embed command runs full pipeline
- **WHEN** running `indeX embed ./vault`
- **THEN** it SHALL index all supported files in the directory

#### Scenario: Search command with modes
- **WHEN** running `indeX search "query" --mode hybrid --top-k 5`
- **THEN** it SHALL return top 5 hybrid search results

#### Scenario: Pack command with sections
- **WHEN** running `indeX pack . --format md -o bundle.md`
- **THEN** it SHALL create a bundled output file

#### Scenario: Watch commands
- **WHEN** running `indeX watch start <dir>`, `indeX watch status`, `indeX watch stop`
- **THEN** they SHALL start, check, and stop the background watcher daemon
