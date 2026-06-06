## ADDED Requirements

### Requirement: MockHasher for tests
The system SHALL provide a `MockHasher` using SHA256 for deterministic test hashing.

#### Scenario: MockHasher produces deterministic hashes
- **WHEN** calling `mockHasher.hash("test")`
- **THEN** it SHALL return the same SHA256 hex string every time

#### Scenario: MockHasher implements Hasher interface
- **WHEN** checking `MockHasher` type
- **THEN** it SHALL satisfy the `Hasher` interface
