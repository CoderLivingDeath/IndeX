## MODIFIED Requirements

### Requirement: Three-mode search
The system SHALL rank indexed content with semantic, keyword, or hybrid modes using a query vector supplied by the caller.

#### Scenario: Semantic search
- **WHEN** searching with `mode: "semantic"` and a non-empty query vector
- **THEN** ANN search SHALL be performed on the vector column and results SHALL be scored by cosine similarity

#### Scenario: Keyword search
- **WHEN** searching with `mode: "keyword"`
- **THEN** FTS/BM25 search SHALL be performed

#### Scenario: Hybrid search
- **WHEN** searching with `mode: "hybrid"`
- **THEN** ANN and BM25 results SHALL be merged using `search.hybrid_weight` from the application config

#### Scenario: BM25 normalization
- **WHEN** performing hybrid search
- **THEN** BM25 scores SHALL be normalized to [0, 1] via `(bm25 - min) / (max - min)`

#### Scenario: Post-filter by tags
- **WHEN** filters include `tags: ["devops"]`
- **THEN** results SHALL be filtered AFTER ANN/FTS search

#### Scenario: Multi-model averaging
- **WHEN** a chunk is found by multiple models
- **THEN** the semantic score SHALL be the average of all model scores

#### Scenario: No vector supplied for semantic mode
- **WHEN** `mode` is `semantic` or `hybrid` and the query vector is missing or empty
- **THEN** the engine SHALL return an empty result set instead of silently falling back to keyword search

#### Scenario: Score semantics
- **WHEN** results are returned
- **THEN** every `score` SHALL be in `[0, 1]` and higher values SHALL indicate greater relevance

#### Scenario: Single query embedding
- **WHEN** performing hybrid search
- **THEN** the query SHALL be embedded exactly once and the same vector SHALL be used for the ANN leg
