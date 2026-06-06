## ADDED Requirements

### Requirement: Search use case
The system SHALL search the index with configurable mode and filters.

#### Scenario: Execute search
- **WHEN** calling `searchUseCase.execute("query", { mode: "hybrid" })`
- **THEN** it SHALL return `SearchResult[]` with hybrid ranked results