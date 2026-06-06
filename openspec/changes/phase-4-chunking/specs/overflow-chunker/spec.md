## ADDED Requirements

### Requirement: Forced token-boundary split
The system SHALL split text at exact token boundaries as a last resort.

#### Scenario: Forced split
- **WHEN** content exceeds max_tokens and no other strategy works
- **THEN** it SHALL split at the token boundary closest to max_tokens

#### Scenario: Minimum tokens
- **WHEN** creating overflow chunks
- **THEN** each chunk SHALL have at least `min_tokens` tokens
