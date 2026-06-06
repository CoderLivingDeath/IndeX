## ADDED Requirements

### Requirement: Split Markdown by headings
The system SHALL split Markdown content by H1/H2+ headings, returning whole sections as chunks.

#### Scenario: Section under max_tokens
- **WHEN** chunking a Markdown section ≤ max_tokens
- **THEN** it SHALL return one chunk with that section's content

#### Scenario: Section over max_tokens falls through
- **WHEN** chunking a Markdown section > max_tokens
- **THEN** the chunker SHALL return no chunks (pipeline falls to next chunker)

#### Scenario: core_content is body without overlap
- **WHEN** a heading chunk is created
- **THEN** `core_content` SHALL be the section body without overlap text
