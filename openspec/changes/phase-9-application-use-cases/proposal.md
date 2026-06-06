## Why

Use cases are the application-level entry points that wire together domain services, infrastructure, and DI. They provide the clean API surface that the CLI and HTTP layers call. Without use cases, there is no way to invoke the system — each command (`index`, `search`, `pack`, `chunk`, `embed`, `watch`) is a separate use case.

## What Changes

- Create `src/application/di/Systems.ts` — dependency group interfaces (`IndexSystems`, `SearchSystems`, `PackSystems`, `ChunkSystems`, `EmbedSystems`)
- Create `src/application/IndexUseCase.ts` — full index cycle: scan → parse → chunk → embed → upsert
- Create `tests/application/IndexUseCase.test.ts` before implementation (RED → GREEN)
- Create `src/application/SearchUseCase.ts` — search with mode/tags/top_k, returning `SearchResult[]`
- Create `tests/application/SearchUseCase.test.ts` before implementation
- Create `src/application/PackUseCase.ts` — file packaging with include/exclude filters into `.md` bundle
- Create `tests/application/PackUseCase.test.ts` before implementation
- Create `src/application/ChunkUseCase.ts` — chunk files with strategy selection, include/exclude
- Create `tests/application/ChunkUseCase.test.ts` before implementation
- Create `src/application/EmbedUseCase.ts` — generate embeddings from chunks or files, upsert to LanceDB
- Create `tests/application/EmbedUseCase.test.ts` before implementation
- Create `src/application/WatchUseCase.ts` — start FileWatcher, wire events to DiffIndexingService
- Create `tests/application/WatchUseCase.test.ts` before implementation
- Create `src/application/DeleteUseCase.ts` — delete by path/sourceId
- Create `src/config/ConfigLoader.ts` — zod-schema validated config loading from `.indeX/config.json`
- Create `tests/infrastructure/config/ConfigLoader.test.ts` before implementation

## Capabilities

### New Capabilities
- `di-systems`: Dependency group interfaces bundling related ports and systems for use case injection
- `index-use-case`: End-to-end index orchestration — parse, chunk, embed, upsert — usable from CLI as `indeX index <path>`
- `search-use-case`: Query the index with semantic/keyword/hybrid modes — usable from CLI as `indeX search <query>`
- `pack-use-case`: Filter and concatenate files into a single Markdown document — usable as `indeX pack <path> -o bundle.md`
- `chunk-use-case`: Chunk files with configurable strategy and filters — usable as `indeX chunk <path>`
- `embed-use-case`: Generate embeddings from existing chunks or from file re-parsing — usable as `indeX embed <path>`
- `watch-use-case`: Watch directory for changes and run diff indexing — usable as `indeX watch <path>`
- `delete-use-case`: Remove indexed data by path or source ID
- `config-loader`: Zod-validated JSON config loader for `.indeX/config.json` with defaults, model validation, and descriptive errors

### Modified Capabilities
- None

## Impact

- Adds 9 implementation files in `src/application/` and `src/config/`
- Adds 7 test files in `tests/application/` and `tests/infrastructure/config/`
- New dependency: `zod` (already installed in Phase 0)
- Depends on Phase 8 (all domain services), Phase 10 (ConfigLoader, FileWatcher, Logger)
- Unlocks Phase 11 (DI container) and Phase 12 (CLI commands)
