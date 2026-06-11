## ADDED Requirements

### Requirement: Update db_meta after indexing
The system SHALL update database metadata (`last_indexed`, `total_files`, `total_chunks`, `total_tokens`) after a full index run.

#### Scenario: Metadata updated after index
- **WHEN** index use case completes
- **THEN** `last_indexed`, `total_files`, `total_chunks`, and `total_tokens` SHALL be updated in `db_meta`
