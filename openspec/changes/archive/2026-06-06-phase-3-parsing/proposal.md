## Why

IndeX must parse multiple file formats — Markdown notes, Obsidian vaults with wiki-links, and source code with AST — to extract structured content, metadata, and symbols. Without parsers, the indexing pipeline has no input. This phase builds the ParserRegistry that routes each file to the correct parser based on extension and content sniffing.

## What Changes

- Create test fixtures: `tests/fixtures/simple-note.md`, `obsidian-note.md`, `note-with-tags.md`, `sample-function.ts`
- Create `src/infrastructure/parser/MarkdownParser.ts` — remark-based Markdown parser extracting headings, links, stats
- Create `tests/infrastructure/parser/MarkdownParser.test.ts` before implementation (RED → GREEN)
- Create `src/infrastructure/parser/ObsidianParser.ts` — YAML frontmatter + wiki-links parser
- Create `tests/infrastructure/parser/ObsidianParser.test.ts` before implementation
- Create `src/infrastructure/parser/AstGrepParser.ts` — ast-grep based code parser for symbols, imports, exports
- Create `tests/infrastructure/parser/AstGrepParser.test.ts` before implementation
- Create `src/infrastructure/parser/ParserRegistry.ts` — two-phase parser routing (extension → content sniff for .md)
- Create `tests/infrastructure/parser/ParserRegistry.test.ts` before implementation

## Capabilities

### New Capabilities
- `markdown-parser`: Parse Markdown files extracting H1 title, heading hierarchy, links (internal/external), resources, word/paragraph/reading-time stats
- `obsidian-parser`: Parse Obsidian notes with YAML frontmatter, wiki-links `[[target|alias]]`, tags, dataview queries
- `code-parser`: Parse TypeScript files via ast-grep extracting functions, classes, interfaces, imports, exports, top-level declarations
- `parser-registry`: Two-phase file routing — extension-based candidate selection then content sniffing for .md files (Obsidian vs plain Markdown)

### Modified Capabilities
- None

## Impact

- Adds 4 implementation files in `src/infrastructure/parser/`
- Adds 4 test files in `tests/infrastructure/parser/`
- Adds 4 fixture files in `tests/fixtures/`
- New dependencies: `remark`, `unified`, `remark-parse`, `remark-frontmatter`, `remark-gfm`, `yaml` (for frontmatter), `@ast-grep/napi` (for code parsing)
- Depends on Phase 1 types (`ParsedSource`, `SourceMetadata`, `FileIndex`) and Phase 2 BLAKE3 (for `file_blake3` computation)
