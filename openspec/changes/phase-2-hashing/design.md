## Context

Hashing is required in two places: file-level diff detection (is this file changed?) and chunk-level deduplication (is this content already indexed?). BLAKE3 is chosen for speed (10× faster than SHA256) and streaming support. Token estimation is needed for chunk-size decisions and context-budget tracking.

## Goals / Non-Goals

**Goals:**
- `BLAKE3Hasher.hash(data)` returns a 32-byte hex string via `hash-wasm`
- `BLAKE3Hasher.hashFile(path)` streams file via `Bun.file()` for memory efficiency
- `TokenEstimatorSimple.estimate(text)` returns `Math.ceil(text.length / 4)` (byte-based approximation)
- `TokenEstimatorTiktoken.estimate(text)` uses `gpt-tokenizer` for accurate GPT token count, falls back to Simple if unavailable
- `MockHasher` uses Node.js `crypto` SHA256 for deterministic test hashing

**Non-Goals:**
- No parallel hashing (single-thread is sufficient for local use)
- No file-change streaming watcher (that's Phase 10)

## Decisions

- **hash-wasm for BLAKE3**: WebAssembly-based, works in Bun, simpler than native Node.js addons. Provides both hash and keyed-hash modes.
- **MockHasher uses SHA256**: Deterministic, no WASM dependency, consistent across environments. Fine for tests where BLAKE3 specifics don't matter.
- **TokenEstimatorTiktoken as optional**: `gpt-tokenizer` is a large dependency (~4MB). If `import` fails (not installed), silently fall back to Simple. This keeps the default install lightweight.
- **`Bun.file().text()` for hashFile**: Bun's native file API is faster than streaming chunks. For files > 100MB, this could be memory-heavy, but vaults are typically small notes.

## Risks / Trade-offs

- **hash-wasm in Bun**: WASM initialization has a one-time cost (~50ms). Acceptable — hashing happens per-file during indexing, not per-chunk.
- **Simple token estimator is rough**: 4 bytes/token is a rough approximation for English text. Code and CJK text tokenize differently. Mitigation: Simple is for early development; Tiktoken replaces it in production.
