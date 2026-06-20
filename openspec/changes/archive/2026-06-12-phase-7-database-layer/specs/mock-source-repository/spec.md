## ADDED Requirements

### Requirement: In-memory mock repository for tests
The system SHALL provide an in-memory `SourceRepository` implementation for unit tests.

#### Scenario: All SourceRepository methods implemented
- **WHEN** using `MockSourceRepository`
- **THEN** it SHALL implement all methods of the `SourceRepository` interface

#### Scenario: In-memory storage
- **WHEN** upserting and searching
- **THEN** data SHALL be stored in-memory (no disk I/O)
