## ADDED Requirements

### Requirement: Structured logger
The system SHALL provide a pino-based structured logger.

#### Scenario: Log at all levels
- **WHEN** calling `logger.info()`, `logger.warn()`, `logger.error()`, `logger.debug()`
- **THEN** structured JSON output SHALL be produced

#### Scenario: Child loggers
- **WHEN** calling `logger.child({ module: "indexing" })`
- **THEN** the child logger SHALL include the context in all subsequent log entries