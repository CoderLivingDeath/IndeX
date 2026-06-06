## ADDED Requirements

### Requirement: Incremental diff indexing
The system SHALL index only changed files by comparing `file_blake3` hashes.

#### Scenario: Unchanged file skipped
- **WHEN** `file_blake3` matches the stored hash
- **THEN** the file SHALL be skipped (no re-processing)

#### Scenario: Changed file re-processed
- **WHEN** `file_blake3` differs from the stored hash
- **THEN** the file SHALL be re-parsed, re-chunked, and re-embedded

#### Scenario: Cross-file semantic dedup
- **WHEN** removing a chunk whose `semantic_blake3` is referenced by another file
- **THEN** the chunk SHALL NOT be deleted

#### Scenario: FileIndex rebuilt
- **WHEN** a file changes
- **THEN** its `FileIndex` SHALL be rebuilt with updated symbols/imports/exports
