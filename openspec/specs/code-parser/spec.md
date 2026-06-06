## ADDED Requirements

### Requirement: TypeScript code parsing via ast-grep
The system SHALL parse TypeScript source code extracting symbols, imports, and exports.

#### Scenario: Parse sample-function.ts
- **WHEN** parsing a TypeScript file
- **THEN** it SHALL return `ParsedSource` with `type: 'typescript'`, `CodeMetadata`, and optional `ast: FileIndex`

#### Scenario: Symbols extracted
- **WHEN** parsing a file with functions/classes/interfaces
- **THEN** `symbols` SHALL contain entries with `kind`, `name`, `signature`, and positions

#### Scenario: Imports and exports
- **WHEN** parsing a file with imports and exports
- **THEN** `ast.imports` and `ast.exports` SHALL be populated with correct `source` and `name`

#### Scenario: Complexity metrics
- **WHEN** parsing a TypeScript file
- **THEN** `metadata.complexity` SHALL contain `lines`, `functions`, `classes` counts
