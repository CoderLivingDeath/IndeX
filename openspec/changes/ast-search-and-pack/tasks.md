## 1. Critical Bug — CachedEmbedder hash fix

- [x] 1.1 Change `CachedEmbedder` hash function from `t.length.toString()` to `hasher` (BLAKE3) in `src/index.ts`

## 2. Structured Pack Output

- [x] 2.1 Add file index table of contents to `PackUseCase.execute()` output
- [x] 2.2 Add per-file metadata block (type, language, lines, tokens, tags, path, blake3, last_parsed)
- [x] 2.3 Add `### ast` JSONL section for code files with imports/exports/symbols/relationships/complexity
- [x] 2.4 Add `### code` / `### content` fenced code block with language-specific highlighting
- [x] 2.5 Handle non-code files (markdown: `### content`, no AST section)
- [x] 2.6 Remove `pack-example.md` and `pack-example.jsonl` after implementation

## 3. DB Metadata Table

- [x] 3.1 Add `getDbMeta()`, `setDbMeta()`, `getAllDbMeta()` methods to `SourceRepository` interface
- [x] 3.2 Add `db_meta` table creation and CRUD in `LanceDbSourceRepository`
- [x] 3.3 Update `IndexUseCase` to write `last_indexed`, `total_files`, `total_chunks`, `total_tokens` after indexing
- [x] 3.4 Write db_meta tests in `LanceDbSourceRepository` tests

## 4. Structural AST Search

- [x] 4.1 Add `ast_text` column to `file_index` table schema in `LanceDbSourceRepository`
- [x] 4.2 Generate `ast_text` flat text from FileIndex data in `fileIndexToRecord()`
- [x] 4.3 Create FTS index on `ast_text` column when opening `file_index` table
- [x] 4.4 Add `"ast"` to `SearchQuery.mode` union type in `domain/types.ts`
- [x] 4.5 Add AST search branch in `LanceDbSourceRepository.search()` (FTS on `ast_text`)
- [x] 4.6 Add `--ast` flag to CLI `search` command that passes `mode: "ast"`
- [x] 4.7 Handle `ast` mode in `SearchService`
- [x] 4.8 Write tests for AST search

## 5. Semantic AST Search

- [x] 5.1 Add function to generate AST summary text (imports/exports/symbols in human-readable format)
- [x] 5.2 In `IndexingService`: append AST summary to `core_content` before embedding for code files
- [x] 5.3 In `DiffIndexingService`: append AST summary to `core_content` before embedding for code files
- [x] 5.4 Skip AST summary for non-code file types

## 6. Dedup at Ingest

- [x] 6.1 In `IndexingService`: call `hasSemanticBlake3(hash)` before inserting each chunk
- [x] 6.2 Skip chunk if hash already exists

## 7. Minor Fixes

- [x] 7.1 Replace `embed-${crypto.randomUUID()}` with real BLAKE3 hash in `EmbedUseCase`
- [x] 7.2 Run TypeScript check to verify no type errors (all pre-existing only)
- [x] 7.3 Run existing tests to verify no regressions
