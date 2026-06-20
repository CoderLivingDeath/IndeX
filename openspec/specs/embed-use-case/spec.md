## ADDED Requirements

### Requirement: Embed command runs full pipeline
The CLI `embed <path>` command SHALL scan, parse, chunk, embed, and save all supported files to LanceDB using `IndexUseCase`.

#### Scenario: Embed from directory
- **WHEN** running `indeX embed ./path`
- **THEN** it SHALL scan directory, parse each file, chunk, embed via all configured models, and upsert chunks to database

#### Scenario: Embed returns statistics
- **WHEN** embedding completes
- **THEN** it SHALL return `total_files`, `total_chunks`, and `total_deduped_chunks` counts