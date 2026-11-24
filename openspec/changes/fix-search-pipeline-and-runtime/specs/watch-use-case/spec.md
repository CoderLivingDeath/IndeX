## MODIFIED Requirements

### Requirement: Watch use case
The system SHALL watch a directory, reindex added or changed files, and remove deleted files from the index.

#### Scenario: Execute watch
- **WHEN** calling `watchUseCase.execute("./vault")`
- **THEN** it SHALL start the FileWatcher and wire events to DiffIndexingService

#### Scenario: Added file indexed
- **WHEN** the watcher emits `add` for a path
- **THEN** `DiffIndexingService.diffIndexFile(path)` SHALL be called

#### Scenario: Changed file indexed
- **WHEN** the watcher emits `change` for a path
- **THEN** `DiffIndexingService.diffIndexFile(path)` SHALL be called

#### Scenario: Deleted file removed from index
- **WHEN** the watcher emits `unlink` for a path
- **THEN** all chunks and the file index entry for that path SHALL be deleted from the repository

#### Scenario: Deleted untracked file is harmless
- **WHEN** `unlink` fires for a path that has no rows in the index
- **THEN** the operation SHALL complete without error

#### Scenario: Stop watcher
- **WHEN** calling `watchUseCase.stop()`
- **THEN** the underlying file watcher SHALL be closed
