# План разработки IndeX (TDD, инкрементально)

> **Принцип:** каждый модуль = RED (тест) → GREEN (реализация) → TEST (запуск) → REFACTOR.
> Никаких «написать всё сразу». После каждого шага — `bun test` зелёный.

---

## 📦 Фаза 0 — Инициализация проекта

### Шаг 0.1 — Bun + TypeScript + базовые конфиги
**RED:** — (нет тестов, это настройка)
**GREEN:**
```bash
bun init -y                 # package.json
# tsconfig.json — strict mode, paths
# .gitignore — node_modules, .indeX/data, dist
# bun.lock
```
**TEST:** `bun run src/index.ts` → выводит "IndeX started"

### Шаг 0.2 — Структура папок и заглушки
```bash
mkdir -p src/{domain/{systems,ports,services},application/di,infrastructure/{chunking,embedding,context,hashing,lancedb,parser,watcher,logger},presentation/{cli,api,web},config}
mkdir -p tests/{domain/{systems,services},infrastructure/{chunking,embedding,context,hashing,lancedb,parser,config},application,fixtures,mocks/fixtures}
```
**TEST:** `ls` структуры — все папки созданы.

### Шаг 0.3 — bun test настроен
**GREEN:** minimal `tests/example.test.ts`
```typescript
import { describe, it, expect } from 'bun:test'
describe('setup', () => {
  it('works', () => expect(1 + 1).toBe(2))
})
```
**TEST:** `bun test` — 1 passed.

---

## 🧱 Фаза 1 — Domain: типы + интерфейсы (core)

### Шаг 1.1 — `domain/types.ts` — общие типы данных
**RED:** `tests/domain/types.test.ts`
- `SourceData` создаётся с минимальными полями
- `SearchQuery` c mode/tags/top_k
- `SearchResult` с source/score/match_type
- `ParsedSource` с type/path/content/tags/metadata
- `IndexStats` со всеми полями
- `SourceMetadata` discriminated union: CodeMetadata, MarkdownMetadata, ObsidianMetadata, GenericMetadata
- SourceType маппинг (typescript → code и т.д.)

**GREEN:** `src/domain/types.ts`

```bash
bun test tests/domain/types.test.ts
```
✅ **CHECK:** все тесты зелёные

### Шаг 1.2 — `domain/ast.ts` — AST-модель
**RED:** `tests/domain/ast.test.ts`
- `FileIndex` — path, file_blake3, language, symbols
- `SymbolDetail` — kind, name, signature, позиции
- `Import` / `Export` — source, imported, isDefault
- `Relationship` — type, sourceFile, targetFile
- `SymbolKind` — function, class, interface, type, enum...

**GREEN:** `src/domain/ast.ts`

```bash
bun test tests/domain/ast.test.ts
```
✅ **CHECK:** все тесты зелёные

### Шаг 1.3 — `domain/ports/*` — интерфейсы портов
**RED:** `tests/domain/ports/source-repository.test.ts` (контракты)
- `SourceRepository` — все методы (upsert, upsertBatch, delete, search, ...)
- `SourceParser` — type, extensions, supportsFile, parse
- `SourceParserRegistry` — getParser, register, getEnabledParsers
- `FileWatcher` — on, start, stop
- `FileFilter` — formats, include, exclude
- `Logger` — info, warn, error, debug

**GREEN:** 6 файлов:
- `src/domain/ports/SourceRepository.ts`
- `src/domain/ports/SourceParser.ts`
- `src/domain/ports/SourceParserRegistry.ts`
- `src/domain/ports/FileWatcher.ts`
- `src/domain/ports/FileFilter.ts`
- `src/domain/ports/Logger.ts`

```bash
bun test tests/domain/ports/
```
✅ **CHECK:** контракты TypeScript-валидны

### Шаг 1.4 — `domain/systems/*` — интерфейсы систем
**RED:** `tests/domain/systems/`
- `ChunkingSystem.test.ts` — Chunker, ChunkerPipeline интерфейсы
- `EmbeddingSystem.test.ts` — Embedder, EmbedderCache, EmbedderRegistry интерфейсы
- `ContextPackagingSystem.test.ts` — Deduplicator, Tokenizer, ContextPacker
- `HashingSystem.test.ts` — Hasher, TokenEstimator

**GREEN:** 4 файла:
- `src/domain/systems/ChunkingSystem.ts`
- `src/domain/systems/EmbeddingSystem.ts`
- `src/domain/systems/ContextPackagingSystem.ts`
- `src/domain/systems/HashingSystem.ts`

```bash
bun test tests/domain/systems/
```
✅ **CHECK:** все интерфейсы валидны

---

## 🔐 Фаза 2 — Hashing (фундамент для dedup)

### Шаг 2.1 — `MockHasher` для тестов
**GREEN:** `tests/mocks/MockHasher.ts`
```typescript
class MockHasher implements Hasher {
  hash(data: string): Promise<string> {
    const hash = require('crypto').createHash('sha256').update(data).digest('hex')
    return Promise.resolve(hash)
  }
  hashFile(path: string): Promise<string> { ... }
}
```

### Шаг 2.2 — `BLAKE3Hasher`
**RED:** `tests/infrastructure/hashing/BLAKE3Hasher.test.ts`
- hash("hello") возвращает 32-байтовую hex-строку
- hash("hello") !== hash("world")
- hashFile возвращает тот же хеш, что и hash(content файла)
- hash пустой строки

**GREEN:** `src/infrastructure/hashing/BLAKE3Hasher.ts`
- `hash-wasm` → BLAKE3
- `hashFile` — streaming через `Bun.file()`

```bash
bun test tests/infrastructure/hashing/BLAKE3Hasher.test.ts
```
✅ **CHECK:** BLAKE3 работает

### Шаг 2.3 — `TokenEstimatorSimple`
**RED:** `tests/infrastructure/hashing/TokenEstimatorSimple.test.ts`
- estimate("hello") ≈ 1-2 токена (bytes/4)
- estimate("") = 0
- estimate длинного текста корректен

**GREEN:** `src/infrastructure/hashing/TokenEstimatorSimple.ts`

```bash
bun test tests/infrastructure/hashing/TokenEstimatorSimple.test.ts
```

### Шаг 2.4 — `TokenEstimatorTiktoken`
**RED:** `tests/infrastructure/hashing/TokenEstimatorTiktoken.test.ts`
- estimate с tiktoken точен
- fallback на Simple, если tiktoken не установлен

**GREEN:** `src/infrastructure/hashing/TokenEstimatorTiktoken.ts`

```bash
bun test tests/infrastructure/hashing/
```
✅ **CHECK:** все хешеры работают

---

## 📝 Фаза 3 — Parsing (разбор файлов)

### Шаг 3.1 — Тестовые фикстуры
**GREEN:** `tests/fixtures/`
- `simple-note.md` — простой Markdown
- `obsidian-note.md` — Obsidian с frontmatter + [[wiki-links]]
- `note-with-tags.md` — теги в frontmatter
- `sample-function.ts` — TypeScript функция
- `sample-class.py` — Python класс (опционально)

### Шаг 3.2 — `MarkdownParser`
**RED:** `tests/infrastructure/parser/MarkdownParser.test.ts`
- Парсит simple-note.md → title (H1), content, tags
- `metadata.headings` содержит структуру заголовков
- `metadata.links` — внешние и внутренние ссылки
- `metadata.stats` — wordCount, readingTimeMinutes, paragraphCount
- Без frontmatter → корректный ParsedSource

**GREEN:** `src/infrastructure/parser/MarkdownParser.ts`
- `remark` + unified для AST-парсинга
- Извлечение H1 → title, H2+ → headings
- Извлечение ссылок из AST

```bash
bun test tests/infrastructure/parser/MarkdownParser.test.ts
```

### Шаг 3.3 — `ObsidianParser`
**RED:** `tests/infrastructure/parser/ObsidianParser.test.ts`
- Парсит obsidian-note.md → title из frontmatter
- `metadata.wikiLinks` — [[target]] и [[target|alias]]
- `metadata.frontmatter` — YAML-поля
- `metadata.tags` из frontmatter.tags
- content без frontmatter

**GREEN:** `src/infrastructure/parser/ObsidianParser.ts`
- YAML frontmatter через `yaml` парсер
- `[[wiki-links]]` через регулярное выражение
- Backlinks и graphConnections — НЕ заполняются здесь (пустые массивы)

```bash
bun test tests/infrastructure/parser/ObsidianParser.test.ts
```

### Шаг 3.4 — `AstGrepParser` (code)
**RED:** `tests/infrastructure/parser/AstGrepParser.test.ts`
- Парсит sample-function.ts → symbols (функции, классы)
- `metadata.language` = 'typescript'
- `metadata.topLevelDeclarations` — имена функций/классов
- `metadata.complexity` — строки, функции, классы
- `ast` — FileIndex с imports/exports/symbols

**GREEN:** `src/infrastructure/parser/AstGrepParser.ts`
- Использует ast-grep для парсинга TypeScript
- Извлекает функции, классы, интерфейсы
- Собирает imports/exports

```bash
bun test tests/infrastructure/parser/AstGrepParser.test.ts
```

### Шаг 3.5 — `ParserRegistry`
**RED:** `tests/infrastructure/parser/ParserRegistry.test.ts`
- register() добавляет парсер
- getParser(".md") → MarkdownParser (или ObsidianParser для Obsidian-файлов)
- getParser(".ts") → AstGrepParser
- getParser(".py") → null (если не зарегистрирован)
- getEnabledParsers() → только включённые
- Двухфазный выбор для .md: frontmatter → ObsidianParser, иначе → MarkdownParser

**GREEN:** `src/infrastructure/parser/ParserRegistry.ts`

```bash
bun test tests/infrastructure/parser/
```
✅ **CHECK:** все парсеры + registry зелёные

---

## ✂️ Фаза 4 — Chunking (нарезка текста)

### Шаг 4.1 — Моки для тестов
**GREEN:** `tests/mocks/MockChunker.ts`, `MockTokenEstimator.ts`

### Шаг 4.2 — `HeadingChunker`
**RED:** `tests/infrastructure/chunking/HeadingChunker.test.ts`
- Делит md-текст по заголовкам H1/H2+
- Блок ≤ max_tokens → один чанк
- `core_content` — тело секции без overlap
- Каждый чанк имеет chunk_index и total_chunks

**GREEN:** `src/infrastructure/chunking/HeadingChunker.ts`
- Использует `MarkdownAstParser` (remark) для извлечения заголовков

```bash
bun test tests/infrastructure/chunking/HeadingChunker.test.ts
```

### Шаг 4.3 — `ParagraphChunker`
**RED:** `tests/infrastructure/chunking/ParagraphChunker.test.ts`
- Делит по пустым строкам
- Абзац ≤ max_tokens → чанк
- Абзац > max_tokens → рекурсивно вызывает SentenceChunker

**GREEN:** `src/infrastructure/chunking/ParagraphChunker.ts`

```bash
bun test tests/infrastructure/chunking/ParagraphChunker.test.ts
```

### Шаг 4.4 — `SentenceChunker`
**RED:** `tests/infrastructure/chunking/SentenceChunker.test.ts`
- Делит по .!? с защитой аббревиатур (Mr., Dr., etc.)
- Не режет предложение
- Предложение > max_tokens → OverflowChunker

**GREEN:** `src/infrastructure/chunking/SentenceChunker.ts`

```bash
bun test tests/infrastructure/chunking/SentenceChunker.test.ts
```

### Шаг 4.5 — `OverflowChunker`
**RED:** `tests/infrastructure/chunking/OverflowChunker.test.ts`
- Принудительная резка по границе токенов
- min_tokens проверка

**GREEN:** `src/infrastructure/chunking/OverflowChunker.ts`

```bash
bun test tests/infrastructure/chunking/OverflowChunker.test.ts
```

### Шаг 4.6 — `CodeChunker`
**RED:** `tests/infrastructure/chunking/CodeChunker.test.ts`
- Функция → один чанк (неделимая единица)
- Класс → один чанк
- Нет overlap для кода

**GREEN:** `src/infrastructure/chunking/CodeChunker.ts`

```bash
bun test tests/infrastructure/chunking/CodeChunker.test.ts
```

### Шаг 4.7 — `ChunkerFactory` + `ChunkerPipeline`
**RED:** `tests/infrastructure/chunking/ChunkerFactory.test.ts`
- `createPipeline(['heading', 'paragraph', 'sentence', 'overflow'])` создаёт pipeline
- Pipeline: heading → fallback → paragraph → fallback → sentence → overflow
- Merge соседних чанков < 50 токенов
- Overlap 32 токена между чанками

**GREEN:** 
- `src/infrastructure/chunking/ChunkerFactory.ts`
- Pipeline implementation

```bash
bun test tests/infrastructure/chunking/
```
✅ **CHECK:** все чанкеры работают как pipeline

---

## 🧬 Фаза 5 — Embedding (векторизация)

### Шаг 5.1 — Моки
**GREEN:** `tests/mocks/MockEmbedder.ts`, `MockEmbedderRegistry.ts`

### Шаг 5.2 — `EmbedderCacheLRU`
**RED:** `tests/infrastructure/embedding/EmbedderCacheLRU.test.ts`
- get/set/has работают
- Ключ = `${model}:${hash}`
- LRU eviction при переполнении

**GREEN:** `src/infrastructure/embedding/EmbedderCacheLRU.ts`

```bash
bun test tests/infrastructure/embedding/EmbedderCacheLRU.test.ts
```

### Шаг 5.3 — `OllamaEmbedder`
**RED:** `tests/infrastructure/embedding/OllamaEmbedder.test.ts`
- **Unit:** embed() вызывает /api/embeddings
- **Unit:** embedBatch() — один HTTP запрос с массивом
- **Unit:** exponential backoff при ошибке
- **Unit:** AbortSignal → graceful shutdown
- **Integration (manual):** embed("hello") → Float32Array(384)

**GREEN:** `src/infrastructure/embedding/OllamaEmbedder.ts`
- HTTP-клиент к Ollama API
- Batch: POST /api/embeddings с массивом строк
- Retry с exponential backoff 1s → 2s → 4s

```bash
bun test tests/infrastructure/embedding/OllamaEmbedder.test.ts
```

### Шаг 5.4 — `LanceDbEmbedder` (fallback)
**RED:** `tests/infrastructure/embedding/LanceDbEmbedder.test.ts`
- Возвращает zero-вектор заданной размерности
- Позволяет ANN-поиск без Ollama (graceful degradation)

**GREEN:** `src/infrastructure/embedding/LanceDbEmbedder.ts`

### Шаг 5.5 — `CachedEmbedder` (proxy-декоратор)
**RED:** `tests/infrastructure/embedding/CachedEmbedder.test.ts`
- Проверяет кэш перед вызовом inner embedder
- Cache hit → не вызывает inner
- Cache miss → вызывает inner, сохраняет в кэш
- Ключ = model.name + BLAKE3(text)

**GREEN:** `src/infrastructure/embedding/CachedEmbedder.ts`

```bash
bun test tests/infrastructure/embedding/CachedEmbedder.test.ts
```

### Шаг 5.6 — `MultiModelEmbedder`
**RED:** `tests/infrastructure/embedding/MultiModelEmbedder.test.ts`
- Вызывает несколько embedder'ов параллельно
- Возвращает Record<modelName, Embedding>
- Один embedder упал → остальные работают (allSettled)

**GREEN:** `src/infrastructure/embedding/MultiModelEmbedder.ts`

```bash
bun test tests/infrastructure/embedding/MultiModelEmbedder.test.ts
```

### Шаг 5.7 — `NullEmbedder`
**RED:** `tests/infrastructure/embedding/NullEmbedder.test.ts`
- Всегда кидает "no embedder available"

**GREEN:** `src/infrastructure/embedding/NullEmbedder.ts`

### Шаг 5.8 — `EmbedderRegistryImpl`
**RED:** `tests/infrastructure/embedding/EmbedderRegistry.test.ts`
- getEmbedder("typescript") → модель с min priority для этого source_type
- getEmbedders("typescript") → все подходящие модели
- getUniversalEmbedder() → модель без source_types
- isAvailable() → false, если нет моделей

**GREEN:** `src/infrastructure/embedding/EmbedderRegistryImpl.ts`

```bash
bun test tests/infrastructure/embedding/
```
✅ **CHECK:** вся система эмбеддинга работает

---

## 📦 Фаза 6 — Context Packaging (RAG)

### Шаг 6.1 — `BLAKE3Deduplicator`
**RED:** `tests/infrastructure/context/BLAKE3Deduplicator.test.ts`
- Дубликаты по semantic_blake3 удаляются
- Из дубликатов остаётся с max score
- O(n) через Map

**GREEN:** `src/infrastructure/context/BLAKE3Deduplicator.ts`

```bash
bun test tests/infrastructure/context/BLAKE3Deduplicator.test.ts
```

### Шаг 6.2 — `GPTCodeTokenizer`
**RED:** `tests/infrastructure/context/GPCTokenizer.test.ts`
- count("hello world") → число токенов
- truncate(text, 50) → обрезает до 50 токенов
- Не режет посередине слова (если возможно)

**GREEN:** `src/infrastructure/context/GPTCodeTokenizer.ts`

```bash
bun test tests/infrastructure/context/GPCTokenizer.test.ts
```

### Шаг 6.3 — `RAGContextPacker`
**RED:** `tests/infrastructure/context/RAGContextPacker.test.ts`
- pack(results) → dedup → сортировка → обрезка → markdown
- `truncated: true` при превышении max_tokens
- `format: 'rag'` — с system prompt для LLM
- `source_notes` — список уникальных файлов

**GREEN:** `src/infrastructure/context/RAGContextPacker.ts`

```bash
bun test tests/infrastructure/context/
```
✅ **CHECK:** контекст-пакер готов

---

## 🗄️ Фаза 7 — Database Layer (LanceDB)

### Шаг 7.1 — `MockSourceRepository`
**GREEN:** `tests/mocks/MockSourceRepository.ts`
- In-memory реализация SourceRepository
- Все методы (upsert, search, delete, stats, ...)
- Для unit-тестов сервисов и use case'ов

### Шаг 7.2 — `LanceDbSourceRepository`
**RED:** `tests/infrastructure/lancedb/LanceDbSourceRepository.test.ts`
- **Unit (in-memory LanceDB):**
  - upsert → запись в таблицу sources
  - getById / getByPath / getBySourceId
  - upsertBatch → массовая запись
  - delete / deleteBySourceId / deleteByPath
  - search — поиск по векторным колонкам
  - hasSemanticBlake3 / hasModelEmbedding
  - getSourceIdsByHash / getFileBlake3ByPath
  - stats — total_sources, total_chunks, ...
- **FileIndex:**
  - upsertFileIndex / getFileIndex / deleteFileIndex

**GREEN:** `src/infrastructure/lancedb/LanceDbSourceRepository.ts`
- Две таблицы: `sources` и `file_index`
- Multi-column: vect_{model_name} для каждой модели
- Hybrid search: ANN + FTS (BM25)

```bash
bun test tests/infrastructure/lancedb/LanceDbSourceRepository.test.ts
```
✅ **CHECK:** БД работает (in-memory mode)

---

## 🧠 Фаза 8 — Domain Services (бизнес-логика)

### Шаг 8.1 — `IndexingService`
**RED:** `tests/domain/services/IndexingService.test.ts`
- **Mock-режим (без реальных парсеров/эмбеддеров):**
  - Сканирование директории → список файлов (с моковым FileFilter)
  - Для каждого файла: парсинг → чанкинг → эмбеддинг → upsert
  - Пропуск по exclude-паттернам
  - multi-model эмбеддинг

**GREEN:** `src/domain/services/IndexingService.ts`

```bash
bun test tests/domain/services/IndexingService.test.ts
```

### Шаг 8.2 — `SearchService`
**RED:** `tests/domain/services/SearchService.test.ts`
- **Mock-режим:**
  - Semantic search (Ollama → ANN)
  - Keyword search (FTS/BM25)
  - Hybrid search (взвешенная комбинация)
  - Post-filter по tags/type/date
  - Multi-model: результаты сливаются, hybrid_weight усредняется
  - Нормализация BM25: (bm25 - min)/(max - min)

**GREEN:** `src/domain/services/SearchService.ts`

```bash
bun test tests/domain/services/SearchService.test.ts
```

### Шаг 8.3 — `DiffIndexingService`
**RED:** `tests/domain/services/DiffIndexingService.test.ts`
- file_blake3 совпадает → пропуск
- file_blake3 отличается → перепарсить, перечанкировать, переэмбеддить
- semantic_blake3 чанка есть в другом файле → не удалять
- Перестроение FileIndex

**GREEN:** `src/domain/services/DiffIndexingService.ts`

```bash
bun test tests/domain/services/
```
✅ **CHECK:** все сервисы работают с моками

---

## 🎯 Фаза 9 — Application Use Cases

### Шаг 9.1 — `di/Systems.ts`
**GREEN:** `src/application/di/Systems.ts`
- IndexSystems, SearchSystems, PackSystems, ChunkSystems, EmbedSystems

### Шаг 9.2 — `ConfigLoader`
**RED:** `tests/infrastructure/config/ConfigLoader.test.ts`
- load() → валидация .indeX/config.json
- loadOrDefault() → defaults при отсутствии файла
- Ошибка при битом JSON
- Валидация моделей эмбеддинга

**GREEN:** `src/config/ConfigLoader.ts`
- zod-схема полного конфига
- Валидация universal_model в models[]

```bash
bun test tests/infrastructure/config/ConfigLoader.test.ts
```

### Шаг 9.3 — `IndexUseCase`
**RED:** `tests/application/IndexUseCase.test.ts`
- execute("./vault") → полный цикл с реальными системами через DI
- Mock SourceRepository + ParserRegistry + Chunker + Embedder

**GREEN:** `src/application/IndexUseCase.ts`

```bash
bun test tests/application/IndexUseCase.test.ts
```

### Шаг 9.4 — `SearchUseCase`
**RED:** `tests/application/SearchUseCase.test.ts`
- search("query", { mode: "hybrid" }) → SearchResult[]

**GREEN:** `src/application/SearchUseCase.ts`

```bash
bun test tests/application/SearchUseCase.test.ts
```

### Шаг 9.5 — `PackUseCase`
**RED:** `tests/application/PackUseCase.test.ts`
- pack("./vault") → PackResult
- Фильтрация include/exclude
- Конкатенация в .md

**GREEN:** `src/application/PackUseCase.ts`

```bash
bun test tests/application/PackUseCase.test.ts
```

### Шаг 9.6 — `ChunkUseCase`
**RED:** `tests/application/ChunkUseCase.test.ts`
- chunk("./vault", { strategy: "heading" }) → Chunk[]

**GREEN:** `src/application/ChunkUseCase.ts`

### Шаг 9.7 — `EmbedUseCase`
**RED:** `tests/application/EmbedUseCase.test.ts`
- embed({ source: "chunks" }) → upsert в LanceDB
- embed({ source: "files" }) → chunk + embed

**GREEN:** `src/application/EmbedUseCase.ts`

### Шаг 9.8 — `WatchUseCase` + `DeleteUseCase`
**RED:** `tests/application/WatchUseCase.test.ts`
- watch("./vault") → старт FileWatcher
- onChange → DiffIndexingService

**GREEN:** 
- `src/application/WatchUseCase.ts`
- `src/application/DeleteUseCase.ts`

```bash
bun test tests/application/
```
✅ **CHECK:** все use case'ы работают

---

## 🔌 Фаза 10 — Infra (watcher, logger, markdown)

### Шаг 10.1 — `ChokidarWatcher`
**RED:** `tests/infrastructure/watcher/ChokidarWatcher.test.ts`
- on('add') / on('change') / on('unlink')
- start() / stop()
- debounce 500ms

**GREEN:** `src/infrastructure/watcher/ChokidarWatcher.ts`

### Шаг 10.2 — `PinoLogger` + `SilentLogger`
**RED:** `tests/infrastructure/logger/Logger.test.ts`
- PinoLogger: info/warn/error/debug логирует
- SilentLogger: ничего не выводит
- child() — контекстный логгер

**GREEN:**
- `src/infrastructure/logger/PinoLogger.ts`
- `src/infrastructure/logger/SilentLogger.ts`

### Шаг 10.3 — `MarkdownAstParser`
**RED:** `tests/infrastructure/markdown/MarkdownAstParser.test.ts`
- Извлекает заголовки из .md (для HeadingChunker)

**GREEN:** `src/infrastructure/markdown/MarkdownAstParser.ts`

---

## 🧩 Фаза 11 — DI + Integration

### Шаг 11.1 — `index.ts` (DI-контейнер)
**GREEN:** `src/index.ts`
- Загрузка конфига
- Создание парсеров + регистрация
- Создание чанкеров
- Создание EmbedderRegistry из конфига
- Сборка сервисов и use case'ов

### Шаг 11.2 — Интеграционный тест
**RED:** `tests/integration/full-cycle.test.ts`
- real MarkdownParser + HeadingChunker + MockEmbedder + MockSourceRepository
- index → search → pack — полный цикл

---

## 🖥️ Фаза 12 — CLI + API

### Шаг 12.1 — CLI (все команды)
**RED:** Тесты команд CLI
**GREEN:** `src/presentation/cli/cli.ts`
```bash
indeX index ./fixtures
indeX search "test"
indeX pack ./fixtures -o bundle.md
indeX chunk ./fixtures
indeX embed ./fixtures
indeX watch ./fixtures
indeX stats
```

### Шаг 12.2 — HTTP API (Hono)
**RED:** Тесты API-эндпоинтов
**GREEN:** `src/presentation/api/server.ts`
```
GET  /api/search?q=...
GET  /api/stats
POST /api/index
```

### Шаг 12.3 — Web UI (SPA)
**GREEN:** `src/presentation/web/`

---

## 🧪 Итоговые проверки

```bash
bun test                    # Все тесты зелёные
bun test --coverage         # Покрытие > 80%
bun run indeX index ./tests/fixtures  # Реальная индексация
bun run indeX search "test"           # Реальный поиск
```

---

## 📊 Диаграмма зависимостей (порядок разработки)

```
Фаза 0 (Инициализация)
   │
   ▼
Фаза 1 (Domain: типы + интерфейсы) — без зависимостей
   │
   ▼
Фаза 2 (Hashing) — зависит от: Фаза 1
   │
   ▼
Фаза 3 (Parsing) — зависит от: Фаза 1, Фаза 2 (BLAKE3)
   │
   ▼
Фаза 4 (Chunking) — зависит от: Фаза 1, Фаза 2 (TokenEstimator)
   │
   ▼
Фаза 5 (Embedding) — зависит от: Фаза 1, Фаза 2 (BLAKE3)
   │
   ▼
Фаза 6 (Context) — зависит от: Фаза 1, Фаза 2
   │
   ▼
Фаза 7 (LanceDB) — зависит от: Фаза 1
   │
   ▼
Фаза 8 (Services) — зависит от: Фаза 2-7 (все)
   │
   ▼
Фаза 9 (Use Cases) — зависит от: Фаза 8
   │
   ▼
Фаза 10 (Infra) — зависит от: Фаза 1
   │
   ▼
Фаза 11 (DI) — зависит от: Фаза 9, Фаза 10
   │
   ▼
Фаза 12 (CLI/API) — зависит от: Фаза 11
```

---

## ⚡ Быстрый старт (первые шаги в коде)

```bash
# 1. Инициализация
bun init -y
bun add -d typescript @types/bun
bun add hash-wasm zod remark remark-frontmatter remark-gfm yaml

# 2. Создать тестовые фикстуры
# 3. src/domain/types.ts → tests/domain/types.test.ts
# 4. bun test --watch
```

**Ключевое правило:** каждый шаг = `bun test` зелёный перед переходом к следующему.
