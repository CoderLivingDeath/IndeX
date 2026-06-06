## ADDED Requirements

### Requirement: DI dependency groups
The system SHALL bundle related dependencies into DI group interfaces for use case injection.

#### Scenario: IndexSystems bundle
- **WHEN** defining `IndexSystems`
- **THEN** it SHALL include `ParserRegistry`, `ChunkerPipeline`, `EmbedderRegistry`, `SourceRepository`, `Logger`, `Hasher`

#### Scenario: SearchSystems bundle
- **WHEN** defining `SearchSystems`
- **THEN** it SHALL include `Embedder`, `SourceRepository`, `ContextPacker`, `Logger`

#### Scenario: PackSystems bundle
- **WHEN** defining `PackSystems`
- **THEN** it SHALL include `ParserRegistry`, `FileFilter`, `Logger`

#### Scenario: ChunkSystems bundle
- **WHEN** defining `ChunkSystems`
- **THEN** it SHALL include `ParserRegistry`, `Chunker`, `FileFilter`, `Logger`

#### Scenario: EmbedSystems bundle
- **WHEN** defining `EmbedSystems`
- **THEN** it SHALL include `EmbedderRegistry`, `SourceRepository`, `Logger`