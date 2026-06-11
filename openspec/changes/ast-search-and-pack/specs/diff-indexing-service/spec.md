## ADDED Requirements

### Requirement: AST summary appended before embedding
The diff indexing service SHALL append an AST summary to `core_content` before embedding, matching the indexing service behavior.

#### Scenario: AST summary included in embedding input
- **WHEN** diff-indexing a changed code file with AST data
- **THEN** `core_content` SHALL include an `--- AST ---` section before embedding

#### Scenario: No AST for non-code
- **WHEN** diff-indexing a markdown or generic file
- **THEN** no AST summary SHALL be appended
