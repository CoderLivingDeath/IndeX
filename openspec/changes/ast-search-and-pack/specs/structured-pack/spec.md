## ADDED Requirements

### Requirement: Structured markdown output with metadata
The system SHALL produce structured markdown output with file index, per-file metadata, and AST JSONL sections.

#### Scenario: File index table of contents
- **WHEN** packing multiple files
- **THEN** the output SHALL start with a file index section listing each file with its path, language, line count, and token count

#### Scenario: Per-file metadata block
- **WHEN** packing a file
- **THEN** the file section SHALL include metadata fields: type, language, lines, tokens, tags, path, blake3, last_parsed

#### Scenario: AST JSONL section
- **WHEN** packing a code file with AST data
- **THEN** the file section SHALL include an `### ast` subsection with one JSON object per line for each AST node (import, export, symbol, relationship, complexity)

#### Scenario: Code block with content
- **WHEN** packing a file
- **THEN** the file section SHALL end with a fenced code block containing the full file content, with language-specific syntax highlighting

#### Scenario: No AST for non-code files
- **WHEN** packing a markdown or generic file without AST data
- **THEN** the `### ast` subsection SHALL be omitted, and content SHALL be under `### content`
