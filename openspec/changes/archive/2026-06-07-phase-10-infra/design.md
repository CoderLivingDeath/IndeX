## Context

Three infrastructure pieces support the rest of the system: file watching (for live-reindex on changes), structured logging (for observability), and Markdown AST parsing (for heading-aware chunking). Each implements a port interface defined in Phase 1.

## Goals / Non-Goals

**Goals:**
- `ChokidarWatcher`: Implements `FileWatcher` — start/stop lifecycle, `add`/`change`/`unlink` events, 500ms debounce to batch rapid changes
- `PinoLogger`: Implements `Logger` — info/warn/error/debug with structured JSON output, `child()` for context sub-loggers
- `SilentLogger`: Implements `Logger` — all methods are no-ops, for test environments
- `MarkdownAstParser`: Extracts headings (level, text, anchor) from Markdown using remark — used by HeadingChunker

**Non-Goals:**
- No custom file watch strategies beyond chokidar defaults
- No log rotation or external log shipping (console/stdout is sufficient for a CLI tool)

## Decisions

- **chokidar over Bun's built-in watcher**: chokidar is more mature, cross-platform tested, and has built-in debounce. Bun's `Bun.watch()` is experimental and doesn't support recursive directory watching reliably.
- **500ms debounce**: Prevents rapid-fire events during file saves (many editors save atomically via temp files). 500ms is the sweet spot between responsiveness and batching.
- **pino for logging**: Fastest structured logger for Node.js/Bun. `pino-pretty` for development (human-readable). JSON output for production (log shipping).
- **SilentLogger for tests**: Prevents test noise. All Logger users (IndexingService, SearchService, etc.) accept Logger via DI, so SilentLogger keeps test output clean.
- **MarkdownAstParser extracts anchor slugs**: GitHub-style anchors (`# hello` → `hello`, `# Hello World!` → `hello-world`) for heading linking. Used by HeadingChunker to annotate chunks with their section context.

## Risks / Trade-offs

- **chokidar + Bun compatibility**: chokidar uses `fsevents` on macOS and `ReadDirectoryChangesW` on Windows. Bun's Node.js compatibility layer should support these, but test on all platforms.
- **pino speed vs. dev experience**: pino is fast but only outputs JSON by default. Mitigation: use `pino-pretty` in `.indeX/config.json` for development, JSON for production.
