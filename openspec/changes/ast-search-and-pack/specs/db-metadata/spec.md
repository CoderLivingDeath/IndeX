## ADDED Requirements

### Requirement: Database metadata table
The system SHALL maintain a `db_meta` key-value table in LanceDB for database-level metadata.

#### Scenario: db_meta table exists
- **WHEN** connecting to the database
- **THEN** a `db_meta` table SHALL be available with `key` and `value` columns

#### Scenario: Write metadata
- **WHEN** calling `setDbMeta("schema_version", 2)`
- **THEN** the value SHALL be persisted and retrievable

#### Scenario: Read metadata
- **WHEN** calling `getDbMeta("schema_version")`
- **THEN** the stored value SHALL be returned, or `null` if not set

#### Scenario: Read all metadata
- **WHEN** calling `getAllDbMeta()`
- **THEN** all key-value pairs SHALL be returned as a flat object

### Requirement: Auto-update metadata after indexing
The system SHALL update `last_indexed`, `total_files`, `total_chunks`, `total_tokens` in `db_meta` after each index or diff-index run.

#### Scenario: Index updates metadata
- **WHEN** indexing completes
- **THEN** `last_indexed` SHALL be set to the current timestamp, and stats SHALL be updated
