## ADDED Requirements

### Requirement: Markdown heading extractor
The system SHALL extract headings from Markdown for chunking.

#### Scenario: Headings with level and anchor
- **WHEN** extracting headings from Markdown
- **THEN** each heading SHALL have `level`, `text`, and GitHub-style `anchor`