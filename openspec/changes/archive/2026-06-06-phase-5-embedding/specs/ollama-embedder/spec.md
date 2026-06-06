## ADDED Requirements

### Requirement: Embed text via Ollama API
The system SHALL generate embeddings by calling Ollama's `/api/embeddings`.

#### Scenario: embed returns Float32Array
- **WHEN** calling `embed("hello")`
- **THEN** it SHALL return an `Embedding` with `vector: Float32Array` of configured `dimensions`

#### Scenario: embedBatch sends one HTTP request
- **WHEN** calling `embedBatch(["a", "b", "c"])`
- **THEN** it SHALL send a single HTTP POST to `/api/embeddings` with an array of strings

#### Scenario: Exponential backoff on failure
- **WHEN** the Ollama API returns an error
- **THEN** retry with backoff: 1s → 2s → 4s (max 3 attempts)

#### Scenario: AbortSignal cancels request
- **WHEN** an `AbortSignal` is triggered
- **THEN** the in-flight request SHALL be cancelled
