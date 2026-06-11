## MODIFIED Requirements

### Requirement: Structured pack output
The system SHALL package files into a structured Markdown document with file index, metadata fields, and AST JSONL sections.

#### Scenario: Execute pack with structured output
- **WHEN** calling `packUseCase.execute("./vault", { include: ["**/*.ts"] })`
- **THEN** it SHALL produce structured output with file index, per-file metadata (`type`, `language`, `lines`, `tokens`, `tags`, `path`, `blake3`, `last_parsed`), AST JSONL section, and fenced code block per file
