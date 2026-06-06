## ADDED Requirements

### Requirement: Chunker splits text into chunks
The system SHALL define a `Chunker` interface for text splitting.

#### Scenario: Chunker returns typed chunks
- **WHEN** calling `chunker.chunk(text)`
- **THEN** it SHALL return `Chunk[]` with `content`, `core_content`, `chunk_index`, `total_chunks`, `strategy`, `size_tokens`

### Requirement: Embedder generates vectors
The system SHALL define an `Embedder` interface for text vectorization.

#### Scenario: Embedder returns typed embeddings
- **WHEN** calling `embedder.embed(text)`
- **THEN** it SHALL return `Embedding` with `vector`, `model`, `dimensions`, `tokens_in`

### Requirement: EmbedderRegistry resolves models
The system SHALL define an `EmbedderRegistry` for model selection by source type.

#### Scenario: Registry returns correct embedder
- **WHEN** calling `registry.getEmbedder("typescript")`
- **THEN** it SHALL return the embedder with the highest priority (lowest priority number) for that source type

### Requirement: Hasher produces content hashes
The system SHALL define a `Hasher` interface for content hashing.

#### Scenario: Hasher returns hex string
- **WHEN** calling `hasher.hash(data)`
- **THEN** it SHALL return a 64-character hex string

### Requirement: ContextPacker formats search results
The system SHALL define a `ContextPacker` interface for RAG context formatting.

#### Scenario: ContextPacker returns PackedContext
- **WHEN** calling `packer.pack(results)`
- **THEN** it SHALL return `PackedContext` with `markdown`, `chunks_used`, `total_tokens`, `truncated`, `source_notes`
