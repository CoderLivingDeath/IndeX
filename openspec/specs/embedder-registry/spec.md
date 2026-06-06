## ADDED Requirements

### Requirement: Config-driven embedder registry
The system SHALL build an embedder registry from `ModelConfig[]`, routing source types to correct models by priority.

#### Scenario: getEmbedder by source type
- **WHEN** calling `registry.getEmbedder("typescript")`
- **THEN** it SHALL return the model with minimum priority for that source type

#### Scenario: getEmbedders returns all matching models
- **WHEN** calling `registry.getEmbedders("typescript")`
- **THEN** it SHALL return all models that support that source type, ordered by priority

#### Scenario: Universal model returned for unresolvable types
- **WHEN** calling `registry.getEmbedder("unknown-type")`
- **THEN** it SHALL return the universal model (model without source_types filter)

#### Scenario: isAvailable returns false with no models
- **WHEN** the registry has no registered models
- **THEN** `isAvailable()` SHALL return false
