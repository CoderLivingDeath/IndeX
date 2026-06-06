## Context

The DI container in `src/index.ts` wires together all components from Phases 2-10. This is the composition root — the only place concrete classes are instantiated and wired together. The integration test validates that real parsers + real chunkers + mocks produce correct results end-to-end.

## Goals / Non-Goals

**Goals:**
- `src/index.ts` creates: ConfigLoader → Logger → Hasher → Parsers → ParserRegistry → ChunkerFactory → EmbedderRegistry → SourceRepository → Services → Use Cases
- Exports a single `createApp()` function that returns `{ index, search, pack, chunk, embed, watch, del }`
- Integration test: real MarkdownParser + HeadingChunker + MockEmbedder + MockSourceRepository, full cycle: index a fixture → search a term → pack results

**Non-Goals:**
- No DI framework (manual DI via factory functions is sufficient and explicit)
- No lazy initialization (all dependencies created eagerly at startup)

## Decisions

- **Manual DI over a framework**: For an app of this size, a DI framework (tsyringe, inversify) adds complexity without benefit. Factory functions make the dependency graph explicit and testable.
- **`createApp()` returns a use case bundle**: All use cases are returned as named methods on a single object. The CLI imports `createApp` and destructures the needed use cases. No global state.
- **Integration test uses mocked storage + real parsers**: Tests the critical path: parse → chunk → search formatting. Vector embedding and DB are mocked to keep the test fast and deterministic.
- **Config loaded at startup**: `createApp(configPath?)` accepts an optional config path. Defaults to `.indeX/config.json` in the current working directory.

## Risks / Trade-offs

- **Single-file DI can grow large**: `src/index.ts` may be 100+ lines. Acceptable — it's the composition root, and explicit wiring is more maintainable than magic auto-wiring.
- **Eager initialization means slower startup**: All dependencies (including embedders that reach out to Ollama) are created at startup. Mitigation: lazy connection for Ollama (connect on first use, not construction).
