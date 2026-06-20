## ADDED Requirements

### Requirement: LanceDB-based source repository
The system SHALL persist chunks and file indexes in LanceDB with hybrid search support.

#### Scenario: Two tables
- **WHEN** connecting to LanceDB
- **THEN** it SHALL create `sources` table (for chunks) and `file_index` table (for AST summaries)

#### Scenario: Upsert and retrieve
- **WHEN** upserting a `SourceData` record
- **THEN** it SHALL be retrievable by `id`, `path`, and `source_id`

#### Scenario: Multi-column vector search
- **WHEN** inserting embeddings for multiple models
- **THEN** each model SHALL be stored in its own vector column (`vect_{model_name}`)

#### Scenario: Hybrid search
- **WHEN** performing search with `mode: "hybrid"`
- **THEN** ANN (cosine similarity) and FTS (BM25) SHALL both be queried

#### Scenario: Stats
- **WHEN** requesting stats
- **THEN** `total_sources`, `total_chunks`, and `total_files` SHALL be reported

#### Scenario: hasSemanticBlake3
- **WHEN** checking if a semantic_blake3 exists
- **THEN** it SHALL return `true` if any chunk has that hash

#### Scenario: Delete by path
- **WHEN** deleting by file path
- **THEN** all chunks for that path SHALL be removed

#### Scenario: AST search mode
- **WHEN** performing search with `mode: "ast"`
- **THEN** FTS on the `ast_text` column SHALL be used instead of content search

### Requirement: DB metadata table
The system SHALL provide `getDbMeta`, `setDbMeta`, and `getAllDbMeta` methods on the source repository.

#### Scenario: setDbMeta persists a value
- **WHEN** calling `setDbMeta("key", value)`
- **THEN** the value SHALL be written to the `db_meta` table

#### Scenario: getDbMeta retrieves a value
- **WHEN** calling `getDbMeta("key")`
- **THEN** the stored value SHALL be returned, or `null` if missing

#### Scenario: getAllDbMeta returns all pairs
- **WHEN** calling `getAllDbMeta()`
- **THEN** all key-value pairs SHALL be returned as `Record<string, unknown>`

### Requirement: ast_text column + FTS index in file_index
The `file_index` table SHALL include an `ast_text` column with FTS index for structural AST search.

#### Scenario: ast_text column on table creation
- **WHEN** creating the `file_index` table
- **THEN** the schema SHALL include an `ast_text` (Utf8) column

#### Scenario: FTS index on ast_text
- **WHEN** the `file_index` table is created or opened
- **THEN** an FTS index SHALL be created on the `ast_text` column
