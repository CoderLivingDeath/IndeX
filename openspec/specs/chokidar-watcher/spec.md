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