## 1. DI Systems (Group Interfaces)

- [x] 1.1 **GREEN**: Create `src/application/di/Systems.ts` — `IndexSystems`, `SearchSystems`, `PackSystems`, `ChunkSystems`, `EmbedSystems` group interfaces bundling required dependencies for each use case

## 2. ConfigLoader

- [x] 2.1 **RED**: Write `tests/infrastructure/config/ConfigLoader.test.ts` — load() validates correct config, loadOrDefault() returns defaults without config file, broken JSON throws Zod error, invalid model config (missing required fields) throws validation error, universal_model validated to be in models[]
- [x] 2.2 **GREEN**: Create `src/config/ConfigLoader.ts` — Zod schema for full config, load() reads `.indeX/config.json`, loadOrDefault() returns defaults, descriptive error messages
- [x] 2.3 **TEST**: Run `bun test tests/infrastructure/config/ConfigLoader.test.ts` — all tests pass

## 3. IndexUseCase

- [x] 3.1 **RED**: Write `tests/application/IndexUseCase.test.ts` — mock all dependencies, execute("./vault")→full cycle with MockSourceRepository+ParserRegistry+Chunker+Embedder, verify each step called correctly
- [x] 3.2 **GREEN**: Create `src/application/IndexUseCase.ts` — delegates to IndexingService with injected DI group
- [x] 3.3 **TEST**: Run `bun test tests/application/IndexUseCase.test.ts` — all tests pass

## 4. SearchUseCase

- [x] 4.1 **RED**: Write `tests/application/SearchUseCase.test.ts` — search("query", { mode: "hybrid" })→SearchResult[], mode switching works, empty query handling
- [x] 4.2 **GREEN**: Create `src/application/SearchUseCase.ts` — delegates to SearchService
- [x] 4.3 **TEST**: Run `bun test tests/application/SearchUseCase.test.ts` — all tests pass

## 5. PackUseCase

- [x] 5.1 **RED**: Write `tests/application/PackUseCase.test.ts` — pack("./fixtures", { include/to/exclude })→PackedContext, filter patterns work, concatenation format correct
- [x] 5.2 **GREEN**: Create `src/application/PackUseCase.ts` — scan → filter → parse (via ParserRegistry) → concat → output .md
- [x] 5.3 **TEST**: Run `bun test tests/application/PackUseCase.test.ts` — all tests pass

## 6. ChunkUseCase

- [x] 6.1 **RED**: Write `tests/application/ChunkUseCase.test.ts` — chunk("./fixtures", { strategy })→Chunk[], include/exclude filters applied
- [x] 6.2 **GREEN**: Create `src/application/ChunkUseCase.ts` — scan → filter → parse → chunk via ChunkerFactory
- [x] 6.3 **TEST**: Run `bun test tests/application/ChunkUseCase.test.ts` — all tests pass

## 7. EmbedUseCase

- [x] 7.1 **RED**: Write `tests/application/EmbedUseCase.test.ts` — embed({ source: "chunks" })→upserts embeddings, embed({ source: "files" })→chunk+embed, each model's embedding stored per source
- [x] 7.2 **GREEN**: Create `src/application/EmbedUseCase.ts` — read existing chunks or re-parse files, multi-model embed, upsert to SourceRepository
- [x] 7.3 **TEST**: Run `bun test tests/application/EmbedUseCase.test.ts` — all tests pass

## 8. WatchUseCase + DeleteUseCase

- [x] 8.1 **RED**: Write `tests/application/WatchUseCase.test.ts` — watch("./vault") starts FileWatcher, onChange→DiffIndexingService called, stop() stops watcher
- [x] 8.2 **GREEN**: Create `src/application/WatchUseCase.ts` (start watcher with DiffIndexingService) and `src/application/DeleteUseCase.ts` (delegate to SourceRepository.deleteByPath)
- [x] 8.3 **TEST**: Run `bun test tests/application/` — all use case tests pass
