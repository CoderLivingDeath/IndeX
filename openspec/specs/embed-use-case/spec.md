## ADDED Requirements

### Requirement: Embed use case
The system SHALL generate embeddings from chunks or re-parsed files.

#### Scenario: Embed from chunks
- **WHEN** calling `embedUseCase.execute({ source: "chunks" })`
- **THEN** it SHALL embed existing chunks and upsert to database