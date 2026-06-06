## ADDED Requirements

### Requirement: O(n) dedup by semantic_blake3
The system SHALL deduplicate search results by `semantic_blake3` hash, keeping the entry with maximum score.

#### Scenario: Duplicates removed
- **WHEN** deduplicating results with the same `semantic_blake3`
- **THEN** only the result with the highest `score` SHALL be kept

#### Scenario: O(n) via Map
- **WHEN** deduplicating N results
- **THEN** the operation SHALL complete in O(n) time using a `Map<hash, SearchResult>`
