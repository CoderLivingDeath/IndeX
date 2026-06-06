## Why

Hashing is the foundation of both file-level diff detection and semantic deduplication. Every file needs a `file_blake3` to detect changes during watcher-driven diff indexing, and every chunk needs a `semantic_blake3` to detect duplicate content across files. Without this phase, the IndexingService cannot skip unchanged files and the ContextPacker cannot deduplicate.

## What Changes

- Create `src/infrastructure/hashing/BLAKE3Hasher.ts` — BLAKE3 hasher using `hash-wasm` with streaming file hash via `Bun.file()`
- Create `tests/infrastructure/hashing/BLAKE3Hasher.test.ts` before implementation (RED → GREEN)
- Create `src/infrastructure/hashing/TokenEstimatorSimple.ts` — byte-based approximation (bytes/4)
- Create `tests/infrastructure/hashing/TokenEstimatorSimple.test.ts` before implementation
- Create `src/infrastructure/hashing/TokenEstimatorTiktoken.ts` — tiktoken-based accurate token counting with fallback
- Create `tests/infrastructure/hashing/TokenEstimatorTiktoken.test.ts` before implementation
- Create `tests/mocks/MockHasher.ts` for downstream test use

## Capabilities

### New Capabilities
- `blake3-hasher`: BLAKE3 cryptographic hashing for files and strings via `hash-wasm`, implementing `Hasher` interface
- `token-estimator`: Token counting with two strategies — simple byte-based (fast) and tiktoken (accurate), implementing `TokenEstimator` interface
- `mock-hasher`: SHA256-based `MockHasher` for unit tests in downstream phases

### Modified Capabilities
- None

## Impact

- Adds 4 implementation files in `src/infrastructure/hashing/`
- Adds 3 test files in `tests/infrastructure/hashing/`
- Adds 1 mock file in `tests/mocks/`
- Depends on: `hash-wasm` (BLAKE3), `gpt-tokenizer` or `tiktoken` (optional)
- Unlocks: Phase 3 (parsing needs BLAKE3), Phase 5 (embedding needs BLAKE3 for cache keys), Phase 6 (context dedup)
