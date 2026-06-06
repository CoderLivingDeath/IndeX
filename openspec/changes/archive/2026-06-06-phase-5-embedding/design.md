## Context

Embeddings are the core of semantic search. The system must support multiple embedding models (e.g., `nomic-embed-text` for general content, `mxbai-embed-large` for code), cache results to avoid redundant API calls, and degrade gracefully when models are unavailable.

## Goals / Non-Goals

**Goals:**
- `OllamaEmbedder`: HTTP client to Ollama's `/api/embeddings` — one HTTP request per batch of texts, exponential backoff (1s→2s→4s), AbortSignal for graceful shutdown
- `EmbedderCacheLRU`: In-memory LRU cache per model, keyed by `${model}:${blake3}`, configurable max size
- `CachedEmbedder`: Proxy decorator — checks cache before calling inner embedder, uses `hasher` for cache keys
- `MultiModelEmbedder`: Parallel invocation of multiple embedders with `allSettled` — partial failures tolerated
- `LanceDbEmbedder`: Returns zero-vector (all zeros) of configured dimension — enables ANN search without Ollama
- `NullEmbedder`: Always throws "no embedder available" — removes need for null checks
- `EmbedderRegistryImpl`: Builds model map from `ModelConfig[]`, routes source types to correct models by priority

**Non-Goals:**
- No async background batching beyond `embedBatch`
- No persistent on-disk cache (LRU is in-memory only; LanceDB serves as persistent dedup store)

## Decisions

- **CachedEmbedder is a proxy decorator**: Wraps any `Embedder` and adds caching transparently. Embedders don't need to know about caching. Tested independently from embedder implementations.
- **Cache key = `model:blake3(text)`**: The same text gets different vectors from different models. Without the model prefix, a cache hit from `nomic-embed-text` would incorrectly serve a 384-dim vector when `mxbai-embed-large` expects 1024-dim.
- **MultiModelEmbedder is NOT an Embedder**: It returns `Record<string, Embedding>` instead of `Embedding`. This is intentional — `Promise.allSettled` means partial results are valid.
- **LanceDbEmbedder returns zero vectors**: This is a graceful degradation strategy. Zero vectors push ANN search toward keyword-only (L2 distance = magnitude squared). Combined with FTS (BM25), search still works without Ollama.
- **Exponential backoff 1s→2s→4s**: Standard retry pattern for transient errors. Ollama API is local (no network latency), so short retries are appropriate. Max 3 attempts to avoid hanging on a dead server.

## Risks / Trade-offs

- **in-memory cache doesn't survive restart**: Acceptable — the primary dedup store is LanceDB (`hasModelEmbedding`). The LRU cache is a hot cache for the current indexing session.
- **Ollama embedder requires running server**: Not all environments have Ollama. Mitigation: `LanceDbEmbedder` enables fallback; `isAvailable()` check lets callers detect and warn.
