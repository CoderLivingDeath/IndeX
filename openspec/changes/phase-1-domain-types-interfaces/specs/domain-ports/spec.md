## ADDED Requirements

### Requirement: SourceRepository provides full CRUD
The system SHALL define a `SourceRepository` port for chunk storage and retrieval.

#### Scenario: All repository methods exist
- **WHEN** using `SourceRepository`
- **THEN** it SHALL provide methods: `upsert`, `upsertBatch`, `getById`, `getByPath`, `delete`, `search`, `hasSemanticBlake3`, `hasModelEmbedding`, `getSourceIdsByHash`, `getFileBlake3ByPath`, `stats`, `upsertFileIndex`, `getFileIndex`, `deleteFileIndex`

### Requirement: SourceParser parses files by extension
The system SHALL define a `SourceParser` port for file parsing.

#### Scenario: Parser has type and extension info
- **WHEN** inspecting a `SourceParser`
- **THEN** it SHALL have `type` (SourceType), `extensions` (string[]), `supportsFile(path)`, and `parse(path)`

#### Scenario: ParserRegistry routes files
- **WHEN** calling `ParserRegistry.getParser(path)`
- **THEN** it SHALL return the correct parser based on extension and content sniffing

### Requirement: FileWatcher monitors directories
The system SHALL define a `FileWatcher` port with lifecycle and events.

#### Scenario: Watcher emits file events
- **WHEN** a file is added/changed/deleted in the watched directory
- **THEN** the watcher SHALL emit `add`, `change`, or `unlink` events
