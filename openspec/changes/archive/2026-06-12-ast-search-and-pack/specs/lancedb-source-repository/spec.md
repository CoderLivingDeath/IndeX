## ADDED Requirements

### Requirement: DB metadata table
The system SHALL provide `getDbMeta`, `setDbMeta`, and `getAllDbMeta` methods on the source repository.

#### Scenario: setDbMeta persists a value
- **WHEN** calling `setDbMeta("key", value)`
- **THEN** the value SHALL be written to the `db_meta` table

#### Scenario: getDbMeta retrieves a value
- **WHEN** calling `getDbMeta("key")`
- **THEN** the stored value SHALL be returned, or `null` if missing

#### Scenario: getAllDbMeta returns all pairs
- **WHEN** calling `getAllDbMeta()`
- **THEN** all key-value pairs SHALL be returned as `Record<string, unknown>`

### Requirement: ast_text column in file_index
The `file_index` table SHALL include an `ast_text` column with FTS index.

#### Scenario: ast_text column on table creation
- **WHEN** creating the `file_index` table
- **THEN** the schema SHALL include an `ast_text` (Utf8) column

#### Scenario: FTS index on ast_text
- **WHEN** the `file_index` table is created or opened
- **THEN** an FTS index SHALL be created on the `ast_text` column
