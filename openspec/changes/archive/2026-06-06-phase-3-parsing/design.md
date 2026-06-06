## Context

IndeX needs to parse three content types: Markdown (notes), Obsidian (vaults with wiki-links), and source code (TypeScript, for symbols/imports). The ParserRegistry routes files to the correct parser based on extension and optional content sniffing.

## Goals / Non-Goals

**Goals:**
- `MarkdownParser`: Extract H1 title, heading hierarchy (H2+), links (internal/external), resources (images), word/paragraph/reading-time stats, code block count
- `ObsidianParser`: Extract YAML frontmatter (tags, title), wiki-links `[[target]]` and `[[target|alias]]`, dataview queries, plus all MarkdownParser metadata
- `AstGrepParser`: Extract functions, classes, interfaces, imports, exports from TypeScript source into `FileIndex` + `CodeMetadata`
- `ParserRegistry`: Two-phase selection — first by extension (`.md` → MarkdownParser, `.ts` → AstGrepParser), second by content sniffing (markdown with Obsidian frontmatter → ObsidianParser)
- Each parser has comprehensive tests with fixture files

**Non-Goals:**
- No backlink resolution (done in DiffIndexingService)
- No Python/Rust/Go parsers (only TypeScript initially)
- No PDF/image parsing

## Decisions

- **remark (unified) for Markdown AST**: Industry-standard Markdown parser with rich plugin ecosystem. `remark-frontmatter` for YAML frontmatter detection, `remark-gfm` for tables/strikethrough. AST gives exact heading positions for chunking.
- **Two-phase parser routing for .md**: First try MarkdownParser, then check if frontmatter has Obsidian fields (tags, `dg-*`, etc.) → redirect to ObsidianParser. This avoids false positives from plain markdown with random YAML.
- **ast-grep for code parsing**: Semantic code search tool with tree-sitter grammar. Handles TypeScript syntax precisely — no regex hacks for imports/exports.
- **Fixtures as real files**: `tests/fixtures/*.md` and `tests/fixtures/*.ts` are checked into git. Tests read them with `Bun.file()` for realistic parsing scenarios.
- **`file_blake3` computed in parser**: The parser receives the file path and computes BLAKE3 as part of `parse()`. This keeps the hash calculation close to the content.

## Risks / Trade-offs

- **ast-grep native binary**: `@ast-grep/napi` has native bindings per platform. Test on Windows during CI — some Linux-focused tools break on Windows.
- **remark ECMAScript modules**: remark and unified are ESM-only. Bun handles ESM well, but verify there are no CJS interop issues.
