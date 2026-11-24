## MODIFIED Requirements

### Requirement: Search with multiple modes
The system SHALL search the index with configurable mode, filters, and custom columns.

#### Scenario: Hybrid search (default)
- **WHEN** calling `searchUseCase.execute("query", { mode: "hybrid" })`
- **THEN** it SHALL embed the query exactly once and return `SearchResult[]` ranked by vector + keyword scores using `search.hybrid_weight`

#### Scenario: Semantic search
- **WHEN** calling `searchUseCase.execute("query", { mode: "semantic" })`
- **THEN** it SHALL pass the query vector to the repository and return `SearchResult[]` ranked by cosine similarity only

#### Scenario: Keyword search
- **WHEN** calling `searchUseCase.execute("query", { mode: "keyword" })`
- **THEN** it SHALL return `SearchResult[]` ranked by keyword relevance (FTS) only

#### Scenario: AST search
- **WHEN** calling `searchUseCase.execute("import:zod", { mode: "ast" })`
- **THEN** it SHALL return `SearchResult[]` from the `ast_text` FTS index with match scores

#### Scenario: CLI --ast shortcut
- **WHEN** running `indeX search "query" --ast`
- **THEN** it SHALL pass `mode: "ast"` internally, equivalent to `--mode ast`

#### Scenario: Filters are forwarded
- **WHEN** `execute()` is called with `tags`, `source_types`, or `min_score`
- **THEN** all non-undefined filters SHALL be forwarded to the ranking engine unchanged

#### Scenario: Empty query
- **WHEN** `execute()` receives an empty or whitespace-only query
- **THEN** it SHALL return an empty array without calling the repository

## ADDED Requirements

### Requirement: SearchUseCase delegates ranking
The search use case SHALL delegate ranking to a single ranking engine instead of calling the repository directly.

#### Scenario: Delegation to SearchService
- **WHEN** `searchUseCase.execute()` is called
- **THEN** it SHALL invoke `SearchService.execute(query, vector)` with the embedded query vector

#### Scenario: No duplicate vector work
- **WHEN** executing a semantic or hybrid query
- **THEN** the query SHALL be embedded exactly once per call

#### Scenario: Repository is not called directly by the use case
- **WHEN** the use case completes a search
- **THEN** all repository search calls SHALL originate from the ranking engine
