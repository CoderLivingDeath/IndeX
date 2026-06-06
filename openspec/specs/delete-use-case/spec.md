## ADDED Requirements

### Requirement: Delete use case
The system SHALL remove indexed data by path or source ID.

#### Scenario: Delete by path
- **WHEN** calling `deleteUseCase.execute("./vault/note.md")`
- **THEN** all chunks for that path SHALL be removed from the index