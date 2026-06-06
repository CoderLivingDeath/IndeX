## 1. Mocks

- [ ] 1.1 **GREEN**: Create `tests/mocks/MockEmbedder.ts` — implements `Embedder` with configurable name/dimensions/return values
- [ ] 1.2 **GREEN**: Create `tests/mocks/MockEmbedderRegistry.ts` — implements `EmbedderRegistry` with pre-configured embedders

## 2. EmbedderCacheLRU

- [ ] 2.1 **RED**: Write `tests/infrastructure/embedding/EmbedderCacheLRU.test.ts` — get/set/has work, key = `${model}:${hash}`, LRU eviction on overflow, size tracking
- [ ] 2.2 **GREEN**: Create `src/infrastructure/embedding/EmbedderCacheLRU.ts` — implement `EmbedderCache` with Map + configurable max size
- [ ] 2.3 **TEST**: Run `bun test tests/infrastructure/embedding/EmbedderCacheLRU.test.ts` — all tests pass

## 3. OllamaEmbedder

- [ ] 3.1 **RED**: Write `tests/infrastructure/embedding/OllamaEmbedder.test.ts` — embed returns Float32Array(384), embedBatch sends single HTTP POST, exponential backoff 1s→2s→4s, AbortSignal cancels request, name/dimensions/sourceTypes correct
- [ ] 3.2 **GREEN**: Create `src/infrastructure/embedding/OllamaEmbedder.ts` — HTTP client to Ollama `/api/embeddings`, batch support, retry with backoff, AbortSignal
- [ ] 3.3 **TEST**: Run `bun test tests/infrastructure/embedding/OllamaEmbedder.test.ts` — all tests pass

## 4. LanceDbEmbedder

- [ ] 4.1 **RED**: Write `tests/infrastructure/embedding/LanceDbEmbedder.test.ts` — returns zero vector of configured dimension, name/dimensions correct
- [ ] 4.2 **GREEN**: Create `src/infrastructure/embedding/LanceDbEmbedder.ts` — zero-vector fallback, implements `Embedder`
- [ ] 4.3 **TEST**: Run `bun test tests/infrastructure/embedding/LanceDbEmbedder.test.ts` — all tests pass

## 5. CachedEmbedder

- [ ] 5.1 **RED**: Write `tests/infrastructure/embedding/CachedEmbedder.test.ts` — cache hit skips inner call, cache miss calls inner and caches, key = model.name + BLAKE3(text)
- [ ] 5.2 **GREEN**: Create `src/infrastructure/embedding/CachedEmbedder.ts` — proxy decorator, implements `Embedder`, uses hasher for cache key
- [ ] 5.3 **TEST**: Run `bun test tests/infrastructure/embedding/CachedEmbedder.test.ts` — all tests pass

## 6. MultiModelEmbedder

- [ ] 6.1 **RED**: Write `tests/infrastructure/embedding/MultiModelEmbedder.test.ts` — calls all embedders in parallel, returns Record<modelName, Embedding>, one failure → others still return (allSettled)
- [ ] 6.2 **GREEN**: Create `src/infrastructure/embedding/MultiModelEmbedder.ts` — `Promise.allSettled` on all embedders, partial results
- [ ] 6.3 **TEST**: Run `bun test tests/infrastructure/embedding/MultiModelEmbedder.test.ts` — all tests pass

## 7. NullEmbedder

- [ ] 7.1 **RED**: Write `tests/infrastructure/embedding/NullEmbedder.test.ts` — always throws "no embedder available"
- [ ] 7.2 **GREEN**: Create `src/infrastructure/embedding/NullEmbedder.ts` — implements `Embedder`, throws on any call
- [ ] 7.3 **TEST**: Run `bun test tests/infrastructure/embedding/NullEmbedder.test.ts` — all tests pass

## 8. EmbedderRegistryImpl

- [ ] 8.1 **RED**: Write `tests/infrastructure/embedding/EmbedderRegistry.test.ts` — getEmbedder by source_type (min priority), getEmbedders returns all, getUniversalEmbedder, isAvailable false with no models, modelNames list
- [ ] 8.2 **GREEN**: Create `src/infrastructure/embedding/EmbedderRegistryImpl.ts` — builds Map<sourceType, Embedder[]> from config, implements `EmbedderRegistry`
- [ ] 8.3 **TEST**: Run `bun test tests/infrastructure/embedding/` — all embedding tests pass
