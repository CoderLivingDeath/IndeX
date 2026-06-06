## 1. ChokidarWatcher

- [x] 1.1 Install `chokidar` dependency
- [x] 1.2 **RED**: Write `tests/infrastructure/watcher/ChokidarWatcher.test.ts` — adds file → 'add' event emitted, changes file → 'change' event emitted, deletes file → 'unlink' event emitted, start()/stop() lifecycle works, debounce fires once within 500ms
- [x] 1.3 **GREEN**: Create `src/infrastructure/watcher/ChokidarWatcher.ts` — implements `FileWatcher`, wraps chokidar with 500ms debounce
- [x] 1.4 **TEST**: Run `bun test tests/infrastructure/watcher/ChokidarWatcher.test.ts` — all tests pass

## 2. PinoLogger + SilentLogger

- [x] 2.1 Install `pino` and `pino-pretty` dependencies
- [x] 2.2 **RED**: Write `tests/infrastructure/logger/Logger.test.ts` — PinoLogger.info/warn/error/debug output structured JSON, PinoLogger.child() adds context, SilentLogger produces no output for all methods
- [x] 2.3 **GREEN**: Create `src/infrastructure/logger/PinoLogger.ts` — implements `Logger` via pino, child() creates child logger with context
- [x] 2.4 **GREEN**: Create `src/infrastructure/logger/SilentLogger.ts` — implements `Logger`, all methods are no-ops
- [x] 2.5 **TEST**: Run `bun test tests/infrastructure/logger/Logger.test.ts` — all tests pass

## 3. MarkdownAstParser

- [x] 3.1 **RED**: Write `tests/infrastructure/markdown/MarkdownAstParser.test.ts` — extracts headings (level/text/anchor) from Markdown, returns empty array for text without headings, anchor slugs match GitHub convention
- [x] 3.2 **GREEN**: Create `src/infrastructure/markdown/MarkdownAstParser.ts` — use `remark` to parse Markdown AST, extract heading nodes with level/text/anchor
- [x] 3.3 **TEST**: Run `bun test tests/infrastructure/markdown/MarkdownAstParser.test.ts` — all tests pass
