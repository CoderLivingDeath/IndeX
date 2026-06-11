## ADDED Requirements

### Requirement: Dedup at ingest via semantic_blake3 check
The system SHALL skip inserting a chunk if its `semantic_blake3` already exists in the database.

#### Scenario: Duplicate chunk skipped
- **WHEN** indexing a chunk whose `semantic_blake3` already exists
- **THEN** the chunk SHALL NOT be upserted

### Requirement: AST summary appended to core_content before embedding
The system SHALL append an AST summary to `core_content` before passing it to the embedder for code files.

#### Scenario: AST summary included in embedding input
- **WHEN** embedding a code file chunk with AST data
- **THEN** `core_content` SHALL include an `--- AST ---` section with imports, exports, and symbols summary

#### Scenario: No AST summary for non-code files
- **WHEN** embedding a markdown or generic file chunk
- **THEN** no AST summary SHALL be appended
