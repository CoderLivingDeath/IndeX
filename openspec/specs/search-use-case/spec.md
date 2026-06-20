## ADDED Requirements

### Requirement: Search with multiple modes
The system SHALL search the index with configurable mode and custom columns.

#### Scenario: Hybrid search (default)
- **WHEN** calling `searchUseCase.execute("query", { mode: "hybrid" })`
- **THEN** it SHALL return `SearchResult[]` ranked by weighted vector + keyword scores

#### Scenario: Semantic search
- **WHEN** calling `searchUseCase.execute("query", { mode: "semantic" })`
- **THEN** it SHALL return `SearchResult[]` ranked by vector similarity only

#### Scenario: Keyword search
- **WHEN** calling `searchUseCase.execute("query", { mode: "keyword" })`
- **THEN** it SHALL return `SearchResult[]` ranked by keyword relevance (FTS) only

#### Scenario: AST search
- **WHEN** calling `searchUseCase.execute("import:zod", { mode: "ast" })`
- **THEN** it SHALL return `SearchResult[]` from the `ast_text` FTS index with match scores

#### Scenario: CLI --ast shortcut
- **WHEN** running `indeX search "query" --ast`
- **THEN** it SHALL pass `mode: "ast"` internally, equivalent to `--mode ast`

### Requirement: Custom output columns
The system SHALL support selecting which columns to display in search results.

#### Scenario: Specify columns
- **WHEN** running `indeX search "query" --columns path,score,content,ast`
- **THEN** only the requested columns SHALL be displayed

#### Scenario: Available columns
- **WHEN** listing available search columns
- **THEN** the following SHALL be available: `match_type`, `path`, `score`, `type`, `title`, `content`, `tags`, `chunk`, `blake3`, `ast`, `meta`, `timestamps`, `model_scores`, `embedding`