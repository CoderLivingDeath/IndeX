## Why

The DI container (`src/index.ts`) is the wiring hub of the entire application. It loads config, instantiates all parsers/chunkers/embedders/repositories, builds the registry, assembles services and use cases, and exports them. Without this, the system has no single entry point that ties everything together. The integration test validates the full pipe — real MarkdownParser + HeadingChunker + MockEmbedder + MockSourceRepository — end to end.

## What Changes

- Create `src/index.ts` — DI container: load config → create infrastructure → register parsers → build chunker pipeline → create embedder registry → build services → assemble use cases → export
- Create `tests/integration/full-cycle.test.ts` — integration test with real MarkdownParser + HeadingChunker + MockEmbedder + MockSourceRepository: index → search → pack full cycle
- All tests must pass (GREEN) before considering this phase complete

## Capabilities

### New Capabilities
- `di-container`: Central wiring of all IndeX modules — config loading, parser registry, chunker pipeline, embedder registry, domain services, use cases — exposed as a single entry point
- `integration-test`: End-to-end test validating the full pipeline with real parsers and chunkers (mocked embedding and storage)

### Modified Capabilities
- None

## Impact

- Adds `src/index.ts` — the main entry point
- Adds `tests/integration/full-cycle.test.ts` — integration smoke test
- Depends on Phase 9 (all use cases), Phase 10 (ConfigLoader, watcher, logger, markdown), plus all infrastructure phases (2-7)
- Unlocks Phase 12 (CLI and API call into the DI container)
