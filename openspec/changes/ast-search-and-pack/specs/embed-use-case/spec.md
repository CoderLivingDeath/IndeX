## MODIFIED Requirements

### Requirement: Embed with real BLAKE3 hash
The system SHALL use a real BLAKE3 hash for `semantic_blake3` instead of a random UUID.

#### Scenario: BLAKE3 hash on embed
- **WHEN** calling `embedUseCase.execute({ source: "files", directory: "./src" })`
- **THEN** each chunk's `semantic_blake3` SHALL be a BLAKE3 hash of its `core_content`, not a random UUID
