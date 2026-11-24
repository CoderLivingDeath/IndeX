## MODIFIED Requirements

### Requirement: Dedup at ingest via semantic_blake3 check
The system SHALL reuse an existing embedding when a chunk's `semantic_blake3` is already known, while still persisting a chunk row for every file.

#### Scenario: Duplicate embedding reused
- **WHEN** indexing a chunk whose `semantic_blake3` already has a stored embedding
- **THEN** the stored vector SHALL be reused and the embedder SHALL NOT be called for that chunk

#### Scenario: Chunk row still persisted
- **WHEN** a chunk's embedding is reused
- **THEN** the chunk SHALL still be upserted with its own `id`, `source_id`, and `path`

#### Scenario: In-batch duplicate
- **WHEN** two chunks in the same indexing batch share a `semantic_blake3`
- **THEN** the first chunk SHALL be embedded and the second SHALL reuse its vector from the in-memory batch map

#### Scenario: Fully duplicated file remains discoverable
- **WHEN** every chunk of a file matches content already present elsewhere in the index
- **THEN** the file SHALL still have rows in the `sources` table and SHALL be findable by path

#### Scenario: Reuse accounting
- **WHEN** indexing completes
- **THEN** `total_deduped_chunks` SHALL report the number of reused embeddings, not the number of dropped rows

#### Scenario: No stored embedding
- **WHEN** a hash exists but its stored embedding is empty
- **THEN** the chunk SHALL be embedded normally
