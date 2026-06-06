## Context

Use cases are the application-level entry points that coordinate domain services and infrastructure. They provide the clean API that CLI and HTTP layers call. Each use case is a single-responsibility class with injected dependencies (DI groups).

## Goals / Non-Goals

**Goals:**
- `IndexUseCase.execute(path)`: Orchestrates full indexing — scan → parse → chunk → multi-model embed → upsert — via IndexingService
- `SearchUseCase.execute(query, options)`: Search with mode/tags/top_k — via SearchService + ContextPacker
- `PackUseCase.execute(path, options)`: Package files into `.md` with include/exclude — via ParserRegistry + file scanning
- `ChunkUseCase.execute(path, options)`: Chunk files with strategy — via ParserRegistry + ChunkerFactory
- `EmbedUseCase.execute(options)`: Generate/update embeddings — reads chunks from source or re-parses files
- `WatchUseCase.execute(path)`: Start FileWatcher → diff on change — via ChokidarWatcher + DiffIndexingService
- `DeleteUseCase.execute(path)`: Remove data — via SourceRepository.deleteByPath
- `ConfigLoader.load()` / `loadOrDefault()`: Zod-validated `.indeX/config.json` loading
- All use cases tested with mocks (MockSourceRepository, MockEmbedder, MockChunker)

**Non-Goals:**
- No authentication/authorization (local tool)
- No request validation (handled by CLI/API layer)
- No progress streaming

## Decisions

- **Single-use-case-per-file**: Keeps each use case focused and independently testable. Matches clean architecture patterns.
- **DI group interfaces**: `IndexSystems`, `SearchSystems`, etc. bundle the specific ports each use case needs. This makes DI explicit and avoids constructor bloat (one interface with 10+ dependencies).
- **ConfigLoader returns Config object**: No side effects. `loadOrDefault()` is safe to call anytime — returns defaults if no config file exists. `load()` fails fast with Zod validation errors for broken configs.
- **Zod for config schema**: Runtime validation with descriptive error messages. Catches typos in model names, missing required fields, and type mismatches before they cause runtime errors.

## Risks / Trade-offs

- **Config file discoverability**: `.indeX/config.json` in the user's vault directory may be unexpected. Mitigation: document the config location in CLI help, include a default config template.
- **Zod validation verbosity**: Nested discriminated unions produce long error messages. Mitigation: use Zod's `superRefine` for human-readable error paths like `models[0].dimensions`.
