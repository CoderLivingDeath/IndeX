## ADDED Requirements

### Requirement: Structured pack output with dual format
The system SHALL produce structured output in JSONL (default) or Markdown format, with file index, per-file metadata, AST JSONL sections, and controllable section flags.

#### Scenario: File index table of contents (Markdown)
- **WHEN** packing multiple files with `format: "md"`
- **THEN** the output SHALL start with a file index section listing each file with its path, language, line count, and token count

#### Scenario: Per-file metadata block
- **WHEN** packing a file with `meta` section enabled
- **THEN** the file section SHALL include metadata fields: type, language, lines, tokens, tags, path, blake3, last_parsed

#### Scenario: AST JSONL subsection
- **WHEN** packing a code file with AST data and `ast` section enabled
- **THEN** the file section SHALL include an `### ast` subsection with one JSON object per line for each AST node (import, export, symbol, complexity)

#### Scenario: Links subsection (separate from AST)
- **WHEN** packing a file with relationships and `links` section enabled
- **THEN** the file section SHALL include a `### links` subsection with one JSON object per line for each relationship, separate from the AST section

#### Scenario: Code/content block
- **WHEN** packing a file with `content` section enabled
- **THEN** the output SHALL end with a fenced `<pre><code>` block containing the full file content, with language highlighting

#### Scenario: No AST for non-code files
- **WHEN** packing a markdown or generic file without AST data
- **THEN** the `### ast` subsection SHALL be omitted, and content SHALL be under `### content`

### Requirement: Positive-only section flags
Section flags are positive-only. No `--no-*` flags exist.

#### Scenario: No flags — default sections
- **WHEN** calling `packUseCase.execute("./vault")` without any section flags
- **THEN** the output SHALL include meta, ast, and content sections per file

#### Scenario: Any explicit flag overrides defaults
- **WHEN** calling `packUseCase.execute("./vault", { content: true })`
- **THEN** the output SHALL include ONLY the content section

#### Scenario: Links default is off
- **WHEN** calling `packUseCase.execute("./vault")` without explicit flags
- **THEN** the links section SHALL NOT be included

### Requirement: JSONL output format
The system SHALL support outputting one JSON object per file per line (JSONL).

#### Scenario: JSONL default format
- **WHEN** calling `packUseCase.execute("./vault")` without format flag
- **THEN** the output SHALL be in JSONL format (one JSON line per file)

#### Scenario: JSONL object fields
- **WHEN** packing a file in JSONL format
- **THEN** each JSON object SHALL include `path`, `type`, `language`, `lines`, `tokens` always, plus optional fields based on section flags

### Requirement: stdout always, -o optional file write
The pack output SHALL always be written to stdout. The `-o` flag additionally writes to a file.

#### Scenario: Output to terminal
- **WHEN** running `indeX pack .`
- **THEN** the output SHALL be displayed in the terminal

#### Scenario: Optional file write
- **WHEN** running `indeX pack . -o bundle.md`
- **THEN** the output SHALL additionally be written to `bundle.md`
