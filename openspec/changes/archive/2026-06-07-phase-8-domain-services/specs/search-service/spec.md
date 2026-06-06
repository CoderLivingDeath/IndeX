## ADDED Requirements

### Requirement: Three-mode search
The system SHALL search indexed content with semantic, keyword, or hybrid modes.

#### Scenario: Semantic search
- **WHEN** searching with `mode: "semantic"`
- **THEN** ANN search SHALL be performed on vector columns

#### Scenario: Keyword search
- **WHEN** searching with `mode: "keyword"`
- **THEN** FTS/BM25 search SHALL be performed

#### Scenario: Hybrid search
- **WHEN** searching with `mode: "hybrid"`
- **THEN** ANN and BM25 results SHALL be merged with weighted hybrid scoring

#### Scenario: BM25 normalization
- **WHEN** performing hybrid search
- **THEN** BM25 scores SHALL be normalized to [0, 1] via `(bm25 - min) / (max - min)`

#### Scenario: Post-filter by tags
- **WHEN** filters include `tags: ["devops"]`
- **THEN** results SHALL be filtered AFTER ANN/FTS search

#### Scenario: Multi-model averaging
- **WHEN** a chunk is found by multiple models
- **THEN** the semantic score SHALL be the average of all model scores
