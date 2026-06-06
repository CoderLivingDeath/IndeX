## ADDED Requirements

### Requirement: DI container wires all modules
The system SHALL wire together all IndeX modules in a single composition root.

#### Scenario: createApp() returns use cases
- **WHEN** calling `createApp(configPath)`
- **THEN** it SHALL return an object with all use cases: `index`, `search`, `pack`, `chunk`, `embed`, `watch`, `delete`

#### Scenario: Eager initialization
- **WHEN** calling `createApp()`
- **THEN** all dependencies SHALL be constructed eagerly (no lazy singletons except external connections)