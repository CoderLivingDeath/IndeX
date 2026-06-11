## ADDED Requirements

### Requirement: Structural AST search via FTS
The system SHALL enable keyword search over AST data (imports, exports, symbols, relationships).

#### Scenario: Search by import
- **WHEN** searching with `--ast` flag for `import:zod`
- **THEN** files that import from `zod` SHALL be returned with match scores

#### Scenario: Search by symbol
- **WHEN** searching with `--ast` flag for `symbol:function:load`
- **THEN** files declaring a function named `load` SHALL be returned

#### Scenario: Search by export
- **WHEN** searching with `--ast` flag for `export:type:Config`
- **THEN** files exporting a type named `Config` SHALL be returned

### Requirement: Semantic AST search via content annotation
The system SHALL append an AST summary to `core_content` before embedding, enabling semantic search over code structure.

#### Scenario: AST summary prepended before embedding
- **WHEN** indexing a code file with AST data
- **THEN** the `core_content` passed to the embedder SHALL include an `--- AST ---` section with imports/exports/symbols summary

#### Scenario: No AST summary for non-code files
- **WHEN** indexing a markdown or generic file
- **THEN** no AST summary SHALL be appended to `core_content`

### Requirement: CLI `--ast` search flag
The CLI SHALL support `search --ast` that performs FTS on the `ast_text` column.

#### Scenario: CLI ast search
- **WHEN** running `indeX search "import:zod" --ast`
- **THEN** results SHALL come from the `ast_text` FTS index

### Requirement: `ast_text` column in file_index
The `file_index` table SHALL have an `ast_text` column with flat text projection of AST data.

#### Scenario: ast_text generated on upsert
- **WHEN** upserting a FileIndex with imports/exports/symbols
- **THEN** the `ast_text` column SHALL contain flat `kind:value` prefixed text

#### Scenario: FTS index on ast_text
- **WHEN** a file_index table is created or opened
- **THEN** an FTS index SHALL be created on the `ast_text` column
