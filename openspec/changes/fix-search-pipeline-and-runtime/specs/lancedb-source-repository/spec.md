## MODIFIED Requirements

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

#### Scenario: Vector search uses typed query vector
- **WHEN** performing search with `mode: "semantic"` or `mode: "hybrid"` and `query.vector` is non-empty
- **THEN** ANN search SHALL run against the `embeddings` column using the supplied vector

#### Scenario: Cosine similarity scoring
- **WHEN** running a vector search
- **THEN** the query SHALL use cosine distance and each result score SHALL be `clamp(1 - distance, 0, 1)`

#### Scenario: Missing vector
- **WHEN** `mode: "semantic"` is requested without `query.vector`
- **THEN** the repository SHALL NOT substitute keyword search; it SHALL return an empty result set

#### Scenario: Tag filter
- **WHEN** `query.tags` is non-empty
- **THEN** only rows whose JSON `tags` array contains one of the requested tags SHALL be returned

#### Scenario: Hybrid search
- **WHEN** performing search with `mode: "hybrid"` and a query vector
- **THEN** ANN and FTS SHALL both be queried and merged with the configured hybrid weight

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

## ADDED Requirements

### Requirement: Embedding lookup by semantic hash
The repository SHALL expose `getEmbeddingBySemanticHash(hash)` so ingest can reuse an existing vector for duplicate content.

#### Scenario: Existing embedding found
- **WHEN** calling `getEmbeddingBySemanticHash(hash)` and a row with that `semantic_blake3` has a non-empty embedding
- **THEN** it SHALL return the embedding as `number[]`

#### Scenario: No embedding available
- **WHEN** no row has the hash, or the matching row has an empty embedding
- **THEN** it SHALL return `null`

#### Scenario: Missing table
- **WHEN** the `sources` table does not exist yet
- **THEN** it SHALL return `null` without throwing
