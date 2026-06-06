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
