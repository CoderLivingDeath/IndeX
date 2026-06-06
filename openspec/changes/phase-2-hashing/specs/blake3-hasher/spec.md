## ADDED Requirements

### Requirement: BLAKE3 hash computation
The system SHALL compute BLAKE3 hashes of strings and files using `hash-wasm`.

#### Scenario: Hash of a string
- **WHEN** calling `hasher.hash("hello")`
- **THEN** it SHALL return a 64-character hex string

#### Scenario: Different inputs produce different hashes
- **WHEN** calling `hasher.hash("hello")` and `hasher.hash("world")`
- **THEN** the results SHALL be different

#### Scenario: HashFile returns same hash as hash(content)
- **WHEN** hashing a file via `hashFile(path)`
- **THEN** the result SHALL equal `hash(content)` where content is the file's text

#### Scenario: Hash of empty string
- **WHEN** calling `hasher.hash("")`
- **THEN** it SHALL return a valid 64-character hex string
