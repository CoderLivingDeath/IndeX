## MODIFIED Requirements

### Requirement: Config loader
The system SHALL load and validate configuration from `.indeX/config.json` using Zod.

#### Scenario: Load validates config
- **WHEN** loading a valid config file
- **THEN** it SHALL return a validated `Config` object

#### Scenario: LoadOrDefault returns defaults
- **WHEN** no config file exists
- **THEN** `loadOrDefault()` SHALL return sensible defaults

#### Scenario: Invalid JSON raises error
- **WHEN** loading a malformed config file
- **THEN** it SHALL throw a descriptive Zod validation error

#### Scenario: Default exclude patterns are globs
- **WHEN** a config file omits `indexing.exclude`
- **THEN** the resolved defaults SHALL use glob patterns that match nested paths such as `node_modules/pkg/file.ts` and `.git/config`

#### Scenario: Defaults are isolated
- **WHEN** `loadOrDefault()` returns the default configuration
- **THEN** mutating the returned object or its nested arrays SHALL NOT mutate the shared default configuration

#### Scenario: Search defaults validated
- **WHEN** a config file specifies `search.default_mode`, `search.top_k`, or `search.hybrid_weight`
- **THEN** the values SHALL be validated and exposed unchanged to consumers
