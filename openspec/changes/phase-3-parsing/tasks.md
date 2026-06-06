## 1. Test Fixtures

- [ ] 1.1 **GREEN**: Create `tests/fixtures/simple-note.md` — plain Markdown with H1, H2, paragraphs, links, code block
- [ ] 1.2 **GREEN**: Create `tests/fixtures/obsidian-note.md` — Obsidian note with YAML frontmatter (tags, title), [[wiki-links]], content
- [ ] 1.3 **GREEN**: Create `tests/fixtures/note-with-tags.md` — Markdown with tags in frontmatter
- [ ] 1.4 **GREEN**: Create `tests/fixtures/sample-function.ts` — TypeScript with function, class, imports, exports

## 2. MarkdownParser

- [ ] 2.1 **RED**: Write `tests/infrastructure/parser/MarkdownParser.test.ts` — parse fixture → title (H1), content, headings, links, stats (wordCount, readingTimeMinutes, paragraphCount), no frontmatter → correct ParsedSource
- [ ] 2.2 **GREEN**: Create `src/infrastructure/parser/MarkdownParser.ts` — use `remark` + unified for AST; extract H1→title, H2+→headings, links from AST, compute stats
- [ ] 2.3 **TEST**: Run `bun test tests/infrastructure/parser/MarkdownParser.test.ts` — all tests pass

## 3. ObsidianParser

- [ ] 3.1 **RED**: Write `tests/infrastructure/parser/ObsidianParser.test.ts` — parse fixture → title from frontmatter, wikiLinks `[[target]]` and `[[target|alias]]`, frontmatter fields, tags, content without frontmatter, empty backlinks/graphConnections
- [ ] 3.2 **GREEN**: Create `src/infrastructure/parser/ObsidianParser.ts` — YAML frontmatter via `yaml` parser, wiki-links via regex, implements `SourceParser`
- [ ] 3.3 **TEST**: Run `bun test tests/infrastructure/parser/ObsidianParser.test.ts` — all tests pass

## 4. AstGrepParser

- [ ] 4.1 **RED**: Write `tests/infrastructure/parser/AstGrepParser.test.ts` — parse fixture → symbols (functions, classes), language='typescript', topLevelDeclarations, complexity (lines/functions/classes), FileIndex with imports/exports
- [ ] 4.2 **GREEN**: Create `src/infrastructure/parser/AstGrepParser.ts` — use `@ast-grep/napi` for TypeScript parsing, extract symbols, imports, exports, compute CodeMetadata
- [ ] 4.3 **TEST**: Run `bun test tests/infrastructure/parser/AstGrepParser.test.ts` — all tests pass

## 5. ParserRegistry

- [ ] 5.1 **RED**: Write `tests/infrastructure/parser/ParserRegistry.test.ts` — register parsers, getParser(".md") detects Obsidian vs Markdown, getParser(".ts") → AstGrepParser, getParser(".py") → null, getEnabledParsers()
- [ ] 5.2 **GREEN**: Create `src/infrastructure/parser/ParserRegistry.ts` — two-phase selection: extension-based candidate, then content sniffing for .md (frontmatter check)
- [ ] 5.3 **TEST**: Run `bun test tests/infrastructure/parser/` — all parser tests pass
