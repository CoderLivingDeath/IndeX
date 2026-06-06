## ADDED Requirements

### Requirement: Silent logger for tests
The system SHALL provide a no-op logger for test environments.

#### Scenario: No output
- **WHEN** calling any log method on SilentLogger
- **THEN** no output SHALL be produced