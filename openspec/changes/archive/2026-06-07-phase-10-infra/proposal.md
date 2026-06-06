## Why

Several infrastructure pieces are needed across the system but don't fit in earlier phases: a production-grade watcher for file changes (chokidar), a structured logger (pino), and a Markdown AST parser for heading-based chunking (remark). Without these, the watcher use case has no implementation, the system has no observability, and the heading chunker has no heading extraction.

## What Changes

- Create `src/infrastructure/watcher/ChokidarWatcher.ts` — chokidar-based FileWatcher with add/change/unlink events and 500ms debounce
- Create `tests/infrastructure/watcher/ChokidarWatcher.test.ts` before implementation (RED → GREEN)
- Create `src/infrastructure/logger/PinoLogger.ts` — structured logging with pino
- Create `src/infrastructure/logger/SilentLogger.ts` — no-op logger for tests
- Create `tests/infrastructure/logger/Logger.test.ts` before implementation (tests both loggers)
- Create `src/infrastructure/markdown/MarkdownAstParser.ts` — remark-based heading extractor for HeadingChunker
- Create `tests/infrastructure/markdown/MarkdownAstParser.test.ts` before implementation

## Capabilities

### New Capabilities
- `chokidar-watcher`: File system watcher implementing `FileWatcher` port — `add`, `change`, `unlink` events with 500ms debounce and start/stop lifecycle
- `pino-logger`: Structured JSON logger implementing `Logger` port via pino, with `child()` context support
- `silent-logger`: No-op logger implementing `Logger` port for test environments
- `markdown-ast-parser`: Remark-based heading extraction (level, text, anchor) for the HeadingChunker

### Modified Capabilities
- None

## Impact

- Adds 4 implementation files across `src/infrastructure/watcher/`, `logger/`, `markdown/`
- Adds 3 test files in `tests/infrastructure/`
- New dependencies: `chokidar` (file watching), `pino` + `pino-pretty` (logging)
- Depends on Phase 1 (FileWatcher, Logger port interfaces)
- Used by Phase 4 (HeadingChunker needs MarkdownAstParser), Phase 9 (WatchUseCase needs ChokidarWatcher, Logger used everywhere)
