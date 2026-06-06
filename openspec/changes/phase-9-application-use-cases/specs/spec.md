## ADDED Requirements

### Requirement: DI dependency groups
The system SHALL bundle related dependencies into DI group interfaces for use case injection.

#### Scenario: IndexSystems bundle
- **WHEN** defining `IndexSystems`
- **THEN** it SHALL include `ParserRegistry`, `ChunkerPipeline`, `EmbedderRegistry`, `SourceRepository`, `Logger`, `Hasher`

### Requirement: Full index use case
The system SHALL orchestrate complete indexing with all real systems via DI.

#### Scenario: Execute full index
- **WHEN** calling `indexUseCase.execute("./vault")`
- **THEN** it SHALL scan, parse, chunk, multi-model embed, and upsert all files

### Requirement: Search use case
The system SHALL search the index with configurable mode and filters.

#### Scenario: Execute search
- **WHEN** calling `searchUseCase.execute("query", { mode: "hybrid" })`
- **THEN** it SHALL return `SearchResult[]` with hybrid ranked results

### Requirement: Pack use case
The system SHALL package files into a single Markdown bundle with include/exclude filters.

#### Scenario: Execute pack
- **WHEN** calling `packUseCase.execute("./vault", { include: ["**/*.md"] })`
- **THEN** it SHALL concatenate matching files into a Markdown document

### Requirement: Chunk use case
The system SHALL chunk files with configurable strategy and filters.

#### Scenario: Execute chunk
- **WHEN** calling `chunkUseCase.execute("./vault", { strategy: "heading" })`
- **THEN** it SHALL return `Chunk[]` with metadata

### Requirement: Embed use case
The system SHALL generate embeddings from chunks or re-parsed files.

#### Scenario: Embed from chunks
- **WHEN** calling `embedUseCase.execute({ source: "chunks" })`
- **THEN** it SHALL embed existing chunks and upsert to database

### Requirement: Watch use case
The system SHALL watch a directory and run diff indexing on file changes.

#### Scenario: Execute watch
- **WHEN** calling `watchUseCase.execute("./vault")`
- **THEN** it SHALL start the FileWatcher and wire events to DiffIndexingService

### Requirement: Delete use case
The system SHALL remove indexed data by path or source ID.

#### Scenario: Delete by path
- **WHEN** calling `deleteUseCase.execute("./vault/note.md")`
- **THEN** all chunks for that path SHALL be removed from the index

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
