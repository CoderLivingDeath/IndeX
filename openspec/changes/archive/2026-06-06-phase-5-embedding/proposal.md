## Why

Embedding converts text chunks into vector representations for semantic search. Without embeddings, IndeX can only do keyword search (BM25). This phase builds a multi-model embedding system where each `source_type` can have dedicated models, a universal model handles cross-type queries, and graceful degradation keeps the system running when models fail.

## What Changes

- Create `tests/mocks/MockEmbedder.ts` and `tests/mocks/MockEmbedderRegistry.ts` for downstream tests
- Create `src/infrastructure/embedding/EmbedderCacheLRU.ts` — per-model LRU cache keyed by `${model}:${blake3}`
- Create `tests/infrastructure/embedding/EmbedderCacheLRU.test.ts` before implementation (RED → GREEN)
- Create `src/infrastructure/embedding/OllamaEmbedder.ts` — HTTP client to Ollama `/api/embeddings` with batch support and exponential backoff
- Create `tests/infrastructure/embedding/OllamaEmbedder.test.ts` before implementation
- Create `src/infrastructure/embedding/LanceDbEmbedder.ts` — fallback zero-vector embedder for keyword-only mode
- Create `tests/infrastructure/embedding/LanceDbEmbedder.test.ts` before implementation
- Create `src/infrastructure/embedding/CachedEmbedder.ts` — proxy decorator checking per-model cache before calling inner embedder
- Create `tests/infrastructure/embedding/CachedEmbedder.test.ts` before implementation
- Create `src/infrastructure/embedding/MultiModelEmbedder.ts` — parallel multi-model embedder with `allSettled` resilience
- Create `tests/infrastructure/embedding/MultiModelEmbedder.test.ts` before implementation
- Create `src/infrastructure/embedding/NullEmbedder.ts` — always-throws embedder for clean error handling
- Create `tests/infrastructure/embedding/NullEmbedder.test.ts` before implementation
- Create `src/infrastructure/embedding/EmbedderRegistryImpl.ts` — registry building from config with per-source-type routing
- Create `tests/infrastructure/embedding/EmbedderRegistry.test.ts` before implementation

## Capabilities

### New Capabilities
- `embedder-cache-lru`: In-memory LRU cache per embedding model keyed by `model:blake3_hash`
- `ollama-embedder`: HTTP client to Ollama's `/api/embeddings` endpoint with batch API (one HTTP call per batch), exponential backoff (1s→2s→4s), and AbortSignal support
- `lancedb-embedder`: Zero-vector fallback embedder enabling ANN search without Ollama (keyword-only graceful degradation)
- `cached-embedder`: Proxy/decorator that checks per-model cache before calling the real embedder
- `multi-model-embedder`: Parallel invocation of multiple embedders with `allSettled` — partial failures tolerated
- `null-embedder`: Always-throws embedder removing the need for null checks in calling code
- `embedder-registry`: Config-driven registry routing source types to the correct models by priority, with universal model support

### Modified Capabilities
- None

## Impact

- Adds 7 implementation files in `src/infrastructure/embedding/`
- Adds 7 test files in `tests/infrastructure/embedding/`
- Adds 2 mock files in `tests/mocks/`
- Runtime dependency: Ollama server running with `nomic-embed-text` model (for production use)
- Depends on Phase 1 (Embedder, EmbedderCache, EmbedderRegistry interfaces) and Phase 2 (BLAKE3 hasher for cache keys)
- Unlocks Phase 6 (RAG context needs embeddings), Phase 7 (LanceDB stores vectors), Phase 8 (IndexingService)
