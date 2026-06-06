## ADDED Requirements

### Requirement: Error-throwing null embedder
The system SHALL provide a null embedder that always throws.

#### Scenario: Always throws
- **WHEN** calling `nullEmbedder.embed("anything")`
- **THEN** it SHALL throw "no embedder available"
