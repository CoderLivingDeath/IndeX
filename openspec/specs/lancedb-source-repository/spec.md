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
