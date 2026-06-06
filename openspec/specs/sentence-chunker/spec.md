## ADDED Requirements

### Requirement: Split text by sentence boundaries
The system SHALL split text at sentence boundaries (`.!?`) without splitting individual sentences.

#### Scenario: Sentences under max_tokens
- **WHEN** chunking text with multiple sentences ≤ max_tokens each
- **THEN** it SHALL split at `.`, `!`, `?` boundaries

#### Scenario: Abbreviation protection
- **WHEN** encountering abbreviations like `Mr.`, `Dr.`, `e.g.`
- **THEN** the chunker SHALL NOT split after these periods

#### Scenario: Overlong sentence delegates
- **WHEN** a single sentence > max_tokens
- **THEN** it SHALL delegate to OverflowChunker
