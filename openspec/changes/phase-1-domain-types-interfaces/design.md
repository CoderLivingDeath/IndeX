## Context

All downstream code depends on the domain types and port interfaces defined here. This is the foundation of the Ports & Adapters architecture — pure TypeScript with zero external dependencies. The types are defined first so that all subsequent phases can import them without circular dependencies.

## Goals / Non-Goals

**Goals:**
- Define all shared data types in `src/domain/types.ts` as pure interfaces/types
- Define AST model in `src/domain/ast.ts` for code analysis results
- Define 6 port interfaces in `src/domain/ports/` — contracts that infrastructure adapters implement
- Define 4 system interfaces in `src/domain/systems/` — boundaries for pluggable modules
- Every interface is tested (compile-time verification + behavioral contracts)
- All tests pass before implementation code is written (TDD RED → GREEN)

**Non-Goals:**
- No implementation (that comes in Phases 2-7)
- No external dependencies — pure TypeScript only

## Decisions

- **Discriminated union for SourceMetadata**: `kind` field (`'code' | 'markdown' | 'obsidian' | 'generic'`) enables type narrowing — TypeScript guarantees exhaustive handling via `switch`.
- **Interfaces over abstract classes**: Lighter weight, no runtime overhead, works with Bun's test mocking. Infrastructure classes `implements` these interfaces.
- **UUID v7 for `id`**: Time-ordered UUIDs are sortable and index-friendly in LanceDB. Generated at the application level (not DB), via `uuidv7` or manual construction.
- **Separate FileIndex from SourceData**: FileIndex contains all AST symbols for one file; SourceData contains one chunk. One-to-many: one `FileIndex.path` → many `SourceData.path`. This avoids duplicating AST data per chunk.
- **`semantic_blake3` vs `file_blake3`**: Two different hashes — `file_blake3` is the whole file (for diff detection), `semantic_blake3` is the core semantic unit (for deduplication). They serve different purposes.

## Risks / Trade-offs

- **Type complexity**: Discriminated unions with 4 variants + metadata sub-objects can be verbose. Mitigation: use factory functions and type guards.
- **Interface proliferation**: 12+ interfaces in the domain layer may feel heavy for a small app. Trade-off accepted for modularity — each interface isolates a replaceable component.
