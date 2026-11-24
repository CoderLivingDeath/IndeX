## MODIFIED Requirements

### Requirement: DI container wires all modules
The system SHALL wire together all IndeX modules in a single composition root.

#### Scenario: createApp() returns use cases
- **WHEN** calling `createApp(configPath)`
- **THEN** it SHALL return an object with all use cases: `index`, `search`, `pack`, `chunk`, `embed`, `watch`, `del`, `sync`, plus `config` and `mcp`

#### Scenario: Eager initialization
- **WHEN** calling `createApp()`
- **THEN** all dependencies SHALL be constructed eagerly (no lazy singletons except external connections)

#### Scenario: Injected logger is honored
- **WHEN** calling `createApp({ logger })` with a custom logger
- **THEN** every wired service SHALL use the supplied logger, not `SilentLogger`

#### Scenario: Test mode is silent
- **WHEN** calling `createApp({ testMode: true })` without a logger
- **THEN** the container SHALL use `SilentLogger`

#### Scenario: Single search pipeline
- **WHEN** `createApp()` builds the search use case
- **THEN** it SHALL use one ranking engine configured with `search.hybrid_weight`

#### Scenario: Query embedding uses the cache
- **WHEN** a search query is embedded
- **THEN** it SHALL go through the shared `CachedEmbedder` rather than a raw embedder

#### Scenario: No dead use-case wiring
- **WHEN** `createApp()` completes
- **THEN** every constructed service SHALL be reachable from the returned `AppUseCases`
