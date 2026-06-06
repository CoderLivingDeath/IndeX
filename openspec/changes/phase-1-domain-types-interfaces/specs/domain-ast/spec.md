## ADDED Requirements

### Requirement: FileIndex stores per-file AST data
The system SHALL maintain a `FileIndex` per file containing its AST summary.

#### Scenario: FileIndex can be created
- **WHEN** creating a `FileIndex`
- **THEN** it SHALL contain `path`, `file_blake3`, `language`, `imports`, `exports`, `symbols`, `relationships`, `last_parsed`

### Requirement: SymbolDetail describes code symbols
The system SHALL describe each code symbol with its kind, name, and location.

#### Scenario: SymbolDetail has required fields
- **WHEN** creating a `SymbolDetail`
- **THEN** it SHALL have `kind` (from `SymbolKind`), `name`, `signature`, `startPosition`, `endPosition`
