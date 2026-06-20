## MODIFIED Requirements

### Requirement: Search with AST filter mode
The system SHALL support an AST filter mode that searches the `ast_text` FTS index.

#### Scenario: Execute ast search
- **WHEN** calling `searchUseCase.execute("import:zod", { mode: "ast" })`
- **THEN** it SHALL return `SearchResult[]` from the `ast_text` FTS index with match scores
