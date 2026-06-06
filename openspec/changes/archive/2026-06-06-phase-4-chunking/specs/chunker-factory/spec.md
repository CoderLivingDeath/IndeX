## ADDED Requirements

### Requirement: Pipeline with fallback chain
The system SHALL build a chunker pipeline with configurable fallback strategies, merge, and overlap.

#### Scenario: Pipeline creation
- **WHEN** calling `createPipeline(['heading', 'paragraph', 'sentence', 'overflow'])`
- **THEN** it SHALL create a pipeline with fallback chain in that order

#### Scenario: Small chunk merge
- **WHEN** consecutive chunks are < 50 tokens
- **THEN** they SHALL be merged with the previous chunk

#### Scenario: Overlap between chunks
- **WHEN** creating chunks with overlap
- **THEN** the last `overlap_tokens` SHALL repeat at the start of the next chunk
- **THEN** overlap text SHALL NOT be in `core_content`
