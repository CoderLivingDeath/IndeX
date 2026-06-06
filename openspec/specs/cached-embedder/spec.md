## ADDED Requirements

### Requirement: Proxy decorator with caching
The system SHALL wrap any embedder with a cache-checking proxy.

#### Scenario: Cache hit skips inner call
- **WHEN** a cached embedding exists for `{model, text}`
- **THEN** the cached value SHALL be returned without calling the inner embedder

#### Scenario: Cache miss calls inner and caches
- **WHEN** no cached embedding exists
- **THEN** the inner embedder SHALL be called and the result SHALL be cached
