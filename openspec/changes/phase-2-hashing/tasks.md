## 1. MockHasher

- [ ] 1.1 **GREEN**: Create `tests/mocks/MockHasher.ts` using Node.js `crypto.createHash('sha256')`, implementing the `Hasher` interface from Phase 1 with `hash()`, `hashFile()`, and `hashDirectory()` stub

## 2. BLAKE3Hasher

- [ ] 2.1 **RED**: Write `tests/infrastructure/hashing/BLAKE3Hasher.test.ts` — test `hash("hello")` returns 64-char hex, `hash("hello") !== hash("world")`, `hashFile(path)` matches `hash(content)`, empty string hash, long text hash determinism
- [ ] 2.2 **GREEN**: Create `src/infrastructure/hashing/BLAKE3Hasher.ts` — use `hash-wasm` BLAKE3 for string hashing, `Bun.file().text()` for streaming file hash, implement `Hasher` interface
- [ ] 2.3 **TEST**: Run `bun test tests/infrastructure/hashing/BLAKE3Hasher.test.ts` — all tests pass

## 3. TokenEstimatorSimple

- [ ] 3.1 **RED**: Write `tests/infrastructure/hashing/TokenEstimatorSimple.test.ts` — test `estimate("hello")` ≈ 1-2 tokens (bytes/4), `estimate("")` = 0, long text estimate is proportional
- [ ] 3.2 **GREEN**: Create `src/infrastructure/hashing/TokenEstimatorSimple.ts` — implement `TokenEstimator` interface, `estimate(text) = Math.ceil(text.length / 4)`
- [ ] 3.3 **TEST**: Run `bun test tests/infrastructure/hashing/TokenEstimatorSimple.test.ts` — all tests pass

## 4. TokenEstimatorTiktoken

- [ ] 4.1 **RED**: Write `tests/infrastructure/hashing/TokenEstimatorTiktoken.test.ts` — test accurate GPT token count, fallback to Simple when tiktoken unavailable
- [ ] 4.2 **GREEN**: Create `src/infrastructure/hashing/TokenEstimatorTiktoken.ts` — try `import gpt-tokenizer`, fall back to `TokenEstimatorSimple` on failure
- [ ] 4.3 **TEST**: Run `bun test tests/infrastructure/hashing/` — all hashing tests pass
