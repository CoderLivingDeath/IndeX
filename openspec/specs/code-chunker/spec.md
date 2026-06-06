## ADDED Requirements

### Requirement: Split code by function/class boundaries
The system SHALL split TypeScript code by function and class boundaries as indivisible units.

#### Scenario: Function is one chunk
- **WHEN** chunking code with one function
- **THEN** the entire function SHALL be one chunk (indivisible)

#### Scenario: Class is one chunk
- **WHEN** chunking code with one class
- **THEN** the entire class SHALL be one chunk (indivisible)

#### Scenario: No overlap for code
- **WHEN** chunking code
- **THEN** there SHALL be no overlap between code chunks
