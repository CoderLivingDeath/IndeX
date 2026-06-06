## ADDED Requirements

### Requirement: Markdown file parsing
The system SHALL parse Markdown files extracting headings, links, resources, and statistics.

#### Scenario: Parse simple-note.md
- **WHEN** parsing a simple Markdown file
- **THEN** it SHALL return `ParsedSource` with H1 as `title`, full text as `content`, and `MarkdownMetadata`

#### Scenario: Headings extracted
- **WHEN** parsing Markdown with headings
- **THEN** `metadata.headings` SHALL contain all H1/H2+ with `level`, `text`, and `anchor`

#### Scenario: Links extracted
- **WHEN** parsing Markdown with links
- **THEN** `metadata.links` SHALL contain `url`, `text`, `isInternal`, `isAnchor`

#### Scenario: Stats computed
- **WHEN** parsing a Markdown file
- **THEN** `metadata.stats` SHALL contain `wordCount`, `readingTimeMinutes`, `paragraphCount`, `codeBlockCount`
