## Why

The current pack output is a flat markdown blob without structure — no file index, no metadata, no AST tree. This makes it hard for LLMs to understand code structure. Additionally, AST data is stored in a `file_index` table but is **not searchable** (no FTS index), and there's no database-level metadata for introspection. A critical bug in CachedEmbedder uses string length as hash key, causing wrong embedding cache hits.

## What Changes

- **Fix critical bug**: CachedEmbedder hash function `(t: string) => t.length.toString()` → BLAKE3
- **Structured pack output**: JSONL AST sections, metadata headers, file index table of contents
- **DB metadata table**: new `db_meta` key-value table in LanceDB for schema version, stats, config
- **Structural AST search**: `ast_text` column + FTS index on `file_index` table, `--ast` flag in CLI search
- **Semantic AST search**: append AST summary to `core_content` before embedding
- **Dedup at ingest**: skip chunks with existing `semantic_blake3` hash in IndexingService
- **Minor fixes**: replace `randomUUID` with real hash in EmbedUseCase

## Capabilities

### New Capabilities
- `ast-search`: Structural search over AST data via FTS-indexed `ast_text` column; semantic AST search via annotated content embeddings
- `db-metadata`: Key-value database metadata table for introspection and migration tracking
- `structured-pack`: Markdown pack output with file index, metadata fields, and JSONL AST sections

### Modified Capabilities
- `cached-embedder`: hash function must use BLAKE3, not string length
- `lancedb-source-repository`: add `db_meta` table methods, `ast_text` column to `file_index`, FTS index on `ast_text`
- `pack-use-case`: structured output format with AST JSONL and metadata
- `indexing-service`: dedup at ingest via `hasSemanticBlake3` check; append AST summary to `core_content`
- `diff-indexing-service`: append AST summary to `core_content` before embedding
- `search-use-case`: add `--ast` filter mode for structural AST search
- `embed-use-case`: use real BLAKE3 hash instead of randomUUID for `semantic_blake3`
- `index-use-case`: update stats in `db_meta` after indexing

## Impact

- **src/index.ts**: CachedEmbedder hash fix (1 line change)
- **src/application/PackUseCase.ts**: rewrite output format
- **src/application/EmbedUseCase.ts**: semantic_blake3 hash fix
- **src/application/IndexUseCase.ts**: update db_meta after index
- **src/domain/services/IndexingService.ts**: dedup check, AST summary in content
- **src/domain/services/DiffIndexingService.ts**: AST summary in content
- **src/domain/ports/SourceRepository.ts**: 3 new methods for db_meta
- **src/infrastructure/lancedb/LanceDbSourceRepository.ts**: new table, new column, FTS index, new methods
- **src/presentation/cli/cli.ts**: `--ast` flag for search
- **src/infrastructure/hashing/BLAKE3Hasher.ts**: no changes needed (already implemented)
- **openspec/specs/**: 3 new spec directories, 7 modified specs
- **LanceDB schema**: new `db_meta` table, `ast_text` column in `file_index`
