## ADDED Requirements

### Requirement: Integration test validates full pipeline
The system SHALL have an integration test exercising real parsers + real chunkers + mocks.

#### Scenario: Index → search → pack cycle
- **WHEN** running the integration test
- **THEN** a Markdown fixture SHALL be indexed, searchable, and packable through the full pipeline