## ADDED Requirements

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