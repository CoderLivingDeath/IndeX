## ADDED Requirements

### Requirement: Split text by blank lines
The system SHALL split text by paragraph boundaries (blank lines).

#### Scenario: Paragraph under max_tokens
- **WHEN** chunking a paragraph ≤ max_tokens
- **THEN** it SHALL return one chunk with that paragraph

#### Scenario: Paragraph over max_tokens delegates
- **WHEN** chunking a paragraph > max_tokens
- **THEN** it SHALL delegate to SentenceChunker recursively
