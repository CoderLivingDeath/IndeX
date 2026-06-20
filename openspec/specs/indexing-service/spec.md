## ADDED Requirements

### Requirement: Full indexing pipeline
The system SHALL index a directory by scanning, parsing, chunking, embedding, and upserting all supported files.

#### Scenario: Index scans and processes files
- **WHEN** calling `indexingService.index("./fixtures")`
- **THEN** it SHALL scan directory, parse each file, chunk, embed, and upsert to the repository

#### Scenario: Exclude patterns respected
- **WHEN** exclude patterns are configured
- **THEN** matching files SHALL be skipped

#### Scenario: Multi-model embedding
- **WHEN** multiple embedding models are configured
- **THEN** each chunk SHALL be embedded by all applicable models

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
