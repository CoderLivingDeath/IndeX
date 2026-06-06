## ADDED Requirements

### Requirement: Pack use case
The system SHALL package files into a single Markdown bundle with include/exclude filters.

#### Scenario: Execute pack
- **WHEN** calling `packUseCase.execute("./vault", { include: ["**/*.md"] })`
- **THEN** it SHALL concatenate matching files into a Markdown document