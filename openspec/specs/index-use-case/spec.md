## ADDED Requirements

### Requirement: Full index use case
The system SHALL orchestrate complete indexing with all real systems via DI.

#### Scenario: Execute full index
- **WHEN** calling `indexUseCase.execute("./vault")`
- **THEN** it SHALL scan, parse, chunk, multi-model embed, and upsert all files