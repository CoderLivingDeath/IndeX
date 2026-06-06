## ADDED Requirements

### Requirement: End-to-end context packing pipeline
The system SHALL transform search results into LLM-ready Markdown context.

#### Scenario: Full pack pipeline
- **WHEN** calling `packer.pack(results)`
- **THEN** it SHALL deduplicate → sort by score desc → greedy-fit by max_tokens → format as Markdown

#### Scenario: Truncated flag
- **WHEN** results exceed max_tokens
- **THEN** `truncated` SHALL be `true` and some results SHALL be excluded

#### Scenario: Source notes
- **WHEN** packing results from multiple files
- **THEN** `source_notes` SHALL contain unique file paths from included chunks

#### Scenario: RAG format
- **WHEN** using `format: 'rag'`
- **THEN** the output SHALL include a system prompt instruction before the context
