## ADDED Requirements

### Requirement: Watch use case
The system SHALL watch a directory and run diff indexing on file changes.

#### Scenario: Execute watch
- **WHEN** calling `watchUseCase.execute("./vault")`
- **THEN** it SHALL start the FileWatcher and wire events to DiffIndexingService