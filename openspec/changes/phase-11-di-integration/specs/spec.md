## ADDED Requirements

### Requirement: DI container wires all modules
The system SHALL wire together all IndeX modules in a single composition root.

#### Scenario: createApp() returns use cases
- **WHEN** calling `createApp(configPath)`
- **THEN** it SHALL return an object with all use cases: `index`, `search`, `pack`, `chunk`, `embed`, `watch`, `delete`

#### Scenario: Eager initialization
- **WHEN** calling `createApp()`
- **THEN** all dependencies SHALL be constructed eagerly (no lazy singletons except external connections)

### Requirement: Integration test validates full pipeline
The system SHALL have an integration test exercising real parsers + real chunkers + mocks.

#### Scenario: Index → search → pack cycle
- **WHEN** running the integration test
- **THEN** a Markdown fixture SHALL be indexed, searchable, and packable through the full pipeline
