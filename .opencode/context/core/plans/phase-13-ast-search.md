# Phase 13 — AST Search + Structured Pack + DB Metadata

## 1. Critical Bug — CachedEmbedder hash collision

**File:** `src/index.ts:198`
**Problem:** `CachedEmbedder` uses `(t: string) => t.length.toString()` as cache key hash instead of BLAKE3. Texts with same length produce identical cache keys, returning WRONG embeddings on collision.
**Fix:** Replace with `hasher` (BLAKE3Hasher from line 156).

## 2. Pack — Structured Markdown Output

**File:** `PackUseCase.ts`
New output format per file:

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
{"kind":"symbol","name":"load","type":"function","signature":"load(path?: string): Config","line":58}
{"kind":"relationship","type":"imports","source":"ConfigLoader.ts","target":"zod"}
{"kind":"complexity","functions":8,"classes":2,"types":10,"lines":167}

### code
```typescript
// full content
```
```

## 3. DB Metadata — new `db_meta` table

New table in LanceDB, key-value:

| Key | Value |
|-----|-------|
| `schema_version` | `2` |
| `created_at` | `2026-06-07T15:00:00Z` |
| `last_indexed` | `2026-06-07T16:30:00Z` |
| `embedding_model` | `qllama/multilingual-e5-small` |
| `embedding_dimensions` | `384` |
| `total_files` | `150` |
| `total_chunks` | `1200` |
| `total_tokens` | `450000` |
| `config_hash` | `a1b2c3d4` |

**Methods to add to `SourceRepository`:**
- `getDbMeta(key: string): Promise<string | null>`
- `setDbMeta(key: string, value: unknown): Promise<void>`
- `getAllDbMeta(): Promise<Record<string, unknown>>`

**Auto-update:** `IndexingService` / `DiffIndexingService` update `last_indexed`, `total_files`, `total_chunks`, `total_tokens` after each index run.

## 4. Structural AST Search — `ast_text` + FTS on `file_index`

**Add column `ast_text` to `file_index` table:**
Flat text projection of AST for FTS indexing:
```
import:fs:readFileSync,existsSync import:zod:z,ZodError export:type:Config export:function:load symbol:const:ModelConfig[12] symbol:function:load[58] relationship:imports:ConfigLoader.ts:zod
```

**FTS index on `ast_text`:**
```typescript
await table.createIndex("ast_text", {
  config: lancedb.Index.fts({ withPosition: true }),
  replace: true,
});
```

**CLI `search --ast` flag:**
New flag searches `ast_text` field with FTS instead of `content`.

## 5. Semantic AST Search — AST summary in content

**Before embedding**, append AST summary to `core_content`:
```
// original code
import { z } from "zod";
...

--- AST ---
imports: zod → z
exports: function load
symbols: function load(path?:string):Config
```

This makes semantic search find structurally similar code even with different naming.

## 6. Dedup at Ingest Time

**`IndexingService`:**
- Before inserting chunk, check `hasSemanticBlake3(hash)`
- If hash exists → skip (already indexed)
- Prevents duplicate chunks on re-index

## 7. Minor Fixes

- **`EmbedUseCase.semantic_blake3`**: replace `embed-${crypto.randomUUID()}` with real BLAKE3 hash of content
- **`pack-example.md`** and **`pack-example.jsonl`**: remove after implementation

## Priority Order

1. **CRITICAL** — CachedEmbedder hash fix
2. Pack structured output
3. DB metadata table
4. AST structural search (ast_text + FTS)
5. AST semantic search (AST summary in content)
6. Dedup at ingest time
