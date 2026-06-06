## ADDED Requirements

### Requirement: Core data types
The system SHALL define shared data types for all indexing and search operations.

#### Scenario: SourceData can be created
- **WHEN** creating a `SourceData` object
- **THEN** it SHALL contain all required fields: `id`, `chunk_id`, `source_id`, `type`, `title`, `content`, `tags`, `path`, `file_blake3`, `semantic_blake3`, `chunk_index`, `total_chunks`, `embeddings`, `metadata`, timestamps

#### Scenario: SearchResult contains source and score
- **WHEN** creating a `SearchResult`
- **THEN** it SHALL contain the `source` data, `score`, `match_type`, and optional `model_scores`

#### Scenario: SourceMetadata is a discriminated union
- **WHEN** creating metadata
- **THEN** the `kind` field SHALL discriminate between `'code'`, `'markdown'`, `'obsidian'`, and `'generic'`
- **THEN** TypeScript SHALL enforce exhaustive narrowing on `kind`

#### Scenario: IndexStats reports correct counts
- **WHEN** requesting `IndexStats`
- **THEN** it SHALL contain `total_sources`, `total_chunks`, `total_files`, and `last_indexed` timestamp
