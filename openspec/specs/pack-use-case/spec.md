## ADDED Requirements

### Requirement: Pack with dual output formats
The system SHALL package files into structured output in either JSONL (default) or Markdown format, with include/exclude filters and controllable sections.

#### Scenario: Execute pack in JSONL format (default)
- **WHEN** calling `packUseCase.execute("./vault")`
- **THEN** the output SHALL be one JSON object per file per line (JSONL format)

#### Scenario: Execute pack in Markdown format
- **WHEN** calling `packUseCase.execute("./vault", { format: "md" })`
- **THEN** the output SHALL be a Markdown document with file index TOC and per-file sections

#### Scenario: JSONL file object structure
- **WHEN** packing a file in JSONL format
- **THEN** each JSON object SHALL include `path`, `type`, `language`, `lines`, `tokens` always, plus optional `blake3`, `last_parsed`, `tags`, `imports`, `exports`, `symbols`, `complexity`, `relationships`, `content` based on section flags

#### Scenario: Markdown file index table of contents
- **WHEN** packing multiple files in Markdown format
- **THEN** the output SHALL start with a file index table listing each file with path, language, line count, and token count

### Requirement: Positive-only section flags

#### Scenario: No flags — default sections
- **WHEN** calling `packUseCase.execute("./vault")` without any section flags
- **THEN** the output SHALL include `meta`, `ast`, and `content` sections per file

#### Scenario: Any explicit flag overrides defaults
- **WHEN** calling `packUseCase.execute("./vault", { content: true })`
- **THEN** the output SHALL include ONLY the content section (no meta, no ast, no links)

#### Scenario: Links section
- **WHEN** calling `packUseCase.execute("./vault", { links: true })`
- **THEN** the output SHALL include a separate links/relationships section per file, distinct from the AST section

#### Scenario: Links default is off
- **WHEN** calling `packUseCase.execute("./vault")` without explicit flags
- **THEN** the links section SHALL NOT be included (only meta, ast, content)

### Requirement: Output always to stdout

#### Scenario: Output displayed in terminal
- **WHEN** calling `packUseCase.execute("./vault")`
- **THEN** the output SHALL be written to stdout (console.log)

#### Scenario: Optional file output
- **WHEN** calling `packUseCase.execute("./vault")` with `-o <file>` flag
- **THEN** the output SHALL be additionally written to the specified file

### Requirement: Markdown section format

#### Scenario: Per-file metadata block
- **WHEN** packing a file with `meta` section enabled
- **THEN** the file section SHALL include `type`, `language`, `lines`, `tokens`, `tags`, `path`, `blake3`, `last_parsed` as key-value lines

#### Scenario: AST JSONL subsection
- **WHEN** packing a code file with AST data and `ast` section enabled
- **THEN** the file section SHALL include a `### ast` subsection with one JSON object per line for each AST node (imports, exports, symbols, complexity)

#### Scenario: Code/content subsection
- **WHEN** packing a file with `content` section enabled
- **THEN** the output SHALL include a `### code` or `### content` subsection with a fenced `<pre><code>` block

#### Scenario: Links subsection
- **WHEN** packing a file with relationships and `links` section enabled
- **THEN** the output SHALL include a `### links` subsection with one JSON object per line for each relationship

#### Scenario: No AST for non-code files
- **WHEN** packing a markdown or generic file without AST data
- **THEN** the AST subsection SHALL be omitted, and content SHALL be under `### content`