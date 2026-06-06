## ADDED Requirements

### Requirement: Two-phase parser routing
The system SHALL route files to parsers by extension, with content sniffing for `.md` files.

#### Scenario: getParser(".ts") returns AstGrepParser
- **WHEN** calling `registry.getParser("file.ts")`
- **THEN** it SHALL return the AstGrepParser

#### Scenario: getParser(".md") detects Obsidian vs Markdown
- **WHEN** calling `registry.getParser("note.md")` with Obsidian frontmatter
- **THEN** it SHALL return ObsidianParser

#### Scenario: getParser(".md") returns MarkdownParser for plain markdown
- **WHEN** calling `registry.getParser("note.md")` without Obsidian frontmatter
- **THEN** it SHALL return MarkdownParser

#### Scenario: getParser(".py") returns null
- **WHEN** calling `registry.getParser("file.py")`
- **THEN** it SHALL return `null` if Python parser is not registered

#### Scenario: getEnabledParsers returns active parsers
- **WHEN** calling `registry.getEnabledParsers()`
- **THEN** it SHALL return only parsers whose `enabled` flag is true
