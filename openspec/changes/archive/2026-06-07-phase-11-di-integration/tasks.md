## 1. DI Container (src/index.ts)

- [x] 1.1 **GREEN**: Create `src/index.ts` — `createApp(configPath?)` factory:
  1. Load config via `ConfigLoader.loadOrDefault()`
  2. Create `PinoLogger` (or `SilentLogger` in test mode)
  3. Create `BLAKE3Hasher`
  4. Register parsers: `MarkdownParser`, `ObsidianParser`, `AstGrepParser` → `ParserRegistry`
  5. Build `ChunkerFactory.createPipeline(['heading', 'paragraph', 'sentence', 'overflow'])`
  6. Create `EmbedderCacheLRU`, wrap each model in `CachedEmbedder`, build `EmbedderRegistryImpl` from config
  7. Create `LanceDbSourceRepository` (or `MockSourceRepository` in test mode)
  8. Build `IndexingService`, `SearchService`, `DiffIndexingService`
  9. Build all use cases: `IndexUseCase`, `SearchUseCase`, `PackUseCase`, `ChunkUseCase`, `EmbedUseCase`, `WatchUseCase`, `DeleteUseCase`
  10. Return `{ index, search, pack, chunk, embed, watch, del }`
- [x] 1.2 **SMOKE TEST**: Run `bun run src/index.ts` → "IndeX started" or app initializes without error

## 2. Integration Test

- [x] 2.1 **RED**: Write `tests/integration/full-cycle.test.ts`:
  - Use `createApp("memory://")` test-mode factory
  - Index a real Markdown fixture from `tests/fixtures/simple-note.md` through real `MarkdownParser` + real `HeadingChunker` + `MockEmbedder` + `MockSourceRepository`
  - Search for a term from the fixture → results found
  - Pack the fixture → Markdown output is correct
  - `IndexStats` returns expected counts
- [x] 2.2 **GREEN**: Ensure DI container supports test-mode injection (swappable `SourceRepository`)
- [x] 2.3 **TEST**: Run `bun test tests/integration/full-cycle.test.ts` — all tests pass
