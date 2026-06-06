## ADDED Requirements

### Requirement: File system watcher
The system SHALL watch directories for file changes using chokidar.

#### Scenario: Emits add/change/unlink
- **WHEN** a file is added, changed, or deleted in the watched directory
- **THEN** the watcher SHALL emit corresponding events with the file path

#### Scenario: Start/stop lifecycle
- **WHEN** starting and stopping the watcher
- **THEN** it SHALL correctly manage internal chokidar resources

#### Scenario: 500ms debounce
- **WHEN** multiple rapid file changes occur
- **THEN** the watcher SHALL debounce events with a 500ms delay

### Requirement: Structured logger
The system SHALL provide a pino-based structured logger.

#### Scenario: Log at all levels
- **WHEN** calling `logger.info()`, `logger.warn()`, `logger.error()`, `logger.debug()`
- **THEN** structured JSON output SHALL be produced

#### Scenario: Child loggers
- **WHEN** calling `logger.child({ module: "indexing" })`
- **THEN** the child logger SHALL include the context in all subsequent log entries

### Requirement: Silent logger for tests
The system SHALL provide a no-op logger for test environments.

#### Scenario: No output
- **WHEN** calling any log method on SilentLogger
- **THEN** no output SHALL be produced

### Requirement: Markdown heading extractor
The system SHALL extract headings from Markdown for chunking.

#### Scenario: Headings with level and anchor
- **WHEN** extracting headings from Markdown
- **THEN** each heading SHALL have `level`, `text`, and GitHub-style `anchor`
