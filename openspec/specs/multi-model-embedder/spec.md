## ADDED Requirements

### Requirement: Parallel multi-model embedding
The system SHALL invoke multiple embedders in parallel and return all results.

#### Scenario: Returns Record of model → embedding
- **WHEN** calling `embedAll(text)` with multiple embedders
- **THEN** it SHALL return `Record<modelName, Embedding>` with entries for all successful embedders

#### Scenario: Partial failure tolerated
- **WHEN** one embedder fails
- **THEN** the other embedders' results SHALL still be returned
