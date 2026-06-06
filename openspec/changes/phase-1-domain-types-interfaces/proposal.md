## Why

The entire IndeX indexing pipeline is built on shared domain types and port interfaces. Before any infrastructure code can be written, the core data structures (`SourceData`, `SearchResult`, `FileIndex`, `ParsedSource`) and system boundaries (`SourceRepository`, `Chunker`, `Embedder`, `Hasher`) must be defined. Without these, every module would define its own types, leading to coupling and inconsistency.

## What Changes

- Create `src/domain/types.ts` with all shared data types: `SourceData`, `SearchQuery`, `SearchResult`, `ParsedSource`, `IndexStats`, `SourceMetadata` (discriminated union), `SourceType`, and `SourceType` → `kind` mapping
- Create `src/domain/ast.ts` with AST model: `FileIndex`, `SymbolDetail`, `Import`, `Export`, `Relationship`, `SymbolKind`
- Create 6 port interfaces in `src/domain/ports/`: `SourceRepository`, `SourceParser`, `SourceParserRegistry`, `FileWatcher`, `FileFilter`, `Logger`
- Create 4 system interfaces in `src/domain/systems/`: `ChunkingSystem`, `EmbeddingSystem`, `ContextPackagingSystem`, `HashingSystem`
- Write comprehensive tests **before** implementation (RED phase) for each module
- Verify all tests pass (GREEN phase) before moving on

## Capabilities

### New Capabilities
- `domain-types`: Core data types (`SourceData`, `SearchResult`, `ParsedSource`, `SourceMetadata` discriminated union, `IndexStats`, `SourceType`)
- `domain-ast`: AST model for code analysis (`FileIndex`, `SymbolDetail`, `Import`, `Export`, `Relationship`)
- `domain-ports`: Port interfaces for all infrastructure adapters (`SourceRepository`, `SourceParser`, `SourceParserRegistry`, `FileWatcher`, `FileFilter`, `Logger`)
- `domain-systems`: System boundary interfaces (`Chunker`, `Embedder`, `Hasher`, `Deduplicator`, `ContextPacker`, `Tokenizer`, and their registries/caches)

### Modified Capabilities
- None

## Impact

- Adds 12 new files in `src/domain/` (types.ts, ast.ts, 4 systems, 6 ports)
- Adds matching test files in `tests/domain/`
- Zero external dependencies (pure TypeScript types and interfaces — Ports & Adapters core)
- All subsequent phases depend on these definitions
