## Context

The indexer stores chunk-level data in a LanceDB `sources` table (content + embeddings for vector search) and file-level AST summaries in a `file_index` table (imports/exports/symbols as JSON strings). Currently:

- **PackUseCase** outputs flat `---\n# path\n---\ncontent\n` markdown — no structure, metadata, or AST info
- **CachedEmbedder** uses `(t) => t.length.toString()` as cache key — texts of same length collide, returning wrong embeddings
- **file_index** stores AST data but has no FTS index — cannot search "find files importing zod"
- **No database metadata** — schema version, embedder config, stats are not persisted
- **No ingest dedup** — re-indexing creates duplicate chunks with identical `semantic_blake3`

The project uses TypeScript with `exactOptionalPropertyTypes: true`, LanceDB for storage, Ollama for embeddings, BLAKE3 for hashing.

## Goals / Non-Goals

**Goals:**
- Fix CachedEmbedder cache key collision by using BLAKE3 hash
- Produce structured pack output with file index, metadata fields, JSONL AST sections
- Add searchable AST data: FTS-indexed `ast_text` column, `--ast` CLI flag, AST-summary in embedding content
- Add DB metadata table for schema version, stats, config introspection
- Skip duplicate chunks at ingest time via `semantic_blake3` check
- Use real BLAKE3 hash in EmbedUseCase instead of randomUUID

**Non-Goals:**
- No changes to the AST parser itself (parsers already produce FileIndex correctly)
- No changes to LanceDB embedding storage schema (embeddings column stays as-is)
- No changes to the search ranking algorithm
- No breaking changes to existing CLI or API interfaces

## Decisions

### 1. CachedEmbedder hash: pass BLAKE3Hasher directly

**Decision:** Change `new CachedEmbedder(embedder, cache, { hash: (t) => t.length.toString() })` to `new CachedEmbedder(embedder, cache, hasher)` in `src/index.ts`.

**Rationale:** BLAKE3Hasher already exists, is injected into the DI container, and is used everywhere else for hashing. The length-based hash was likely a placeholder that was never replaced. Minimal change — 1 line.

**Alternatives considered:** Keeping length-based hash (rejected: causes wrong embedding cache hits).

### 2. Structured pack format: key-value metadata + JSONL ast + fenced code block

**Decision:** Each file section in pack output contains:
```
## relative/path.ts
type: code
language: TypeScript
lines: 167
tokens: 1078
tags: config, loader
path: relative/path.ts
blake3: a1b2c3d4...
last_parsed: 2026-06-07T15:20:00.000Z

### ast
{"kind":"import","from":"fs","specifiers":["readFileSync","existsSync"],"type":"named"}
{"kind":"export","name":"load","type":"function"}
{"kind":"complexity","functions":8,"classes":2,"types":10,"lines":167}

### code
```typescript
// full file content
```
```

**Rationale:** Key-value metadata is LLM-friendly and parseable. JSONL AST is machine-readable and filterable. File index TOC at top provides navigation. No new dependencies.

### 3. DB metadata: separate `db_meta` table in LanceDB

**Decision:** New `db_meta` table with `key` (string) and `value` (string) columns. Methods on `SourceRepository`: `getDbMeta`, `setDbMeta`, `getAllDbMeta`.

**Rationale:** Simple key-value store. A single string column for value keeps the schema stable (values are JSON-stringified). IndexingService and DiffIndexingService update after each run.

**Schema:**
```
Field("key", Utf8(), false)    -- primary key
Field("value", Utf8(), true)   -- JSON-stringified value
```

### 4. Structural AST search: `ast_text` column + FTS index

**Decision:** Add `ast_text` column to `file_index` table. Generate flat text projection when upserting FileIndex. Create FTS index on `ast_text`. Add `--ast` flag to CLI `search` that searches `ast_text` instead of `content`.

**Flat text format:**
```
import:fs:readFileSync,existsSync import:zod:z,ZodError export:type:Config symbol:function:load[58] relationship:imports:ConfigLoader.ts:zod
```

**Rationale:** LanceDB FTS works on string columns. Flat text with `kind:value` prefixes enables precise queries like `import:zod` or `symbol:function:load`. No schema changes to the `sources` table.

### 5. Semantic AST search: AST summary appended to `core_content` before embedding

**Decision:** In `IndexingService` and `DiffIndexingService`, before calling `embedder.embed(chunk.core_content)`, prepend an AST summary:
```
--- AST ---
imports: zod → z, ZodError
exports: type Config, function load
symbols: function load(path?:string):Config
```

This makes the embedding vector encode structural information, enabling semantic search like "validate schema via zod" to find files using zod even if the query wording differs.

**Rationale:** Zero new dependencies. The AST summary becomes part of the embedding without changing the storage schema. Only affects the input to the embedder, not the stored content.

### 6. Dedup at ingest: `hasSemanticBlake3` check before insert

**Decision:** In `IndexingService`, after computing `semanticHash`, call `this.repo.hasSemanticBlake3(semanticHash)`. If true, skip creating a `SourceData` record for that chunk.

**Rationale:** Prevents duplicate chunks on re-index. The DiffIndexingService already handles this by deleting old chunks by path first, so the check is mainly for the full `index` path and for the edge case where identical chunks appear in different files.

## Risks / Trade-offs

- **AST summary increases embedding input size**: ~10-20% more tokens per chunk for code files. For markdown files, no change (no AST available). Acceptable trade-off for better structural understanding.
- **FTS index on `ast_text` adds write overhead**: Each file index upsert now also builds/updates the FTS index. Measurable but acceptable for typical codebase sizes (<10K files).
- **`hasSemanticBlake3` adds a DB query per chunk**: O(n) DB lookups during indexing. For 1000 chunks, ~1000 queries. Acceptable — LanceDB queries are fast (<1ms).
- **`ast_text` flat format is lossy**: JSON structure is lost in the flat text projection. If structured queries are needed later, a dedicated AST search index would be required. Acceptable for current needs.
- **Existing `file_index` data has no `ast_text`**: Old entries need to be backfilled or will have empty `ast_text`. Proposed: generate `ast_text` on first read/re-index. No migration needed.
