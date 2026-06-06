## ADDED Requirements

### Requirement: Obsidian note parsing
The system SHALL parse Obsidian notes with YAML frontmatter and wiki-links.

#### Scenario: Parse obsidian-note.md
- **WHEN** parsing an Obsidian note with frontmatter
- **THEN** title SHALL come from frontmatter `title`, tags from frontmatter `tags`, and `ObsidianMetadata` SHALL contain `wikiLinks`

#### Scenario: Wiki-links extracted
- **WHEN** parsing a note with `[[target]]` and `[[target|alias]]`
- **THEN** `metadata.wikiLinks` SHALL contain entries with `target` and optional `alias`

#### Scenario: Content without frontmatter
- **WHEN** parsing an Obsidian note
- **THEN** `content` SHALL exclude the YAML frontmatter block

#### Scenario: Backlinks and graphConnections are empty
- **WHEN** parsing a single Obsidian note
- **THEN** `backlinks` and `graphConnections` SHALL be empty arrays (filled separately by DiffIndexingService)
