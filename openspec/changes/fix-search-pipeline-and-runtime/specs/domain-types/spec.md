## ADDED Requirements

### Requirement: Search query carries a vector
The system SHALL represent the query embedding as a first-class field on `SearchQuery` rather than inside the untyped `filters` bag.

#### Scenario: Vector is optional
- **WHEN** constructing a `SearchQuery` for keyword or AST mode
- **THEN** `vector` SHALL be optional and MAY be omitted

#### Scenario: Vector is a numeric array
- **WHEN** constructing a `SearchQuery` for semantic or hybrid mode
- **THEN** `vector` SHALL be a `number[]` matching the configured embedding dimensions

#### Scenario: Legacy filters remain available
- **WHEN** constructing a `SearchQuery` with non-vector filters
- **THEN** `filters` SHALL remain available for adapter-specific criteria, but SHALL NOT be used to transport the query vector

#### Scenario: Score contract
- **WHEN** reading a `SearchResult`
- **THEN** `score` SHALL be a relevance value in `[0, 1]` where higher is better across all modes
