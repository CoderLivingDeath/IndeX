## MODIFIED Requirements

### Requirement: Embed runs full indexing pipeline
The CLI `embed <path>` command SHALL run the full indexing pipeline via `app.index.execute()`, replacing the old `index` command.

#### Scenario: Embed from directory
- **WHEN** running `indeX embed ./path`
- **THEN** it SHALL scan, parse, chunk, embed via all configured models, and upsert to database

#### Scenario: BLAKE3 hash on embed
- **WHEN** embedding a chunk
- **THEN** each chunk's `semantic_blake3` SHALL be a BLAKE3 hash of its `core_content`, not a random UUID

#### Scenario: Embed returns statistics
- **WHEN** embedding completes
- **THEN** it SHALL return `total_files`, `total_chunks`, and `total_deduped_chunks`
