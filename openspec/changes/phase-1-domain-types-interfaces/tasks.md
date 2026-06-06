## 1. Domain Types

- [ ] 1.1 **RED**: Write `tests/domain/types.test.ts` — test `SourceData` creation with all fields, `SearchQuery` with mode/tags/top_k, `SearchResult` with source/score/match_type, `ParsedSource` with type/path/content/tags/metadata, `IndexStats` with all fields, `SourceMetadata` discriminated union, `SourceType` mapping
- [ ] 1.2 **GREEN**: Create `src/domain/types.ts` with all types and interfaces
- [ ] 1.3 **TEST**: Run `bun test tests/domain/types.test.ts` — all tests pass

## 2. AST Model

- [ ] 2.1 **RED**: Write `tests/domain/ast.test.ts` — test `FileIndex` with path/file_blake3/language/symbols, `SymbolDetail` with kind/name/signature/positions, `Import`/`Export`, `Relationship`, `SymbolKind`
- [ ] 2.2 **GREEN**: Create `src/domain/ast.ts` with all AST model types
- [ ] 2.3 **TEST**: Run `bun test tests/domain/ast.test.ts` — all tests pass

## 3. Port Interfaces

- [ ] 3.1 **RED**: Write `tests/domain/ports/` — test contract conformance for `SourceRepository` (all methods exist), `SourceParser` (type/extensions/supportsFile/parse), `SourceParserRegistry` (getParser/register), `FileWatcher` (on/start/stop), `FileFilter` (formats/include/exclude), `Logger` (info/warn/error/debug)
- [ ] 3.2 **GREEN**: Create 6 port files in `src/domain/ports/`
- [ ] 3.3 **TEST**: Run `bun test tests/domain/ports/` — TypeScript-valid interfaces

## 4. System Interfaces

- [ ] 4.1 **RED**: Write `tests/domain/systems/` — test `ChunkingSystem` (Chunker/ChunkerPipeline), `EmbeddingSystem` (Embedder/EmbedderCache/EmbedderRegistry), `ContextPackagingSystem` (Deduplicator/Tokenizer/ContextPacker), `HashingSystem` (Hasher/TokenEstimator)
- [ ] 4.2 **GREEN**: Create 4 system files in `src/domain/systems/`
- [ ] 4.3 **TEST**: Run `bun test tests/domain/systems/` — all interfaces valid
