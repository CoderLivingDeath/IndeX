## MODIFIED Requirements

### Requirement: Structured pack output with sections and formats
The system SHALL package files into a structured JSONL or Markdown document with controllable sections (meta, ast, content, links) via positive-only flags.

#### Scenario: Default pack (no section flags) — meta+ast+content
- **WHEN** calling `packUseCase.execute("./vault")` without explicit section flags
- **THEN** it SHALL produce output with meta, ast, and content sections per file

#### Scenario: Explicit section flag overrides defaults
- **WHEN** calling `packUseCase.execute("./vault", { meta: true, links: true })`
- **THEN** it SHALL produce output with ONLY meta and links sections (ast and content excluded)

#### Scenario: Pack in JSONL format
- **WHEN** calling `packUseCase.execute("./vault", { format: "jsonl" })`
- **THEN** the output SHALL be one JSON object per file per line

#### Scenario: Pack in Markdown format
- **WHEN** calling `packUseCase.execute("./vault", { format: "md" })`
- **THEN** the output SHALL be a Markdown document with file index TOC, metadata, AST JSONL, links JSONL, and code/content sections

#### Scenario: Default format is JSONL
- **WHEN** calling `packUseCase.execute("./vault")`
- **THEN** the output SHALL be in JSONL format by default
