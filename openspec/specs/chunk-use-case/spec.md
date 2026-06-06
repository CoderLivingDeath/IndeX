## ADDED Requirements

### Requirement: Chunk use case
The system SHALL chunk files with configurable strategy and filters.

#### Scenario: Execute chunk
- **WHEN** calling `chunkUseCase.execute("./vault", { strategy: "heading" })`
- **THEN** it SHALL return `Chunk[]` with metadata