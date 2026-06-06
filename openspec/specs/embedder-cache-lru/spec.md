## ADDED Requirements

### Requirement: Per-model LRU cache
The system SHALL cache embedding vectors per model with LRU eviction.

#### Scenario: Set and get
- **WHEN** setting a cache entry and getting it
- **THEN** the same embedding SHALL be returned

#### Scenario: Cache key includes model
- **WHEN** caching with key `${model}:${hash}`
- **THEN** different models with the same hash SHALL have different cache entries

#### Scenario: LRU eviction
- **WHEN** the cache exceeds max size
- **THEN** the least recently used entry SHALL be evicted
