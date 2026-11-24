## ADDED Requirements

### Requirement: Diff ingest preserves rows and reuses embeddings
The diff indexing service SHALL store every chunk of a changed file and reuse embeddings for content already present in the index.

#### Scenario: All chunks stored
- **WHEN** re-indexing a changed file
- **THEN** every chunk of that file SHALL be upserted with its own `path`, `source_id`, and `semantic_blake3`

#### Scenario: Embedding reuse
- **WHEN** a chunk's `semantic_blake3` already has a stored embedding
- **THEN** the diff indexing service SHALL reuse that vector instead of calling the embedder

#### Scenario: In-batch reuse
- **WHEN** the same file produces two chunks with identical `semantic_blake3`
- **THEN** the second chunk SHALL reuse the first chunk's embedding within the same run

#### Scenario: Old rows replaced
- **WHEN** a file is re-indexed
- **THEN** all previous rows for that path SHALL be deleted before the new rows are inserted

#### Scenario: FileIndex rebuilt
- **WHEN** a code file changes
- **THEN** its `FileIndex` SHALL be rebuilt with updated symbols, imports, and exports

#### Scenario: No embedding available
- **WHEN** no stored embedding exists for a chunk hash
- **THEN** the chunk SHALL be embedded normally
