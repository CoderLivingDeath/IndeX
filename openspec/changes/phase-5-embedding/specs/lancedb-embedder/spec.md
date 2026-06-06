## ADDED Requirements

### Requirement: Zero-vector fallback embedder
The system SHALL provide a fallback embedder that returns zero vectors of configured dimension.

#### Scenario: Returns zero vector
- **WHEN** calling `lancedbEmbedder.embed("any text")`
- **THEN** it SHALL return a zero-filled `Float32Array` of configured dimensions

#### Scenario: Enables ANN without Ollama
- **WHEN** Ollama is unavailable
- **THEN** the zero-vector embedder SHALL enable ANN search (keyword-only via L2 distance on zero vectors)
