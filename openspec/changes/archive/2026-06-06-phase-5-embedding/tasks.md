## 1. Mocks

- [x] 1.1 **GREEN**: Create `tests/mocks/MockEmbedder.ts` — implements `Embedder` with configurable name/dimensions/return values
- [x] 1.2 **GREEN**: Create `tests/mocks/MockEmbedderRegistry.ts` — implements `EmbedderRegistry` with pre-configured embedders

## 2. EmbedderCacheLRU

- [x] 2.1 **RED**: Write `tests/infrastructure/embedding/EmbedderCacheLRU.test.ts` — get/set/has work, key = `${model}:${hash}`, LRU eviction on overflow, size tracking
- [x] 2.2 **GREEN**: Create `src/infrastructure/embedding/EmbedderCacheLRU.ts` — implement `EmbedderCache` with Map + configurable max size
- [x] 2.3 **TEST**: Run `bun test tests/infrastructure/embedding/EmbedderCacheLRU.test.ts` — all tests pass

## 3. OllamaEmbedder

- [x] 3.1 **RED**: Write `tests/infrastructure/embedding/OllamaEmbedder.test.ts` — embed returns Float32Array(384), embedBatch sends single HTTP POST, exponential backoff 1s→2s→4s, AbortSignal cancels request, name/dimensions/sourceTypes correct
- [x] 3.2 **GREEN**: Create `src/infrastructure/embedding/OllamaEmbedder.ts` — HTTP client to Ollama `/api/embeddings`, batch support, retry with backoff, AbortSignal
- [x] 3.3 **TEST**: Run `bun test tests/infrastructure/embedding/OllamaEmbedder.test.ts` — all tests pass

## 4. LanceDbEmbedder

- [x] 4.1 **RED**: Write `tests/infrastructure/embedding/LanceDbEmbedder.test.ts` — returns zero vector of configured dimension, name/dimensions correct
- [x] 4.2 **GREEN**: Create `src/infrastructure/embedding/LanceDbEmbedder.ts` — zero-vector fallback, implements `Embedder`
- [x] 4.3 **TEST**: Run `bun test tests/infrastructure/embedding/LanceDbEmbedder.test.ts` — all tests pass

## 5. CachedEmbedder

- [x] 5.1 **RED**: Write `tests/infrastructure/embedding/CachedEmbedder.test.ts` — cache hit skips inner call, cache miss calls inner and caches, key = model.name + BLAKE3(text)
- [x] 5.2 **GREEN**: Create `src/infrastructure/embedding/CachedEmbedder.ts` — proxy decorator, implements `Embedder`, uses hasher for cache key
- [x] 5.3 **TEST**: Run `bun test tests/infrastructure/embedding/CachedEmbedder.test.ts` — all tests pass

## 6. MultiModelEmbedder

- [x] 6.1 **RED**: Write `tests/infrastructure/embedding/MultiModelEmbedder.test.ts` — calls all embedders in parallel, returns Record<modelName, Embedding>, one failure → others still return (allSettled)
- [x] 6.2 **GREEN**: Create `src/infrastructure/embedding/MultiModelEmbedder.ts` — `Promise.allSettled` on all embedders, partial results
- [x] 6.3 **TEST**: Run `bun test tests/infrastructure/embedding/MultiModelEmbedder.test.ts` — all tests pass

## 7. NullEmbedder

- [x] 7.1 **RED**: Write `tests/infrastructure/embedding/NullEmbedder.test.ts` — always throws "no embedder available"
- [x] 7.2 **GREEN**: Create `src/infrastructure/embedding/NullEmbedder.ts` — implements `Embedder`, throws on any call
- [x] 7.3 **TEST**: Run `bun test tests/infrastructure/embedding/NullEmbedder.test.ts` — all tests pass

## 8. EmbedderRegistryImpl

- [x] 8.1 **RED**: Write `tests/infrastructure/embedding/EmbedderRegistry.test.ts` — getEmbedder by source_type (min priority), getEmbedders returns all, getUniversalEmbedder, isAvailable false with no models, modelNames list
- [x] 8.2 **GREEN**: Create `src/infrastructure/embedding/EmbedderRegistryImpl.ts` — builds Map<sourceType, Embedder[]> from config, implements `EmbedderRegistry`
- [x] 8.3 **TEST**: Run `bun test tests/infrastructure/embedding/` — all embedding tests pass
