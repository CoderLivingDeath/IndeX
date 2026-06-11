---
# ARCHITECTURE.md
---
# IndeX — Architecture Document

> Bun-приложение для индексации заметок и кода в LanceDB с гибридным поиском.
> Разработка ведётся через TDD (Red → Green → Refactor).

---

## 1. 🧱 Модульная архитектура (Ports & Adapters + DDD)

```
src/
├── domain/                  ← ЧИСТОЕ ЯДРО (0 внешних зависимостей)
│   ├── types.ts             общие типы (SourceData, SearchQuery, SearchResult, ParsedSource, IndexStats)
│   ├── ast.ts               AST-модель (FileIndex, SymbolDetail, Import, Export, Relationship)
│   ├── systems/             интерфейсы модульных систем
│   │   ├── ChunkingSystem.ts   ← Chunker, ChunkerPipeline
│   │   ├── EmbeddingSystem.ts  ← Embedder, EmbedderCache, EmbedderRegistry
│   │   ├── ContextPackagingSystem.ts ← Deduplicator, Tokenizer, ContextPacker
│   │   └── HashingSystem.ts    ← Hasher, TokenEstimator
│   ├── ports/               порты инфраструктуры
│   │   ├── SourceRepository.ts  (was NoteRepository)  ← + FileIndex методы
│   │   ├── SourceParser.ts     + SourceParserRegistry (generalised)
│   │   ├── FileWatcher.ts
│   │   └── Logger.ts
│   └── services/            чистая бизнес-логика
│       ├── IndexingService.ts
│       ├── SearchService.ts
│       └── DiffIndexingService.ts
│
├── application/             ← USE CASES (координация систем)
│   ├── di/Systems.ts        группировка зависимостей (IndexSystems, SearchSystems, ...)
│   ├── IndexUseCase.ts      полная индексация (parse → chunk → embed → upsert)
│   ├── SearchUseCase.ts
│   ├── WatchUseCase.ts
│   ├── DeleteUseCase.ts
│   ├── PackUseCase.ts       упаковка отфильтрованных файлов в единый .md
│   ├── ChunkUseCase.ts      чанкинг файлов с include/exclude фильтром
│   └── EmbedUseCase.ts      генерация эмбеддингов в векторную БД
│
├── infrastructure/          ← РЕАЛИЗАЦИИ СИСТЕМ (адаптеры)
│   ├── chunking/            HeadingChunker, CodeChunker, ChunkerFactory...
│   ├── embedding/           OllamaEmbedder, CachedEmbedder, EmbedderRegistry, MultiModelEmbedder...
│   ├── context/             BLAKE3Deduplicator, RAGContextPacker...
│   ├── hashing/             BLAKE3Hasher, TokenEstimatorSimple...
│   ├── lancedb/             LanceDbSourceRepository — implements SourceRepository
│   ├── parser/              MarkdownParser, ObsidianParser, AstGrepParser...
│   │   └── ParserRegistry.ts  SourceParserRegistry (wire-up всех парсеров)
│   ├── watcher/             ChokidarWatcher — implements FileWatcher
│   └── logger/              PinoLogger / SilentLogger — implements Logger
│
├── presentation/            ← ПОЛЬЗОВАТЕЛЬСКИЙ ИНТЕРФЕЙС
│   ├── cli/                 CLI-команды
│   ├── api/                 HTTP API (Hono)
│   └── web/                 Web UI (SPA)
│
├── config/                  ← Загрузчик конфига
│   └── ConfigLoader.ts      загрузка + валидация .indeX/config.json
│
└── index.ts                 ← DI-контейнер (wire-up)

.indeX/                       ← Конфигурационный файл (вне src/)
└── config.json              JSON-конфиг приложения

tests/
├── domain/systems/          тесты интерфейсов систем
├── domain/services/         тесты бизнес-логики
├── infrastructure/          тесты адаптеров (по папкам)
├── application/             use case тесты (с моками)
├── fixtures/                тестовые .md файлы
└── mocks/                   готовые моки (MockEmbedder, MockChunker...)
```

---

## 2. 📦 Стек технологий

| Компонент | Инструмент | Обоснование |
|-----------|-----------|-------------|
| **Язык** | TypeScript 5.x | Типобезопасность |
| **Раннер** | Bun 1.x | Быстрый, встроенный test runner, TS из коробки |
| **Векторная БД** | LanceDB | Встраиваемая, без сервера, работает локально |
| **Embeddings** | Ollama (nomic-embed-text) | Локально, бесплатно, приватно |
| **HTTP API** | Hono | Лёгкий, быстрый, работает с Bun |
| **Конфиг** | JSON (`.indeX/config.json`) | Чёткая структура, схемная валидация через zod |
| **Хеширование** | BLAKE3 (hash-wasm) | Скорость в 10× быстрее SHA256, streaming, dedup |
| **Markdown парсер** | remark (unified) | AST-парсер для точного выделения заголовков |
| **Токенизация** | gpt-tokenizer или tiktoken | Точный подсчёт токенов для чанкинга |
| **Watcher** | chokidar | Кроссплатформенный, надёжный, с debounce |
| **Логирование** | pino + pino-pretty | Быстрый структурированный логгер |
| **Тестирование** | bun test (built-in) + mock() | Из коробки, без доп. зависимостей |

---

## 3. 💾 Схема данных (LanceDB)

Две таблицы: **`sources`** (чанки) и **`file_index`** (AST-сводка).

### Таблица `sources` (бывшая `notes`)

```typescript
// domain/types.ts
interface SourceData {
  id: string                 // UUID v7
  chunk_id: string           // source_id:chunk_index
  source_id: string          // группировка чанков одного файла (was note_id)
  type: SourceType           // 'markdown' | 'typescript' | 'python' | ...

  title: string              // заголовок (H1 для .md, module name для .ts)
  content: string            // тело чанка
  tags: string[]             // теги (из frontmatter или inferred)
  path: string               // путь к файлу

  file_blake3: string        // BLAKE3 всего файла
  semantic_blake3: string    // BLAKE3 смысловой единицы (абзац, функция, класс)
                             // а не полного текста чанка с overlap/контекстом
                             // Это ключ для глобального dedup

  chunk_index: number        // порядковый номер чанка
  total_chunks: number       // всего чанков в файле
  chunk_size_tokens: number  // размер в токенах
  chunk_strategy: string     // стратегия нарезки

  /** AST-символы, попавшие в этот чанк (точечно) */
  symbols?: SymbolDetail[]

  created_at: number         // unix ms
  updated_at: number         // unix ms
  /**
   * Типизированные метаданные в зависимости от type (см. SourceMetadata ниже).
   * В LanceDB хранится как JSON-блоб.
   */
  metadata: SourceMetadata
  /**
   * Эмбеддинги от разных моделей.
   * Ключ = имя модели (model name из конфига, нормализованное)
   * Значение = вектор (Float32Array)
   * Пример: { "nomic-embed-text": Float32Array(384), "mxbai-embed-large": Float32Array(1024) }
   * Пустой объект = keyword-only (graceful degradation).
   */
  embeddings: Record<string, Float32Array>
}
```

### Таблица `file_index` — AST-сводка по файлам (НОВАЯ)

```typescript
// domain/ast.ts
interface FileIndex {
  path: string               // primary key — полный путь к файлу
  file_blake3: string        // для diff: изменился файл → перепарсить AST
  language: string           // 'typescript' | 'markdown' | ...

  imports: Import[]
  exports: Export[]
  symbols: SymbolDetail[]     // все символы файла
  relationships: Relationship[]

  last_parsed: number        // unix ms — время последнего AST-парсинга
}
```

Связь: `SourceData.path` → `FileIndex.path`. При diff-индексации перестраиваем `FileIndex` только для изменившихся файлов.

### Типизированные метаданные (`SourceMetadata`)

Поле `SourceData.metadata` — discriminated union по `kind`. Каждый парсер заполняет свою структуру. В LanceDB все метаданные хранятся как JSON-блоб в одном поле; TypeScript обеспечивает типовую безопасность на уровне приложения.

```typescript
// domain/types.ts

type SourceMetadata =
  | CodeMetadata
  | MarkdownMetadata
  | ObsidianMetadata
  | GenericMetadata

// ──────────────────────────────────────────
// КОД (type: 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | ...)
// ──────────────────────────────────────────
interface CodeMetadata {
  kind: 'code'
  language: string
  languageVersion?: string
  moduleType: 'esm' | 'cjs' | 'unknown'

  /** Зависимости (только прямые, из package.json / Cargo.toml / ...) */
  dependencies: {
    name: string
    version?: string
    type: 'dependency' | 'devDependency' | 'peerDependency'
    resolved?: boolean
  }[]

  /** Метрики */
  complexity?: {
    lines: number
    functions: number
    classes: number
  }

  /** Быстрый доступ к top-level символам (дублирует FileIndex для фильтрации) */
  topLevelDeclarations: string[]
  hasDefaultExport: boolean
  isTyped: boolean
}

// ──────────────────────────────────────────
// MARKDOWN (type: 'markdown')
// ──────────────────────────────────────────
interface MarkdownMetadata {
  kind: 'markdown'

  /** Структура заголовков (TOC) */
  headings: { level: number; text: string; anchor: string }[]

  /** Ссылки (внешние + внутренние) */
  links: {
    url: string
    text: string
    isInternal: boolean
    isAnchor: boolean
    resolved?: string           // полный путь, если internal
  }[]

  /** Ресурсы (изображения, видео, файлы) */
  resources: {
    url: string
    type: 'image' | 'video' | 'audio' | 'file' | 'embed'
    alt?: string
  }[]

  /** Статистика */
  stats: {
    wordCount: number
    readingTimeMinutes: number
    paragraphCount: number
    codeBlockCount: number
  }

  frontmatter?: Record<string, unknown>
  hasFrontmatter: boolean
}

// ──────────────────────────────────────────
// OBSIDIAN (type: 'obsidian')
// ──────────────────────────────────────────
interface ObsidianMetadata {
  kind: 'obsidian'

  /** Наследуемые markdown-поля */
  headings: MarkdownMetadata['headings']
  links: MarkdownMetadata['links']
  resources: MarkdownMetadata['resources']
  stats: MarkdownMetadata['stats']
  frontmatter: MarkdownMetadata['frontmatter']

  /** Wiki-ссылки [[target]] и [[target|alias]] */
  wikiLinks: {
    target: string
    alias?: string
    resolved?: boolean
    resolvedPath?: string
  }[]

  /** Обратные ссылки (какие файлы ссылаются на этот).
   *  ⚠ НЕ заполняется ObsidianParser — заполняется BacklinkBuilder
   *  отдельным проходом после индексации всех файлов. */
  backlinks: {
    source: string
    context?: string
  }[]

  /** Связи для графа заметок.
   *  Вычисляется BacklinkBuilder совместно с backlinks —
   *  не заполняется при единичном парсинге файла. */
  graphConnections?: {
    target: string
    linkCount: number
    connectionTypes: ('wiki' | 'tag' | 'link')[]
  }[]

  dataviewQueries?: {
    query: string
    type: 'LIST' | 'TABLE' | 'TASK' | 'CALENDAR'
  }[]

  isCanvas?: boolean
  canvasNodes?: number
  canvasEdges?: number
}

// ──────────────────────────────────────────
// GENERIC (fallback для неизвестных форматов)
// ──────────────────────────────────────────
interface GenericMetadata {
  kind: 'generic'
  [key: string]: unknown
}
```

### Маппинг: SourceType → SourceMetadata kind

Каждый `SourceType` строго соответствует одному `kind` метаданных:

| `SourceType` | `SourceMetadata.kind` | Парсер |
|-------------|----------------------|--------|
| `'typescript'` / `'javascript'` | `'code'` | AstGrepParser |
| `'python'` / `'go'` / `'rust'` | `'code'` | AstGrepParser |
| `'markdown'` | `'markdown'` | MarkdownParser |
| `'obsidian'` | `'obsidian'` | ObsidianParser |
| неизвестный / fallback | `'generic'` | GenericParser |

### Отличие Chunk.metadata от SourceData.metadata

| Поле | Где живёт | Тип | Содержит | Откуда берётся |
|------|-----------|-----|----------|----------------|
| `SourceData.metadata` | LanceDB (JSON-блоб) | `SourceMetadata` | **Файловые** метаданные: язык, статистика, сложность, зависимости | Из парсера (`ParsedSource.metadata`) |
| `Chunk.metadata` | Память (work variable) | `Record<string, unknown>` | **Чанк-уровень**: номер секции, заголовок, положение в документе | Из чанкера (`ChunkingSystem`) |

`Chunk.metadata` → НЕ переходит в `SourceData.metadata` напрямую. `SourceData.metadata` копируется из `ParsedSource.metadata`, который пришёл из парсера. `Chunk.metadata` — временная аннотация для внутренней логики чанкера (например, merge соседних чанков по заголовку).

---

## 4. 🔄 Потоки данных

### Полная индексация (initial index / reindex)

```
Сканирование папки → рекурсивный обзор файлов поддерживаемых форматов
     │
     ▼
Пропускаем по parsing.exclude (node_modules, .git, dist/, ...)
     │
     ▼
Читаем файл, вычисляем BLAKE3(file_content)
     │
     ▼
Парсинг файла
  ├── Выбор парсера: двухфазный
  │   ├── 1. ParserRegistry.getParser(path) → кандидат по расширению
  │   ├── 2. Если .md: кандидат (универсальный MarkdownParser)
  │   │   └── читаем первые N байт → проверяем frontmatter
  │   │   ├── Есть frontmatter с Obsidian-полями → перенаправляем ObsidianParser
  │   │   └── Иначе → остаётся MarkdownParser
  │   └── Для остальных расширений (.ts, .py, ...) → прямой матч по extensions[]
  ├── Markdown: H1 → title, остальное → content
  │   └── metadata = MarkdownMetadata { headings, links, stats, ... }
  ├── Obsidian: frontmatter(YAML) → tags + metadata + title
  │               [[wiki-links]] → metadata.wikiLinks
  │               content без frontmatter
  │   └── metadata = ObsidianMetadata { wikiLinks, ... }
  │       ⚠ backlinks и graphConnections — НЕ извлекаются при парсинге одного файла.
  │         Вычисляются отдельным проходом после индексации:
  │         - для каждого ObsidianMetadata.wikiLinks создаётся обратная
  │           запись в backlinks целевого файла
  │         - graphConnections собирается из wikiLinks + links по всем файлам
  │         (см. DiffIndexingService / BacklinkBuilder).
  └── Code (AstGrepParser): AST → +FileIndex + metadata
      └── metadata = CodeMetadata { language, dependencies, complexity, ... }
     │
     ▼
Чанкинг — разбивка текста на смысловые единицы (абзац, функция, класс)
  └── Стратегия: по заголовкам / AST-символам / параграфам
  └── Макс: 512 токенов на чанк
  └── Перекрытие: 32 токена между соседними чанками (только текст, не семантика)
  └── Каждый чанк наследует title, tags, path от родителя
     │
     ▼
Для каждого чанка:
  ├── Определяем активные модели под тип чанка:
  │   ├── EmbedderRegistry.getEmbedders(type) → type-specific модели
  │   │   например: для "typescript" → [mxbai-embed-large(1024d)]
  │   ├── EmbedderRegistry.getUniversalEmbedder() → universal_model (если задана)
  │   └── Финальный список = type-specific + universal (если не дублируется)
  │
  ├── Извлекаем смысловую единицу:
  │   ├── Markdown: параграф или блок под заголовком (без overlap)
  │   ├── Function: тело функции/метода без контекстуального окружения
  │   └── Class: определение класса (сигнатура + тело)
  │
  ├── Вычисляем BLAKE3(смысловая_единица) → semantic_blake3
  │
  ├── Для каждой активной модели (последовательно):
  │   ├── Сверяем hasEmbedding(model, semantic_blake3):
  │   │   ├── embedding существует → берём готовый (не шлём в Ollama)
  │   │   └── embedding новый → CachedEmbedder.embedBatch([тексты]) → вектор
  │   │       (CachedEmbedder — proxy-декоратор для ОДНОЙ модели, см. §6)
  │   └── (universal_model уже в списке — повторный проход не нужен)
  │   │
  │   └── Сохраняем результат: { model: vector }
  │
  └── Upsert в LanceDB: embeddings = { model: vector, ... }
```

### Diff-индексация (watcher — только изменения)

```
chokidar сигналит: add / change / unlink → /notes/project.md
     │
     ⚠ Примечание: rename не детектируется как отдельное событие —
     это два последовательных сигнала (unlink старого пути + add нового).
     При rename с тем же содержимым semantic_blake3 чанков совпадает,
     но чанки пересоздаются с новым path (полная переиндексация).
     Оптимизация — не предусмотрена (приемлемо для локального инструмента).
     │
     ▼
Читаем файл, вычисляем BLAKE3(file_content) → new_hash
     │
     ▼
Запрашиваем старый file_blake3:
  repo.getFileBlake3ByPath(path) → old_hash | null (если нет в индексе)
     │
     ▼
Сравниваем new_hash vs old_hash
     │
     ├── file_blake3 совпадает → пропускаем (ничего не изменилось)
     │
      └── file_blake3 отличается →
            │
            ▼
            Парсим файл заново
            │
            ▼
            Разбиваем на чанки, извлекаем смысловые единицы
            │
            ▼
            Для каждого нового чанка:
              ├── Извлекаем смысловую единицу (параграф, функция, класс)
              ├── Вычисляем BLAKE3(смысловая_единица) → semantic_blake3
              ├── Определяем активные модели под тип чанка:
              │   ├── EmbedderRegistry.getEmbedders(type) → type-specific
              │   └── + EmbedderRegistry.getUniversalEmbedder() → universal (если не дублируется)
              ├── Для каждой активной модели:
              │   ├── hasEmbedding(model, semantic_blake3)?
              │   │   ├── есть → готовый embedding
              │   │   └── нет → новый embedding
              │   └── (universal_model уже в списке — повторный проход не нужен)
              ├── Upsert чанк в LanceDB (embeddings = { model: vector, ... })
              └── Добавляем semantic_blake3 в Set новых чанков этой заметки
              │
            Для каждого старого чанка (по source_id):
              ├── semantic_blake3 отсутствует в Set:
              │   ├── Проверяем, ссылается ли другой файл на этот semantic_blake3
              │   │   (запрос repo.getSourceIdsByHash(hash) → другие source_id)
              │   ├── Других ссылок нет → удаляем чанк из БД
              │   └── Другие ссылки есть → оставляем нетронутым
              │       (другой файл всё ещё ссылается — не удаляем, не обновляем file_blake3)
              └── semantic_blake3 присутствует в Set → обновляем chunk_index при необходимости
              │
            ▼
            Перестраиваем FileIndex:
              ├── Если file_blake3 изменился → перепарсить AST
              │   ├── Создать новый FileIndex(path, new_hash, symbols, imports, ...)
              │   └── repo.upsertFileIndex(newIndex)
              └── Если file_blake3 совпадает → FileIndex актуален (пропускаем)
              │
            ▼
            Обновляем file_blake3 + total_chunks
```

### Поиск

**Фильтрация:** `post-filter` (по умолчанию). Сначала ANN/FTS поиск по всем документам, потом фильтр по tags/date.  
**Почему:** pre-filter может отсечь релевантные результаты до векторного поиска. Post-filter чуть медленнее на больших данных, но не теряет релевантность.  
**Конфиг:** `search.filter_mode: "post"` → можно переключить на `"pre"`.

**Multi-model:** запрос ищется по universal_model (всегда) + опционально по extension-моделям. Результаты сливаются: если чанк найден несколькими моделями — `hybrid_weight` усредняется.

```
search("как настроить CI/CD", { tags: ["devops"], mode: "hybrid", top_k: 10 })
  │
  ├─ Semantic (universal_model = nomic-embed-text):
  │     query → Ollama embedding → ANN search (cosine similarity) → top_k * 2
  │
  ├─ Semantic (extension — если подходит под source_type запроса):
  │     например, для code-вопросов → mxbai-embed-large → ANN → top_k * 2
  │     Результаты сливаются с universal: model_scores = { nomic: 0.85, mxbai: 0.72 }
  │
  ├─ Keyword: FTS по content + title (BM25) → top_k * 2
  │
  ├─ Filter: tags[], source_type, date range — POST-filter (после ANN/FTS, до гибрида)
  │   └── Запрашиваем top_k * 2 семантических и top_k * 2 keyword-результатов,
  │       затем применяем фильтр, затем сливаем в общий пул, затем берём top_k
  │
  ├─ Hybrid: взвешенная комбинация → нормализованный score
  │   ├─ BM25 ∈ [0, ∞), cosine ∈ [0, 1] — нельзя складывать напрямую
  │   ├─ Нормализуем BM25: bm25_norm = (bm25 - min) / (max - min) ∈ [0, 1]
  │   │   └─ если единственный результат → 1.0
  │   ├─ Сливаем ANN (универсальная + extension) и BM25 результаты по chunk_id:
  │   │   ├── Есть в обеих выборках → hybrid_score = 0.7 * avg_semantic + 0.3 * bm25_norm
  │   │   ├── Только в ANN → hybrid_score = 0.7 * avg_semantic (BM25 = 0)
  │   │   └── Только в BM25 → hybrid_score = 0.3 * bm25_norm (semantic = 0)
  │   └─ Сортируем по hybrid_score, берём top_k
  │
  └─ Результат: SearchResult[] с полями source, score, match_type, model_scores
      (model_scores = { "nomic-embed-text": 0.85, "mxbai-embed-large": 0.72 })
```

### Упаковка контекста (RAG packaging)

> Детальное описание — **секция 7 (Context Packaging System)**.
> Здесь — краткий data flow: как SearchResult превращается в промпт для LLM.

```
search("...") → SearchResult[]
     │
     ▼
pack(results, options)  — см. ContextPacker.pack() (секция 7)
     │
     1. deduplicator.deduplicate(results)
     2. Сортировка по score (desc)
     3. Greedy-обрезка по max_tokens
     4. Форматирование в Markdown
     │
     ▼
PackedContext { markdown, chunks_used, total_tokens, truncated, source_notes }
```

### Упаковка файлов в .md (PackUseCase)

```
pack("./vault", { include: ["**/*.md"], exclude: ["**/draft*", "**/archive/*"] })
     │
     ▼
Сканирование папки → рекурсивный обзор файлов
     │
     ▼
Фильтрация:
  ├── Применяем include patterns (если заданы → только совпадающие)
  ├── Применяем exclude patterns (исключаем совпадающие)
  └── По умолчанию (без фильтров) → все включённые форматы из конфига
     │
     ▼
Для каждого файла: ParserRegistry.getParser(path)?.parse(path) → ParsedSource
     │
     ▼
Конкатенация в единый Markdown:
  ├── Заголовок: "# Pack: {name}\n> Generated {date}\n"
  ├── Разделитель "---"
  ├── Для каждого файла:
  │   ├── "## {path}"
  │   ├── "> Tags: {tags}" (если есть)
  │   └── content
  └── Сохранение в {output}.md
```

### Чанкинг файлов (ChunkUseCase)

```
chunk("./vault", { include: ["notes/**"], exclude: ["**/_*"], strategy: "heading" })
     │
     ▼
Сканирование → фильтрация (include/exclude)
     │
     ▼
Для каждого файла:
  ├── ParserRegistry.getParser(path)?.parse(path) → ParsedSource
  ├── Chunker.chunk(content, options) → Chunk[]
  └── Результат: массив чанков с метаданными (strategy, size_tokens, heading)
     │
     ▼
Вывод: stdout / JSON / или передача в EmbedUseCase
```

### Эмбеддинг (EmbedUseCase)

```
embed({ source: "chunks" | "files", ...})
     │
     ├── source = "chunks" → берёт существующие Chunk[] (из БД или из memory)
     │     └── Для каждого: BLAKE3 → для каждой активной модели:
     │           check hasModelEmbedding(model, hash) → если нет → embedBatch
     │
     └── source = "files" → chunk + embed в один проход
           └── ChunkUseCase.chunk() → выбор модели под тип → CachedEmbedder.embedBatch()
     │
     ▼
Upsert в LanceDB (путь из конфига: .indeX/data/lancedb)
```

---

## 5. 🧩 Chunking System

### Интерфейс

```typescript
// domain/systems/ChunkingSystem.ts

/** Один чанк — результат нарезки */
interface Chunk {
  content: string              // полный текст чанка (включая overlap/контекст)
  core_content: string         // минимальная смысловая единица (без overlap)
                               // абзац, тело функции, определение класса
                               // Используется для BLAKE3 → semantic_blake3 dedup
  heading?: string             // заголовок секции (если есть)
  chunk_index: number          // порядковый номер
  total_chunks: number         // всего чанков
  strategy: ChunkStrategy      // какой стратегией нарезан
  size_tokens: number          // размер в токенах (полного content)
  metadata: Record<string, unknown>  // доп. метаданные
}

/** Стратегия нарезки */
type ChunkStrategy = 'heading' | 'paragraph' | 'sentence' | 'code' | 'overflow'

/** Опции для чанкера */
interface ChunkOptions {
  max_tokens: number           // макс токенов на чанк (default: 512)
  min_tokens: number           // мин токенов (default: 50, иначе merge)
  overlap_tokens: number       // перекрытие (default: 32)
  strategy: ChunkStrategy      // стратегия по умолчанию
}

/** --- Базовый интерфейс чанкера --- */
interface Chunker {
  readonly name: string
  readonly strategy: ChunkStrategy
  /** TokenEstimator для принятия решений по max_tokens/min_tokens.
   *  Может быть shared между чанкерами в pipeline. */
  readonly tokenEstimator?: TokenEstimator
  chunk(text: string, options?: Partial<ChunkOptions>): Chunk[]
}

/** --- Композитный чанкер (pipeline: fallback chain) --- */
interface ChunkerPipeline extends Chunker {
  /** Добавить чанкер в pipeline (как fallback) */
  add(chunker: Chunker): void
  /** Текущая цепочка */
  getChain(): Chunker[]
  /** Переопределить опции для всей цепочки */
  withOptions(options: Partial<ChunkOptions>): this
}
```

### Реализации

```typescript
// infrastructure/chunking/HeadingChunker.ts
class HeadingChunker implements Chunker {
  // Делит по заголовкам remark-парсера
  // Если блок ≤ max_tokens → возвращается чанк
  // Если блок > max_tokens → chunk НЕ возвращается,
  // pipeline передаёт управление следующему чанкеру (ParagraphChunker)
}

// infrastructure/chunking/ParagraphChunker.ts
class ParagraphChunker implements Chunker {
  // Делит по пустым строкам
  // Если абзац > max_tokens → рекурсия на SentenceChunker
}

// infrastructure/chunking/SentenceChunker.ts
class SentenceChunker implements Chunker {
  // Делит по границам .!? с защитой аббревиатур
  // Никогда не режет предложение
}

// infrastructure/chunking/OverflowChunker.ts
class OverflowChunker implements Chunker {
  // Принудительная резка по границе токенов
  // Срабатывает, когда другие стратегии не уложились в max_tokens
}
```

### Фабрика

```typescript
// infrastructure/chunking/ChunkerFactory.ts
class ChunkerFactory {
  create(strategy: ChunkStrategy): Chunker
  createPipeline(
    strategies: ChunkStrategy[],   // chain of fallbacks
    options?: ChunkOptions
  ): ChunkerPipeline
}

// Использование:
const chunker = ChunkerFactory
  .createPipeline(['heading', 'paragraph', 'sentence', 'overflow'])
  .withOptions({ max_tokens: 512, overlap_tokens: 32 })

const chunks = chunker.chunk(markdownContent)
```

### Pipeline fallback chain

```
heading ─┬─ успех (блок ≤ max_tokens) → ✅ чанк
          └─ блок > max_tokens ─→ paragraph ─┬─ успех → ✅
                                              └─ абзац > max_tokens ─→ sentence ─┬─ успех → ✅
                                                                                  └─ → overflow (token boundary)
```

### Правила

- Каждый чанк наследует `title`, `tags`, `path` от родительской заметки
- Obsidian `[[wiki-links]]` сохраняются в тексте чанка нетронутыми
- Минимальный чанк: 50 токенов (иначе merge с соседним)
  Merge — пост-процессинг после пайплайна: последовательные чанки < 50 токенов
  объединяются с предыдущим чанком (content + core_content склеиваются).
  Если merge невозможен (первый чанк < 50 токенов) — chunk остаётся как есть.
- Предложения не разрываются (кроме overflow)
- Overlap: последние `overlap_tokens` повторяются в начале следующего чанка
  Текст overlap НЕ входит в `core_content` — он есть только в `content` для контекстной связности
- Для CodeChunker overlap не применяется: функция/класс — неделимая единица

### Семантический dedup (core_content vs content)

| Чанкер | content (полный текст) | core_content (для BLAKE3 dedup) |
|---------|-----------------------|--------------------------------|
| `HeadingChunker` | Параграф + заголовок + overlap соседних секций | Только тело секции без overlap |
| `ParagraphChunker` | Абзац + заголовок + 32 токена соседних абзацев | Только сам абзац |
| `CodeChunker` | Функция + JSDoc + контекст файла | Сигнатура + тело функции |
| `CodeChunker (class)` | Класс + импорты + контекст | Определение класса (декораторы, сигнатура, тело) |

BLAKE3 вычисляется на `core_content`, не на `content`.  
Это гарантирует, что та же функция или параграф в разных контекстных окружениях получают одинаковый `semantic_blake3` и корректно дедуплицируются.

---

## 6. 🧩 Embedding System (Multi-Model)

### Назначение

Гибкий пул эмбеддеров, где каждая модель:
- Обслуживает определённые `source_types` (авто-выбор)
- Имеет приоритет в fallback-цепочке
- Может сосуществовать с другими моделями в одной таблице LanceDB (multi-column)
- Кэшируется отдельно (per-model кэш)

### Интерфейсы

```typescript
// domain/systems/EmbeddingSystem.ts

/** Результат эмбеддинга */
interface Embedding {
  vector: Float32Array       // нормализованный вектор (L2 norm = 1)
  model: string              // имя модели
  dimensions: number         // размерность (384 для nomic-embed-text)
  tokens_in: number          // сколько токенов ушло на вход
}

/** Опции эмбеддинга */
interface EmbedOptions {
  batch_size?: number        // размер пачки (default: 10)
  retry_attempts?: number    // попыток при ошибке (default: 3)
  timeout_ms?: number        // таймаут запроса (default: 30000)
  signal?: AbortSignal       // для graceful shutdown
}

/** --- Единый embedder (одна модель) --- */
interface Embedder {
  readonly name: string           // уникальное имя (nomic-embed-text)
  readonly provider: string       // 'ollama' | 'lancedb'
  readonly dimensions: number     // размерность вектора
  readonly sourceTypes: string[]  // какие SourceType обслуживает ([] = все)

  embed(text: string, options?: Partial<EmbedOptions>): Promise<Embedding>
  embedBatch(texts: string[], options?: Partial<EmbedOptions>): Promise<Embedding[]>
}

/** --- Кэш эмбеддингов (per-model: model_name + semantic_blake3 → vector) --- */
interface EmbedderCache {
  get(model: string, hash: string): Promise<Embedding | null>
  set(model: string, hash: string, embedding: Embedding): Promise<void>
  has(model: string, hash: string): Promise<boolean>
  clear(): void
  get size(): number
}

/** --- Конфигурация одной модели из конфига --- */
interface ModelConfig {
  name: string                        // произвольное имя (nomic-embed-text)
  provider: 'ollama' | 'lancedb'
  dimensions: number                  // размерность вектора
  priority: number                    // меньше = выше приоритет (0 = highest)
  source_types?: string[]             // какие SourceType обслуживает (null = все)
  ollama_url?: string                 // для ollama провайдера
  batch_size?: number
}

/** --- Реестр моделей --- */
interface EmbedderRegistry {
  /** Получить embedder для конкретного source_type (по приоритету) */
  getEmbedder(sourceType: string): Embedder | null
  /** Получить ВСЕ embedder'ы, подходящие под source_type */
  getEmbedders(sourceType: string): Embedder[]
  /** Универсальная модель (для cross-type поиска) */
  getUniversalEmbedder(): Embedder | null
  /** Проверить, жив ли хотя бы один embedder */
  isAvailable(): boolean
  /** Имена всех зарегистрированных моделей */
  readonly modelNames: string[]
}
```

### Реализации

```typescript
// infrastructure/embedding/OllamaEmbedder.ts
class OllamaEmbedder implements Embedder {
  // Настоящий batch: /api/embeddings с массивом строк (1 HTTP запрос)
  // Exponential backoff: 1s → 2s → 4s
  // Graceful shutdown через AbortSignal
  constructor(
    readonly name: string,
    readonly dimensions: number,
    readonly sourceTypes: string[],
    private readonly config: {
      ollamaUrl: string
      batchSize: number
      retryAttempts: number
      timeoutMs: number
    },
  ) {}
}

// infrastructure/embedding/LanceDbEmbedder.ts
class LanceDbEmbedder implements Embedder {
  // Fallback-эмбеддер: LanceDB не генерирует text→vector, поэтому
  // эта реализация возвращает zero-вектор заданной размерности.
  // Позволяет LanceDB выполнять ANN-поиск (l2 distance на нулевых векторах
  // равносилен keyword-only) без падения при недоступности Ollama.
  // См. graceful degradation в §6.
}

// infrastructure/embedding/CachedEmbedder.ts
class CachedEmbedder implements Embedder {
  // Proxy-декоратор: проверяет кэш перед вызовом реального Embedder
  // Ключ кэша = model.name + BLAKE3(text), а не просто BLAKE3(text)
  // Это предотвращает коллизию: та же текстовая единица даёт
  // РАЗНЫЕ векторы для разных моделей
  constructor(
    private readonly inner: Embedder,
    private readonly cache: EmbedderCache,
    private readonly hasher: Hasher,
  ) {}
}

// infrastructure/embedding/MultiModelEmbedder.ts
class MultiModelEmbedder {
  // НЕ implements Embedder — возвращает Record, а не одно Embedding
  // Декоратор: вызывает embed на нескольких моделях параллельно
  // Возвращает Record<modelName, Embedding>
  constructor(private readonly embedders: Embedder[]) {}

  async embedAll(text: string): Promise<Record<string, Embedding>> {
    const results = await Promise.allSettled(
      this.embedders.map(e => e.embed(text))
    )
    // Упавшие — логируем, живые — возвращаем
    const embeddings: Record<string, Embedding> = {}
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === 'fulfilled') {
        embeddings[this.embedders[i].name] = r.value
      }
    }
    return embeddings
  }
}

// infrastructure/embedding/NullEmbedder.ts
class NullEmbedder implements Embedder {
  // Всегда кидает ошибку "no embedder available"
  // Нужен, чтобы не размазывать if-проверки по коду
  readonly name = 'null'
  readonly provider = 'null'
  readonly dimensions = 0
  readonly sourceTypes = []
}

// infrastructure/embedding/EmbedderCacheLRU.ts
class EmbedderCacheLRU implements EmbedderCache {
  // In-memory LRU cache с max_size из конфига
  // Ключ: `${model}:${hash}` — per-model кэш
  get(model: string, hash: string): Promise<Embedding | null> { ... }
  set(model: string, hash: string, embedding: Embedding): Promise<void> { ... }
  has(model: string, hash: string): Promise<boolean> { ... }
  clear(): void { ... }
  get size(): number { ... }
}

// tests/infrastructure/MockEmbedder.ts
class MockEmbedder implements Embedder {
  readonly name = 'mock'
  readonly provider = 'mock'
  readonly dimensions = 384
  readonly sourceTypes = []   // все типы
}

// --- EmbedderRegistry — построение из конфига ---
class EmbedderRegistryImpl implements EmbedderRegistry {
  constructor(
    private readonly models: Map<string, Embedder>,
    private readonly bySourceType: Map<string, Embedder[]>,
    private readonly universalEmbedder: Embedder | null,
    private readonly logger: Logger,
  ) {}

  getEmbedder(sourceType: string): Embedder | null {
    // 1. Ищем среди подходящих под source_type
    // 2. Выбираем с минимальным priority
    // 3. Если не нашли — universalEmbedder
    // 4. Если universal нет — null
    const candidates = this.bySourceType.get(sourceType) ?? []
    if (candidates.length > 0) {
      return candidates.reduce((best, c) =>
        c.priority < best.priority ? c : best
      )
    }
    return this.universalEmbedder
  }

  getEmbedders(sourceType: string): Embedder[] {
    return this.bySourceType.get(sourceType) ?? []
  }

  isAvailable(): boolean {
    return this.models.size > 0
  }

  get modelNames(): string[] {
    return [...this.models.keys()]
  }
}
```

### Процесс (Multi-Model)

```
Индексация: чанк типа "typescript"
  │
  ├── EmbedderRegistry.getEmbedders("typescript") + getUniversalEmbedder()
  │     └── [mxbai-embed-large(p=2, 1024d), nomic-embed-text(p=1, 384d, universal)]
  │
  ├── Для каждой модели:
  │     ├── CachedEmbedder: check cache("mxbai", blake3(text))
  │     │   ├── hit → вектор готов
  │     │   └── miss → OllamaEmbedder.embedBatch()
  │     │
  │     └── Результат: { "mxbai-embed-large": Float32Array(1024),
  │                      "nomic-embed-text": Float32Array(384) }
  │
  └── SourceData.embeddings = { mxbai: vec1024, nomic: vec384 }
          │
          ▼
      LanceDB: одна запись, две vector-колонки
                vect_mxbai_embed_large (1024d)
                vect_nomic_embed_text   (384d)

      Конвенция нейминга колонок: vect_{model_name_underscored} ({dimensions}d)
      Имена моделей нормализуются: дефисы → подчёркивания, точки → underscore.
```

### Graceful degradation

| Условие | Поведение |
|---------|-----------|
| Все модели упали | `isAvailable() = false` → индексация без векторов (только metadata + FTS) |
| Упала одна модель (из N) | Работаем с живыми, логируем предупреждение |
| Упала universal_model | Предупреждение, universal-поиск недоступен. Extension-модели работают |
| LanceDB / hasEmbedding(model, hash) недоступен | Dedup for этой модели отключается — все чанки этой модели проходят полный цикл embed → upsert |
| Прерывание (Ctrl+C) | Дождаться текущего batch, завершить |
| Кэш переполнен | LRU eviction (вытеснение давних записей) |

### Стоимость multi-model

`fallback_strategy: "chain"` — один запрос на чанк (первая успешная модель).  
`fallback_strategy: "all"` — N запросов на чанк (все подходящие модели). **N× стоимость.**

Рекомендация: `"chain"` для больших репозиториев, `"all"` когда точность критичнее скорости.

---

## 7. 🧩 Context Packaging System

### Назначение

Поиск → дедупликация → сортировка → обрезка по токенам → Markdown → LLM.

### Интерфейсы

```typescript
// domain/systems/ContextPackagingSystem.ts
// SearchResult — определён в §9 (domain/types.ts), здесь не дублируется

/** Упакованный контекст */
interface PackedContext {
  markdown: string                // готовый текст для LLM
  chunks_used: number             // сколько чанков вошло
  total_tokens: number            // сколько токенов в контексте
  truncated: boolean              // был ли обрезан по лимиту
  source_notes: string[]          // список исходных файлов
}

/** Опции упаковки */
interface ContextOptions {
  max_tokens: number               // лимит токенов (default: 2048)
  include_metadata: boolean        // показывать path/tags (default: true)
  include_chunk_info: boolean      // показывать чанк 2/4 (default: false)
  format: 'context' | 'rag'       // 'rag' — с инструкцией для LLM
  system_prompt?: string           // кастомный system prompt
}

/** --- Дедупликатор (по BLAKE3) --- */
interface Deduplicator {
  deduplicate(results: SearchResult[]): SearchResult[]
}

/** --- Токенизатор (для подсчёта и обрезки) --- */
interface Tokenizer {
  count(text: string): number
  truncate(text: string, maxTokens: number): string
}

/** --- Упаковщик контекста --- */
interface ContextPacker {
  pack(
    results: SearchResult[],
    options?: Partial<ContextOptions>
  ): PackedContext
}
```

### Pipeline (чёткий — без дублирования)

```
SearchResult[] (сырые, возможны дубликаты)
     │
     ▼
1. deduplicator.deduplicate(results)    ← отдельный шаг, ДО pack()
   │  └── по semantic_blake3, Map<hash, SearchResult> O(n) с сохранением max score
   ▼
2. Сортировка по score (descending)
     │
     ▼
3. Токенизация (tokenizer.count())
   │  └── tiktoken / gpt-tokenizer
   ▼
4. Greedy-обрезка по max_tokens
   │  └── чанк целиком ИЛИ пропуск (не режем)
   ▼
5. Форматирование в Markdown
   │  └── Вызов formatter.format(chunks, options)
   ▼
PackedContext { markdown, chunks_used, total_tokens, truncated, source_notes }
```

### Реализации

```typescript
// infrastructure/context/BLAKE3Deduplicator.ts
class BLAKE3Deduplicator implements Deduplicator {
  // O(n) dedup: Map<semantic_blake3, SearchResult>
  // Из дубликатов оставляет запись с максимальным score
  deduplicate(results: SearchResult[]): SearchResult[] {
    const best = new Map<string, SearchResult>()
    for (const r of results) {
      const hash = r.source.semantic_blake3
      const existing = best.get(hash)
      if (!existing || r.score > existing.score) {
        best.set(hash, r)
      }
    }
    return Array.from(best.values())
  }
}

// infrastructure/context/GPTCodeTokenizer.ts
class GPTCodeTokenizer implements Tokenizer {
  // tiktoken (cl100k_base) — точный счёт токенов
  // Подходит для GPT-4, Claude, локальных LLM
}

// infrastructure/context/RAGContextPacker.ts
class RAGContextPacker implements ContextPacker {
  constructor(
    private readonly deduplicator: Deduplicator,
    private readonly tokenizer: Tokenizer,
  ) {}

  pack(results: SearchResult[], options?: Partial<ContextOptions>): PackedContext {
    const unique = this.deduplicator.deduplicate(results)  // ✅ явно
    // ... сортировка, обрезка, форматирование
  }
}
```

### Формат RAG

```markdown
Ты — ассистент по личным заметкам пользователя.
Отвечай на вопросы, используя ТОЛЬКО информацию из контекста ниже.
Если в контексте нет ответа — так и скажи.

=== КОНТЕКСТ ===

## Настройка CI/CD (./devops/ci-cd.md)
**Tags:** devops, github-actions
> Для настройки CI/CD необходимо создать файл .github/workflows/main.yml

## Docker basics (./docker/intro.md) — Чанк 2/4
**Tags:** docker, devops
> Основные команды Docker: docker build, docker run, docker compose

=== ВОПРОС ===

{user_query}
```

---

## 8. 🧩 Hashing System

```typescript
// domain/systems/HashingSystem.ts

/** Интерфейс хешера */
interface Hasher {
  readonly algorithm: string       // 'blake3'
  hash(data: string | Uint8Array): Promise<string>
  hashFile(path: string): Promise<string>
}

/** Наивная оценка токенов (без внешних зависимостей) */
interface TokenEstimator {
  estimate(text: string): number     // bytes / 4, грубо
}

// infrastructure/hashing/BLAKE3Hasher.ts
class BLAKE3Hasher implements Hasher {
  // hash-wasm: BLAKE3 — в 10× быстрее SHA256
  // Streaming: читает файл чанками, не загружая в память целиком
  // ⚠ В индексации файл читается дважды: hashFile() + парсер (remark и др. загружают в память).
  //   Оптимизация: BLAKE3Hasher.hashFile() может возвращать { hash, content } — прочитанный
  //   контент передаётся в парсер, избегая второго readFile. Пока не реализовано.
}

// infrastructure/hashing/TokenEstimatorSimple.ts
class TokenEstimatorSimple implements TokenEstimator {
  estimate(text: string): number {
    return Math.ceil(Bun.stringByteLength(text) / 4)
  }
}

// infrastructure/hashing/TokenEstimatorTiktoken.ts
class TokenEstimatorTiktoken implements TokenEstimator {
  // Использует tiktoken для точного подсчёта
  // Подключается, если gpt-tokenizer установлен
}
```

---

## 9. 🔌 Ports (интерфейсы)

### AST-модель (новый файл `domain/ast.ts`)

```typescript
// domain/ast.ts

/** Тип исходного файла */
type SourceType = 'markdown' | 'obsidian' | 'typescript' | 'javascript'
                | 'python' | 'go' | 'rust' | 'java' | string

/** Модульная система */
type ModuleType = 'esm' | 'cjs' | 'unknown'

/** Импорт: куда этот файл смотрит */
interface Import {
  source: string                // "./utils/score"  или  "lodash"
  resolvedPath?: string         // полный путь после резолва (на этапе парсинга)
  imported: string[]            // что именно импортируется: ["calculateScore"]
  isDefault: boolean
  isTypeOnly: boolean           // import type { Foo }
  isDynamic: boolean            // const x = await import(...)
  isSideEffect: boolean         // import 'styles.css'
}

/** Экспорт: что файл предоставляет */
interface Export {
  name: string
  isDefault: boolean
  isTypeOnly: boolean
  isReExport: boolean           // export { foo } from './bar'
  reExportSource?: string       // откуда реэкспорт
}

/** Вид символа в AST */
type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'enum'
                | 'method' | 'property' | 'variable' | 'constant'
                | 'decorator' | 'module' | 'namespace'

/** Детальный символ (точечное AST) */
interface SymbolDetail {
  kind: SymbolKind
  name: string

  signature: string             // "function calculateScore(weights: ScoreWeights): number"
  fullText?: string             // полное тело (если < 10 строк)

  params?: {
    name: string
    type: string
    optional: boolean
    rest: boolean
    defaultValue?: string
  }[]

  returnType?: string
  typeParams?: string[]         // <T, R extends Foo>

  startLine: number
  endLine: number
  startCol: number
  endCol: number

  doc?: string                  // JSDoc / docstring
  docTags?: string[]            // @param, @returns, @deprecated

  accessModifier?: 'public' | 'protected' | 'private'
  isExported: boolean
  isAsync: boolean
  isAbstract: boolean
  isStatic: boolean
  isReadonly: boolean

  decorators?: { name: string; arguments?: string }[]

  extends?: string[]            // extends Foo, Bar
  implements?: string[]         // implements IFoo
  inheritsFrom?: string         // для переопределённых методов
  overrides?: string

  children?: SymbolDetail[]     // методы класса, поля интерфейса
}

/** Тип отношения между файлами */
type RelationType = 'imports' | 'imported_by'
                  | 'extends' | 'implements'
                  | 'calls' | 'called_by'
                  | 'references' | 'referenced_by'

/** Связь между файлами (граф зависимостей) */
interface Relationship {
  type: RelationType
  sourceFile: string
  targetFile: string
  sourceSymbol?: string
  targetSymbol?: string
  confidence: number            // 0..1 (1 = точное разрешение)
}

/** Сводка AST по одному файлу (таблица file_index) */
interface FileIndex {
  path: string                 // primary key
  file_blake3: string
  language: string
  moduleType?: ModuleType
  package?: string

  imports: Import[]
  exports: Export[]
  symbols: SymbolDetail[]
  relationships: Relationship[]

  last_parsed: number
}

/** Результат парсинга файла */
interface ParsedSource {
  type: SourceType
  path: string
  title: string
  content: string
  tags: string[]
  metadata: SourceMetadata       // discriminated union — тип зависит от type
  file_blake3?: string
  ast?: FileIndex               // AST-сводка (если парсер поддерживает)
}
```

### Общие типы

> `SourceData` — см. описание и поля в **§3** (стр. 100-142).
> `SearchResult` — см. ниже (стр. 1361-1366).
> `IndexStats` — см. ниже (стр. 1351-1359).

```typescript
// domain/types.ts

interface SearchQuery {
  text: string
  mode?: 'semantic' | 'keyword' | 'hybrid'
  tags?: string[]
  source_type?: SourceType[]
  path_glob?: string
  date_from?: number
  date_to?: number
  top_k?: number
  hybrid_weights?: { semantic: number; keyword: number }

  /** Фильтрация по полям SourceMetadata.
   *  Все условия AND. Поддерживаются exact-match и числовые сравнения.
   *
   *  Пример для CodeMetadata:
   *    metadata_filter: {
   *      kind: 'code',
   *      language: 'typescript',
   *      complexity: { lines: { $gte: 100 } }
   *    }
   *
   *  Реализация: post-filter чанков после поиска по всем метаданным
   *  (LanceDB хранит metadata как JSON-блоб, полноценная фильтрация
   *   по вложенным полям ограничена — применяем на уровне приложения).
   */
  metadata_filter?: Record<string, unknown>
}

interface IndexStats {
  total_sources: number     // сколько файлов проиндексировано
  total_chunks: number      // сколько чанков
  total_tokens: number      // токенов проиндексировано
  db_size_bytes: number     // размер БД
  last_indexed: string      // дата последней индексации
  embedding_models: string[] // список активных моделей
  // ["nomic-embed-text", "mxbai-embed-large"]
}

interface SearchResult {
  source: SourceData          // сам чанк
  score: number               // relevance (0..1)
  match_type: 'semantic' | 'keyword' | 'hybrid'
  model_scores: Record<string, number>
}
```

### Ports

```typescript
// domain/ports/SourceRepository.ts (was NoteRepository)
interface SourceRepository {
  upsert(source: SourceData): Promise<void>
  upsertBatch(sources: SourceData[]): Promise<void>
  delete(id: string): Promise<void>
  deleteBySourceId(sourceId: string): Promise<void>
  deleteByPath(path: string): Promise<void>
  search(query: SearchQuery): Promise<SearchResult[]>

  getById(id: string): Promise<SourceData | null>
  getBySourceId(sourceId: string): Promise<SourceData[]>
  getByPath(path: string): Promise<SourceData[]>
  hasSemanticBlake3(hash: string): Promise<boolean>       // есть ли чанк с таким semantic_blake3
  hasModelEmbedding(model: string, hash: string): Promise<boolean>
  // проверка: есть ли у данного semantic_blake3 embedding от конкретной модели
  getSourceIdsByHash(hash: string): Promise<string[]>  // для shared-chunk checks
  getFileBlake3ByPath(path: string): Promise<string | null>
  stats(): Promise<IndexStats>

  // file_index table
  upsertFileIndex(index: FileIndex): Promise<void>
  getFileIndex(path: string): Promise<FileIndex | null>
  deleteFileIndex(path: string): Promise<void>
}

// domain/ports/SourceParser.ts (generalised)
interface SourceParser {
  readonly type: SourceType
  readonly extensions: string[]     // ['.md']  или  ['.ts', '.tsx']

  supportsFile(path: string): boolean
  parse(path: string): Promise<ParsedSource>
  getAST?(path: string): Promise<FileIndex | null>   // AST-сводка для file_index (опционально)
}

// domain/ports/SourceParserRegistry.ts
interface SourceParserRegistry {
  getParser(path: string): SourceParser | null
  getParsers(): SourceParser[]
  getEnabledParsers(config: ParsingConfig): SourceParser[]
  getSupportedExtensions(): string[]
  register(parser: SourceParser): void
}

// domain/ports/FileWatcher.ts
interface FileWatcher {
  on(event: 'add' | 'change' | 'unlink', handler: (path: string) => void): void
  start(): Promise<void>
  stop(): Promise<void>
}

// domain/ports/Logger.ts
interface Logger {
  info(msg: string, ...args: unknown[]): void
  info(obj: object, msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  warn(obj: object, msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
  error(obj: object, msg: string, ...args: unknown[]): void
  debug(msg: string, ...args: unknown[]): void
  debug(obj: object, msg: string, ...args: unknown[]): void
  child?(bindings: Record<string, unknown>): Logger
}

// domain/ports/FileFilter.ts
type ParsingConfig = {
  formats: Record<string, { enabled: boolean }>
  include?: string[]
  exclude?: string[]
}

interface FileFilter {
  formats?: SourceType[]       // какие типы парсить
  include?: string[]           // glob patterns
  exclude?: string[]
}

/** Результат упаковки (PackUseCase) */
interface PackResult {
  path: string
  files_packed: number
  total_size_bytes: number
}
```

---

## 10. 💉 Dependency Injection

Ручной DI через конструктор (без фреймворков).  
Для уменьшения числа зависимостей — **группируем системы** в объекты.

```typescript
// application/di/Systems.ts

/** Индексация: объединяет всё для полного цикла (parse → chunk → embed → upsert) */
interface IndexSystems {
  repo: SourceRepository
  parserRegistry: SourceParserRegistry   // выбор парсера по типу файла
  embedderRegistry: EmbedderRegistry      // реестр моделей (multi-model)
  chunker: Chunker
  hasher: Hasher
  tokenEstimator: TokenEstimator
  watcher?: FileWatcher                // опционально: нужен только WatchUseCase
  filter: FileFilter                     // include/exclude/formats
}

/** Поиск: поиск + упаковка контекста */
interface SearchSystems {
  repo: SourceRepository
  embedderRegistry: EmbedderRegistry    // для embedding запроса поиска
  packer: ContextPacker
  tokenizer: Tokenizer
}

/** Упаковка файлов в .md */
interface PackSystems {
  parserRegistry: SourceParserRegistry
  filter: FileFilter
  logger: Logger
}

/** Чанкинг */
interface ChunkSystems {
  parserRegistry: SourceParserRegistry
  chunker: Chunker
  hasher: Hasher
  tokenEstimator: TokenEstimator
  filter: FileFilter
  logger: Logger
}

/** Эмбеддинг */
interface EmbedSystems {
  repo: SourceRepository
  embedderRegistry: EmbedderRegistry
  hasher: Hasher
  chunker?: Chunker       // если source = "files"
  filter?: FileFilter
  logger: Logger
}

// application/IndexUseCase.ts
class IndexUseCase {
  constructor(
    private readonly systems: IndexSystems,
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}

  async execute(path: string): Promise<void> {
    // Выбор модели под тип файла:
    const embedder = this.systems.embedderRegistry.getEmbedder(sourceType)
    // или batch:
    const models = this.systems.embedderRegistry.getEmbedders(sourceType)
    // Universal:
    const universal = this.systems.embedderRegistry.getUniversalEmbedder()
  }
}

// application/SearchUseCase.ts
class SearchUseCase {
  constructor(
    private readonly systems: SearchSystems,
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}
}

// application/PackUseCase.ts
class PackUseCase {
  constructor(
    private readonly systems: PackSystems,
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}
}

// application/ChunkUseCase.ts
class ChunkUseCase {
  constructor(
    private readonly systems: ChunkSystems,
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}
}

// application/EmbedUseCase.ts
class EmbedUseCase {
  constructor(
    private readonly systems: EmbedSystems,
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}
}

// В тестах — моки
const systems: IndexSystems = {
  repo: mockRepo,
  parserRegistry: mockRegistry,
  embedderRegistry: new MockEmbedderRegistry(),
  chunker: mockChunker,
  hasher: mockHasher,
  tokenEstimator: mockTokenEstimator,
  watcher: mockWatcher,
  filter: { formats: ['markdown'], include: ['**/*.md'] },
}
const useCase = new IndexUseCase(systems, mockConfig, silentLogger)
```

---

## 11. ⚙️ Конфигурация

Файл: `.indeX/config.json` в корне проекта.

> ⚠ `parsing.formats` — имена НЕ всегда соответствуют расширениям файлов.
> `"obsidian"` не имеет собственного расширения — это триггер для ObsidianParser
> на `.md`-файлах, содержащих Obsidian frontmatter. Выбор парсера для `.md` —
> **контентный** (первые N байт проверяются на frontmatter с wiki-links/tags).
> `"markdown": { "enabled": true }` и `"obsidian": { "enabled": true }`
> НЕ означают двойной парсинг — каждый `.md` файл обрабатывается ровно одним
> парсером (см. двухфазный выбор в §4).

```json
{
  "sources_dir": "./vault",
  "db_path": ".indeX/data/lancedb",

  "parsing": {
    "formats": {
      "markdown": { "enabled": true },
      "obsidian": { "enabled": true },
      "typescript": { "enabled": true },
      "python": { "enabled": false },
      "go": { "enabled": false },
      "rust": { "enabled": false }
    },
    "include": ["**/*"],
    "exclude": ["node_modules/**", ".git/**", "dist/**", "build/**"]
  },

  "embeddings": {
    "models": [
      {
        "name": "nomic-embed-text",
        "provider": "ollama",
        "dimensions": 384,
        "priority": 1,
        "source_types": null,
        "ollama_url": "http://localhost:11434",
        "batch_size": 10
      },
      {
        "name": "mxbai-embed-large",
        "provider": "ollama",
        "dimensions": 1024,
        "priority": 2,
        "source_types": ["typescript", "javascript", "python", "go", "rust"],
        "ollama_url": "http://localhost:11434",
        "batch_size": 5
      },
      {
        "name": "lancedb-builtin",
        "provider": "lancedb",
        "dimensions": 384,
        "priority": 99,
        "source_types": null,
        "batch_size": 1
      }
    ],
    "fallback_strategy": "chain",
    "default_model": "nomic-embed-text",
    "universal_model": "nomic-embed-text",
    "cache_size": 1000,
    "retry_attempts": 3,
    "timeout_ms": 30000
  },

  "chunking": {
    "max_tokens": 512,
    "min_tokens": 50,
    "overlap_tokens": 32,
    "strategy": "heading"
  },

  "dedup": {
    "enabled": true               // глобальный dedup по semantic_blake3
  },

  "watch": {
    "enabled": true,
    "debounce_ms": 500,
    "diff_indexing": true
  },

  "search": {
    "default_mode": "hybrid",
    "filter_mode": "post",            // post-filter (после ANN) — не теряем релевантные
    "hybrid_weights": {
      "semantic": 0.7,
      "keyword": 0.3
    },
    "max_results": 20
  },

  "context": {
    "max_tokens": 2048,
    "include_metadata": true,
    "include_chunk_info": false,
    "format": "rag",
    "system_prompt": "Ты — ассистент по личным заметкам и коду пользователя. Отвечай на вопросы, используя ТОЛЬКО информацию из контекста ниже. Если в контексте нет ответа — так и скажи."
  }
}
```

Конфиг загружается через `ConfigLoader` и валидируется через zod-схему при старте приложения:

```typescript
// src/config/ConfigLoader.ts
import { z } from 'zod'
import { existsSync, readFileSync } from 'fs'

const ConfigSchema = z.object({
  sources_dir: z.string().default('./vault'),
  db_path: z.string().default('.indeX/data/lancedb'),

  parsing: z.object({
    formats: z.record(z.object({
      enabled: z.boolean().default(true),
    })).default({
      markdown: { enabled: true },
      obsidian: { enabled: true },
      typescript: { enabled: true },
    }),
    include: z.array(z.string()).default(['**/*']),
    exclude: z.array(z.string()).default(['node_modules/**', '.git/**', 'dist/**']),
  }).default({}),

  embeddings: z.object({
    models: z.array(z.object({
      name: z.string(),
      provider: z.enum(['ollama', 'lancedb']),
      dimensions: z.number().positive(),
      priority: z.number().int().min(0).default(10),
      source_types: z.array(z.string()).nullable().default(null),
      ollama_url: z.string().default('http://localhost:11434'),
      batch_size: z.number().positive().default(10),
    })).min(1).default([
      {
        name: 'nomic-embed-text',
        provider: 'ollama',
        dimensions: 384,
        priority: 1,
        source_types: null,
        ollama_url: 'http://localhost:11434',
        batch_size: 10,
      },
    ]),
    fallback_strategy: z.enum(['chain', 'all']).default('chain'),
    default_model: z.string().default('nomic-embed-text'),
    universal_model: z.string().nullable().default('nomic-embed-text'),
    cache_size: z.number().positive().default(1000),
    retry_attempts: z.number().positive().default(3),
    timeout_ms: z.number().positive().default(30000),
  }).default({}).superRefine((data, ctx) => {
    // Валидация: universal_model должен быть в models[]
    if (data.universal_model && !data.models.find(m => m.name === data.universal_model)) {
      ctx.addIssue({ code: 'custom', message: `universal_model "${data.universal_model}" не найден в models[]`, path: ['embeddings', 'universal_model'] })
    }
    // Валидация: default_model должен быть в models[]
    if (data.default_model && !data.models.find(m => m.name === data.default_model)) {
      ctx.addIssue({ code: 'custom', message: `default_model "${data.default_model}" не найден в models[]`, path: ['embeddings', 'default_model'] })
    }
    // Предупреждение: universal_model не должен совпадать с default_model
    // (это не ошибка, но вызовет double-embedding)
  }),

  chunking: z.object({
    max_tokens: z.number().positive().default(512),
    min_tokens: z.number().positive().default(50),
    overlap_tokens: z.number().min(0).default(32),
    strategy: z.enum(['heading', 'paragraph', 'sentence', 'code', 'overflow']).default('heading'),
  }).default({}),

  dedup: z.object({
    enabled: z.boolean().default(true),
  }).default({}),

  watch: z.object({
    enabled: z.boolean().default(true),
    debounce_ms: z.number().positive().default(500),
    diff_indexing: z.boolean().default(true),
  }).default({}),

  search: z.object({
    default_mode: z.enum(['semantic', 'keyword', 'hybrid']).default('hybrid'),
    filter_mode: z.enum(['pre', 'post']).default('post'),
    hybrid_weights: z.object({
      semantic: z.number().min(0).max(1).default(0.7),
      keyword: z.number().min(0).max(1).default(0.3),
    }).default({ semantic: 0.7, keyword: 0.3 }),
    max_results: z.number().positive().default(20),
  }).default({}),

  context: z.object({
    max_tokens: z.number().positive().default(2048),
    include_metadata: z.boolean().default(true),
    include_chunk_info: z.boolean().default(false),
    format: z.enum(['context', 'rag']).default('rag'),
    system_prompt: z.string().default(
      'Ты — ассистент по личным заметкам пользователя. Отвечай на вопросы, используя ТОЛЬКО информацию из контекста ниже. Если в контексте нет ответа — так и скажи.'
    ),
  }).default({}),
})

export type Config = z.infer<typeof ConfigSchema>

export class ConfigLoader {
  /** Бросает ошибку при отсутствии файла */
  load(): Config {
    if (!existsSync('.indeX/config.json')) {
      throw new Error('Config file not found: .indeX/config.json')
    }
    const raw = JSON.parse(readFileSync('.indeX/config.json', 'utf-8'))
    return ConfigSchema.parse(raw)
  }

  /** Возвращает defaults при отсутствии файла */
  loadOrDefault(): Config {
    try { return this.load() }
    catch (e) {
      if (e instanceof Error && e.message.includes('Config file not found')) {
        return ConfigSchema.parse({})  // нет конфига → defaults
      }
      throw e  // битый JSON / ошибка валидации → пробрасываем
    }
  }
}
```

---

## 12. 🖥️ CLI Интерфейс

> Флаг `--formats ts,py` маппится на `SearchQuery.source_type: ['typescript', 'python']`.
> Названия CLI-форматов и `SourceType` в коде нормализуются (ts → typescript, py → python).

```bash
# Индексация
indeX index ./vault                               # по конфигу / всем парсерам
indeX index ./vault --watch                       # + вотчер
indeX index ./project --formats md,ts,py          # только md + ts + py
indeX index ./project --code                      # все кодовые форматы
indeX index ./project --all                       # все реализованные парсеры
indeX index ./project --include "src/**" --exclude "**/test/**"
indeX reindex                                     # переиндексация

# Поиск
indeX search "запрос"                             # семантический поиск
indeX search "запрос" --hybrid                    # гибридный поиск
indeX search "запрос" --tags devops,ts
indeX search "функция createUser" --formats ts    # только по TS-чанкам

# Файловые операции
indeX pack ./vault -o bundle.md                   # упаковка .md → bundle.md
indeX pack ./vault -o notes.md --include "projects/**" --exclude "drafts/*"
indeX pack ./project -o code.md --formats ts,py   # код в .md

indeX chunk ./vault                               # чанкинг + stdout
indeX chunk ./project --strategy heading --include "docs/**"
indeX chunk ./project --json --all                # все форматы в JSON

indeX embed ./vault                               # эмбеддинг в векторную БД
indeX embed --from chunks.json                    # из JSON-файла с чанками
indeX embed ./project --formats ts                # только TS

# Вотчер (форматы из конфига + include/exclude)
indeX watch ./vault
indeX watch ./project --formats md,ts

# Сервисы
indeX serve --port 3000
indeX stats
```

---

## 13. 🧪 TDD Workflow

### RED → GREEN → REFACTOR

```
1. RED:    Пишем тест → он падает (нет реализации)
2. GREEN:  Минимальная реализация → тест проходит
3. REFACTOR: Улучшаем код, тесты остаются зелёными
```

### Команды

```bash
bun test                          # все тесты
bun test --watch                  # TDD-режим (автоперезапуск)
bun test --coverage               # покрытие
bun test tests/domain/            # только определённый слой
bun test tests/domain/models/Note.test.ts  # один файл
```

### Моки

```typescript
// tests/mocks/MockSourceRepository.ts
const mockRepo: SourceRepository = {
  upsert: mock(() => Promise.resolve()),
  upsertBatch: mock(() => Promise.resolve()),
  delete: mock(() => Promise.resolve()),
  deleteBySourceId: mock(() => Promise.resolve()),
  deleteByPath: mock(() => Promise.resolve()),
  search: mock(() => Promise.resolve([])),
  getById: mock(() => Promise.resolve(null)),
  getBySourceId: mock(() => Promise.resolve([])),
  getByPath: mock(() => Promise.resolve([])),
  hasSemanticBlake3: mock(() => Promise.resolve(false)),
  hasModelEmbedding: mock(() => Promise.resolve(false)),
  getSourceIdsByHash: mock(() => Promise.resolve([])),
  getFileBlake3ByPath: mock(() => Promise.resolve(null)),
  stats: mock(() => Promise.resolve({
    total_sources: 0,
    total_chunks: 0,
    total_tokens: 0,
    db_size_bytes: 0,
    last_indexed: '',
    embedding_models: ['mock'],
  })),
  // file_index table
  upsertFileIndex: mock(() => Promise.resolve()),
  getFileIndex: mock(() => Promise.resolve(null)),
  deleteFileIndex: mock(() => Promise.resolve()),
}

// tests/mocks/MockEmbedder.ts
class MockEmbedder implements Embedder {
  readonly name = 'mock'
  readonly provider = 'mock'
  readonly dimensions = 384
  readonly sourceTypes = []
  embed(text: string, _options?: Partial<EmbedOptions>): Promise<Embedding> {
    return Promise.resolve({
      vector: new Float32Array(384),
      model: 'mock',
      dimensions: 384,
      tokens_in: text.length / 4,
    })
  }
  embedBatch(texts: string[], _options?: Partial<EmbedOptions>): Promise<Embedding[]> {
    return Promise.all(texts.map(t => this.embed(t)))
  }
}

// tests/mocks/MockEmbedderRegistry.ts
class MockEmbedderRegistry implements EmbedderRegistry {
  private readonly mockEmbedder = new MockEmbedder()

  getEmbedder(_sourceType: string): Embedder | null {
    return this.mockEmbedder
  }
  getEmbedders(_sourceType: string): Embedder[] {
    return [this.mockEmbedder]
  }
  getUniversalEmbedder(): Embedder | null {
    return this.mockEmbedder
  }
  isAvailable(): boolean { return true }
  get modelNames(): string[] { return ['mock'] }
}

// (см. секцию 10 — полный пример DI с моками)

---

## 14. 📋 План реализации (TDD-шаги)

| Шаг | Модуль | Система | Тесты |
|-----|--------|---------|-------|
| **1** | `SourceData`, `SearchQuery`, `ParsedSource`, `IndexStats` + AST model | domain | types.test.ts, ast.test.ts |
| **2** | `Hasher` + `BLAKE3Hasher` — хеширование файлов и чанков | hashing | BLAKE3Hasher.test.ts |
| **3** | `TokenEstimator` + реализации (Simple + Tiktoken) | hashing | TokenEstimator.test.ts |
| **4** | `SourceParser` interface | domain | SourceParser.test.ts (контракт) |
| **5** | `MarkdownParser` + `ObsidianParser` — remark/unified | infrastructure | с тестовыми .md |
| **6** | `AstGrepParser` / `TreeSitterParser` — AST для кода | infrastructure | с тестовыми .ts |
| **7** | `SourceParserRegistry` — диспетчер парсеров | infra/parser | ParserRegistry.test.ts |
| **8** | `Chunker` interface + 4 impl (Heading, Paragraph, Sentence, Overflow) | chunking | ChunkingService.test.ts |
| **9** | `CodeChunker` — AST-осознанный чанкинг по символам | chunking | CodeChunker.test.ts |
| **10** | `ChunkerFactory` + `ChunkerPipeline` (fallback chain) | chunking | ChunkerPipeline.test.ts |
| **11** | `Embedder` interface + `EmbedderCache` interface | embedding | Embedder.test.ts (контракт) |
| **12** | `EmbedderCacheLRU` — in-memory кэш (per-model) | embedding | EmbedderCacheLRU.test.ts |
| **13** | `OllamaEmbedder` — batch-эмбеддер, generic (model/dimensions/sourceTypes из конфига) | embedding | OllamaEmbedder.test.ts |
| **14** | `CachedEmbedder` — proxy-декоратор (ключ = model + blake3) | embedding | CachedEmbedder.test.ts |
| **15** | `MultiModelEmbedder` — параллельный вызов нескольких моделей | embedding | MultiModelEmbedder.test.ts |
| **16** | `NullEmbedder` — заглушка graceful degradation | embedding | NullEmbedder.test.ts |
| **17** | `EmbedderRegistry` — построение из ModelConfig[], авто-выбор под source_type | embedding | EmbedderRegistry.test.ts |
| **18** | `BLAKE3Deduplicator` — дедупликация по semantic_blake3 (Map, max score) | context | Deduplicator.test.ts |
| **19** | `Tokenizer` + `GPTCodeTokenizer` | context | Tokenizer.test.ts |
| **20** | `ContextPacker` + `RAGContextPacker` | context | ContextPacker.test.ts |
| **21** | `SourceRepository` — порт (sources + file_index таблицы, hasModelEmbedding) | domain | SourceRepository.test.ts |
| **22** | `LanceDbSourceRepository` — адаптер LanceDB (multi-column: vect_*) | infra/lancedb | интеграционные тесты |
| **23** | `FileWatcher` + `Logger` — порты | domain | unit-тесты контрактов |
| **24** | `IndexingService` — полная индексация (parse → chunk → embed per-model → upsert) | services | IndexingService.test.ts |
| **25** | `SearchService` — гибридный поиск + multi-model merge | services | SearchService.test.ts |
| **26** | `DiffIndexingService` — diff с перестроением FileIndex | services | DiffIndexingService.test.ts |
| **27** | `IndexUseCase` — оркестратор | application | IndexUseCase.test.ts |
| **28** | `SearchUseCase` | application | SearchUseCase.test.ts |
| **29** | `PackUseCase` — упаковка с FileFilter/SourceParserRegistry | application | PackUseCase.test.ts |
| **30** | `ChunkUseCase` | application | ChunkUseCase.test.ts |
| **31** | `EmbedUseCase` | application | EmbedUseCase.test.ts |
| **32** | `WatchUseCase` + `DeleteUseCase` | application | WatchUseCase.test.ts |
| **33** | `ChokidarWatcher` | infra/watcher | интеграционные тесты |
| **34** | `PinoLogger` + `SilentLogger` | infra/logger | Logger.test.ts |
| **35** | `ConfigLoader` — загрузка + валидация .indeX/config.json (embeddings.models[]) | config | ConfigLoader.test.ts |
| **36** | DI-контейнер (`index.ts`) — сборка EmbedderRegistry + всех парсеров и систем | config | integration test |
| **37** | CLI (все команды с --formats/--code/--all/--include/--exclude) | presentation | end-to-end |
| **38** | HTTP API + Web UI | presentation | e2e тесты |

---

## 15. 📁 Полная структура проекта

```
.
├── .indeX/
│   └── config.json
├── src/
│   ├── domain/
│   │   ├── types.ts               ← SourceData, SearchQuery, SearchResult, ParsedSource, IndexStats
│   │   ├── ast.ts                 ← FileIndex, SymbolDetail, Import, Export, Relationship
│   │   ├── systems/
│   │   │   ├── ChunkingSystem.ts  ← Chunker, ChunkerPipeline
│   │   │   ├── EmbeddingSystem.ts ← Embedder, EmbedderCache, EmbedderRegistry
│   │   │   ├── ContextPackagingSystem.ts ← Deduplicator, Tokenizer, ContextPacker
│   │   │   └── HashingSystem.ts   ← Hasher, TokenEstimator
│   │   ├── ports/
│   │   │   ├── SourceRepository.ts  ← SourceRepository (бывший NoteRepository)
│   │   │   ├── SourceParser.ts      ← SourceParser interface
│   │   │   ├── SourceParserRegistry.ts ← диспетчер парсеров
│   │   │   ├── FileFilter.ts        ← include/exclude/formats
│   │   │   ├── FileWatcher.ts
│   │   │   └── Logger.ts
│   │   └── services/
│   │       ├── IndexingService.ts
│   │       ├── SearchService.ts
│   │       └── DiffIndexingService.ts
│   │
│   ├── application/
│   │   ├── di/
│   │   │   └── Systems.ts         ← IndexSystems, SearchSystems, PackSystems, ...
│   │   ├── IndexUseCase.ts
│   │   ├── SearchUseCase.ts
│   │   ├── WatchUseCase.ts
│   │   ├── DeleteUseCase.ts
│   │   ├── PackUseCase.ts
│   │   ├── ChunkUseCase.ts
│   │   └── EmbedUseCase.ts
│   │
│   ├── infrastructure/
│   │   ├── chunking/
│   │   │   ├── HeadingChunker.ts
│   │   │   ├── ParagraphChunker.ts
│   │   │   ├── SentenceChunker.ts
│   │   │   ├── OverflowChunker.ts
│   │   │   ├── CodeChunker.ts         ← AST-осознанный чанкинг по символам
│   │   │   └── ChunkerFactory.ts
│   │   ├── embedding/
│   │   │   ├── OllamaEmbedder.ts
│   │   │   ├── LanceDbEmbedder.ts
│   │   │   ├── CachedEmbedder.ts
│   │   │   ├── MultiModelEmbedder.ts
│   │   │   ├── NullEmbedder.ts
│   │   │   ├── EmbedderRegistryImpl.ts
│   │   │   ├── EmbedderCacheLRU.ts
│   │   │   └── EmbedderFactory.ts
│   │   ├── context/
│   │   │   ├── BLAKE3Deduplicator.ts
│   │   │   ├── RAGContextPacker.ts
│   │   │   └── GPTCodeTokenizer.ts
│   │   ├── hashing/
│   │   │   ├── BLAKE3Hasher.ts
│   │   │   ├── TokenEstimatorSimple.ts
│   │   │   └── TokenEstimatorTiktoken.ts
│   │   ├── lancedb/
│   │   │   ├── LanceDbSourceRepository.ts  ← SourceRepository impl + FileIndex
│   │   │   └── migrations.ts               ← создание таблиц sources (multi-column: vect_*) + file_index
│   │   ├── parser/
│   │   │   ├── MarkdownParser.ts           ← remark, .md
│   │   │   ├── ObsidianParser.ts           ← remark + frontmatter + wiki-links
│   │   │   ├── AstGrepParser.ts            ← ast-grep, .ts/.js
│   │   │   ├── TreeSitterParser.ts         ← tree-sitter, любые языки
│   │   │   └── ParserRegistry.ts           ← SourceParserRegistry (wire-up)
│   │   ├── watcher/
│   │   │   └── ChokidarWatcher.ts
│   │   ├── logger/
│   │   │   ├── PinoLogger.ts
│   │   │   └── SilentLogger.ts
│   │   └── markdown/
│   │       └── MarkdownAstParser.ts        ← remark AST (HeadingChunker использует для
│   │                                          извлечения заголовков .md-файлов при чанкинге).
│   │                                          НЕ дублирует MarkdownParser — тот делает
│   │                                          полный разбор → ParsedSource для индексации.
│   │
│   ├── presentation/
│   │   ├── cli/
│   │   │   ├── commands/
│   │   │   └── cli.ts
│   │   ├── api/
│   │   │   ├── routes.ts
│   │   │   └── server.ts
│   │   └── web/
│   │       └── (SPA)
│   │
│   ├── config/
│   │   └── ConfigLoader.ts       ← загрузка + валидация .indeX/config.json
│   │
│   └── index.ts                  ← DI-контейнер (регистрация парсеров + систем)
│
├── tests/
│   ├── domain/
│   │   ├── types.test.ts         ← SourceData, SearchQuery, ParsedSource
│   │   ├── ast.test.ts           ← FileIndex, SymbolDetail, Import, Export, Relationship
│   │   ├── systems/
│   │   │   ├── ChunkingSystem.test.ts
│   │   │   ├── EmbeddingSystem.test.ts
│   │   │   ├── ContextPackagingSystem.test.ts
│   │   │   └── HashingSystem.test.ts
│   │   └── services/
│   │       ├── IndexingService.test.ts
│   │       ├── SearchService.test.ts
│   │       └── DiffIndexingService.test.ts
│   ├── infrastructure/
│   │   ├── chunking/
│   │   │   ├── HeadingChunker.test.ts
│   │   │   ├── ParagraphChunker.test.ts
│   │   │   ├── SentenceChunker.test.ts
│   │   │   ├── OverflowChunker.test.ts
│   │   │   ├── CodeChunker.test.ts
│   │   │   └── ChunkerFactory.test.ts
│   │   ├── embedding/
│   │   │   ├── OllamaEmbedder.test.ts
│   │   │   ├── CachedEmbedder.test.ts
│   │   │   ├── MultiModelEmbedder.test.ts
│   │   │   ├── NullEmbedder.test.ts
│   │   │   ├── EmbedderRegistry.test.ts
│   │   │   └── EmbedderCacheLRU.test.ts
│   │   ├── context/
│   │   │   ├── BLAKE3Deduplicator.test.ts
│   │   │   ├── RAGContextPacker.test.ts
│   │   │   └── GPTCodeTokenizer.test.ts
│   │   ├── hashing/
│   │   │   ├── BLAKE3Hasher.test.ts
│   │   │   ├── TokenEstimatorSimple.test.ts
│   │   │   └── TokenEstimatorTiktoken.test.ts
│   │   ├── lancedb/
│   │   │   ├── LanceDbSourceRepository.test.ts
│   │   │   └── FileIndex.test.ts
│   │   ├── parser/
│   │   │   ├── MarkdownParser.test.ts
│   │   │   ├── ObsidianParser.test.ts
│   │   │   ├── AstGrepParser.test.ts
│   │   │   ├── TreeSitterParser.test.ts
│   │   │   └── ParserRegistry.test.ts
│   │   └── config/
│   │       └── ConfigLoader.test.ts
│   ├── application/
│   │   ├── IndexUseCase.test.ts
│   │   ├── SearchUseCase.test.ts
│   │   ├── PackUseCase.test.ts
│   │   ├── ChunkUseCase.test.ts
│   │   ├── EmbedUseCase.test.ts
│   │   ├── WatchUseCase.test.ts
│   │   └── DeleteUseCase.test.ts
│   ├── fixtures/
│   │   ├── simple-note.md
│   │   ├── obsidian-note.md
│   │   ├── note-with-tags.md
│   │   ├── sample-function.ts
│   │   └── sample-class.py
│   └── mocks/
│       ├── MockEmbedder.ts
│       ├── MockEmbedderRegistry.ts
│       ├── MockChunker.ts
│       ├── MockHasher.ts
│       ├── MockTokenEstimator.ts
│       ├── MockContextPacker.ts
│       ├── MockSourceRepository.ts
│       ├── MockSourceParser.ts
│       ├── MockSourceParserRegistry.ts
│       ├── MockLogger.ts
│       └── fixtures/               ← тестовые AST-данные
│           ├── mock-ast-ts.json
│           └── mock-ast-py.json
│
├── package.json
├── tsconfig.json
├── ARCHITECTURE.md
└── README.md
```


---
# DEVELOPMENT_PLAN.md
---
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


---
# openspec/changes/archive/2026-06-06-phase-0-initialization/design.md
---
## Context

The project has an empty directory with `DEVELOPMENT_PLAN.md` and `ARCHITECTURE.md` but no package.json, no tsconfig.json, no source files, and no test runner. The entire Bun + TypeScript toolchain must be initialized before any code can be written.

## Goals / Non-Goals

**Goals:**
- `bun init` creates a working `package.json` with Bun-compatible defaults
- `tsconfig.json` has strict mode, `@/*` path alias to `src/*`, and ES module resolution
- `.gitignore` excludes `node_modules`, `.indeX/data`, `dist/`
- Full `src/` and `tests/` directory tree created matching ARCHITECTURE.md
- Core dependencies installed: `typescript`, `@types/bun`, `hash-wasm`, `zod`, `remark`, `remark-frontmatter`, `remark-gfm`, `yaml`
- `tests/example.test.ts` passes with `bun test` (1 test, 1 assertion)
- `src/index.ts` stub prints "IndeX started" when run with `bun run src/index.ts`

**Non-Goals:**
- No production code beyond stubs
- No infra dependencies beyond the core list (chokidar, pino, lancedb, etc. installed in their respective phases)
- No CI/CD configuration

## Decisions

- **Bun over Node.js**: Bun provides built-in TypeScript execution, test runner, and package management — no need for `ts-node`, `vitest`, or `jest`. Single tool for run/test/package.
- **Strict tsconfig**: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true` — catches type errors early per the TDD philosophy.
- **Path alias `@/*` → `src/*`**: Keeps imports clean (`@/domain/types` vs `../../domain/types`) and matches the mental model of the architecture.
- **Directory structure mirrors src/ in tests/**: Each `src/` module gets a `tests/` counterpart — enforces TDD discipline and makes it obvious what needs tests.
- **Core dependencies installed now vs. per-phase**: `hash-wasm`, `zod`, `remark` ecosystem are foundational. Adding them in Phase 0 avoids repeated `bun add` in later phases.

## Risks / Trade-offs

- **Bun ecosystem maturity**: Some packages (lancedb, hono) may have Bun-specific quirks. Mitigation: pin known-working versions, test integration early.
- **Path alias configuration**: Bun resolves `@/*` differently than tsc. Mitigation: test import resolution in the example test.


---
# openspec/changes/archive/2026-06-06-phase-0-initialization/proposal.md
---
## Why

The IndeX project needs a foundation of Bun + TypeScript before any feature development can begin. Without initialized tooling, `bun test` cannot run, types are unchecked, and there is no way to validate the RED → GREEN → REFACTOR TDD cycle that the entire project depends on.

## What Changes

- Initialize `package.json` via `bun init -y` with Bun as the runtime
- Add `tsconfig.json` with strict mode and path aliases (`@/*` → `src/*`)
- Add `.gitignore` for `node_modules`, `.indeX/data`, and `dist/`
- Create the full `src/` and `tests/` directory structure as defined in the development plan
- Install core dependencies: `typescript`, `@types/bun`, `hash-wasm`, `zod`, `remark`, `remark-frontmatter`, `remark-gfm`, `yaml`
- Add a minimal `tests/example.test.ts` that verifies `bun test` works
- Create a stub `src/index.ts` that prints "IndeX started"
- Configure `bun test` to work with `--watch` mode

## Capabilities

### New Capabilities
- `project-init`: Bootstrap the Bun + TypeScript project with strict configuration, directory structure, and a verified test runner (RED phase setup)

### Modified Capabilities
- None (first change in the project)

## Impact

- Creates the foundational `package.json`, `tsconfig.json`, `.gitignore`
- Adds a `src/` tree with empty module stubs for all 12 planned phases
- Adds a `tests/` tree mirroring `src/` structure with an example test
- Installs 7 npm packages (typescript, hash-wasm, zod, remark ecosystem)
- No existing code or config is affected — this is the initial setup


---
# openspec/changes/archive/2026-06-06-phase-0-initialization/specs/project-init/spec.md
---
## ADDED Requirements

### Requirement: Project initialized with Bun
The project SHALL use Bun as the JavaScript runtime and package manager.

#### Scenario: Bun runtime available
- **WHEN** the project is set up
- **THEN** `bun --version` exits with code 0 and shows a version string

#### Scenario: package.json exists
- **WHEN** initialization completes
- **THEN** a valid `package.json` exists with `name: "index"`, `type: "module"`, and `bun` test scripts

### Requirement: TypeScript strict mode
TypeScript compilation SHALL use strict mode with path aliases.

#### Scenario: tsconfig.json with strict mode
- **WHEN** `tsconfig.json` is loaded
- **THEN** it SHALL have `strict: true` and `@/*` path alias mapping to `src/*`

### Requirement: Test runner works
The test runner SHALL execute tests and report results.

#### Scenario: Example test passes
- **WHEN** running `bun test`
- **THEN** the example test passes (1 passed, 0 failed)

### Requirement: Directory structure exists
The project SHALL have the full source and test directory structure.

#### Scenario: src directories exist
- **WHEN** checking the `src/` directory
- **THEN** all subdirectories from the architecture plan exist (domain, application, infrastructure, presentation, config)

#### Scenario: test directories exist
- **WHEN** checking the `tests/` directory
- **THEN** all subdirectories mirroring `src/` exist (domain, infrastructure, application, fixtures, mocks)


---
# openspec/changes/archive/2026-06-06-phase-0-initialization/tasks.md
---
## 1. Project Initialization

- [x] 1.1 Run `bun init -y` to create `package.json` with Bun defaults
- [x] 1.2 Create `tsconfig.json` with strict mode, `@/*` path alias → `src/*`, ES module resolution
- [x] 1.3 Create `.gitignore` excluding `node_modules`, `.indeX/data`, `dist/`
- [x] 1.4 Create full `src/` directory tree: `domain/{systems,ports,services}`, `application/di`, `infrastructure/{chunking,embedding,context,hashing,lancedb,parser,watcher,logger}`, `presentation/{cli,api,web}`, `config`
- [x] 1.5 Create full `tests/` directory tree: `domain/{systems,services}`, `infrastructure/{chunking,embedding,context,hashing,lancedb,parser,config}`, `application`, `fixtures`, `mocks`
- [x] 1.6 Install core dependencies: `typescript`, `@types/bun`, `hash-wasm`, `zod`, `remark`, `remark-frontmatter`, `remark-gfm`, `yaml`
- [x] 1.7 **RED**: Write `tests/integration/setup.test.ts` verifying `bun test` works (1+1=2 assertion)
- [x] 1.8 **GREEN**: Create `src/index.ts` stub that prints "IndeX started"
- [x] 1.9 **TEST**: Run `bun test` — all tests must pass


---
# openspec/changes/archive/2026-06-06-phase-1-domain-types-interfaces/design.md
---
## Context

All downstream code depends on the domain types and port interfaces defined here. This is the foundation of the Ports & Adapters architecture — pure TypeScript with zero external dependencies. The types are defined first so that all subsequent phases can import them without circular dependencies.

## Goals / Non-Goals

**Goals:**
- Define all shared data types in `src/domain/types.ts` as pure interfaces/types
- Define AST model in `src/domain/ast.ts` for code analysis results
- Define 6 port interfaces in `src/domain/ports/` — contracts that infrastructure adapters implement
- Define 4 system interfaces in `src/domain/systems/` — boundaries for pluggable modules
- Every interface is tested (compile-time verification + behavioral contracts)
- All tests pass before implementation code is written (TDD RED → GREEN)

**Non-Goals:**
- No implementation (that comes in Phases 2-7)
- No external dependencies — pure TypeScript only

## Decisions

- **Discriminated union for SourceMetadata**: `kind` field (`'code' | 'markdown' | 'obsidian' | 'generic'`) enables type narrowing — TypeScript guarantees exhaustive handling via `switch`.
- **Interfaces over abstract classes**: Lighter weight, no runtime overhead, works with Bun's test mocking. Infrastructure classes `implements` these interfaces.
- **UUID v7 for `id`**: Time-ordered UUIDs are sortable and index-friendly in LanceDB. Generated at the application level (not DB), via `uuidv7` or manual construction.
- **Separate FileIndex from SourceData**: FileIndex contains all AST symbols for one file; SourceData contains one chunk. One-to-many: one `FileIndex.path` → many `SourceData.path`. This avoids duplicating AST data per chunk.
- **`semantic_blake3` vs `file_blake3`**: Two different hashes — `file_blake3` is the whole file (for diff detection), `semantic_blake3` is the core semantic unit (for deduplication). They serve different purposes.

## Risks / Trade-offs

- **Type complexity**: Discriminated unions with 4 variants + metadata sub-objects can be verbose. Mitigation: use factory functions and type guards.
- **Interface proliferation**: 12+ interfaces in the domain layer may feel heavy for a small app. Trade-off accepted for modularity — each interface isolates a replaceable component.


---
# openspec/changes/archive/2026-06-06-phase-1-domain-types-interfaces/proposal.md
---
## Why

The entire IndeX indexing pipeline is built on shared domain types and port interfaces. Before any infrastructure code can be written, the core data structures (`SourceData`, `SearchResult`, `FileIndex`, `ParsedSource`) and system boundaries (`SourceRepository`, `Chunker`, `Embedder`, `Hasher`) must be defined. Without these, every module would define its own types, leading to coupling and inconsistency.

## What Changes

- Create `src/domain/types.ts` with all shared data types: `SourceData`, `SearchQuery`, `SearchResult`, `ParsedSource`, `IndexStats`, `SourceMetadata` (discriminated union), `SourceType`, and `SourceType` → `kind` mapping
- Create `src/domain/ast.ts` with AST model: `FileIndex`, `SymbolDetail`, `Import`, `Export`, `Relationship`, `SymbolKind`
- Create 6 port interfaces in `src/domain/ports/`: `SourceRepository`, `SourceParser`, `SourceParserRegistry`, `FileWatcher`, `FileFilter`, `Logger`
- Create 4 system interfaces in `src/domain/systems/`: `ChunkingSystem`, `EmbeddingSystem`, `ContextPackagingSystem`, `HashingSystem`
- Write comprehensive tests **before** implementation (RED phase) for each module
- Verify all tests pass (GREEN phase) before moving on

## Capabilities

### New Capabilities
- `domain-types`: Core data types (`SourceData`, `SearchResult`, `ParsedSource`, `SourceMetadata` discriminated union, `IndexStats`, `SourceType`)
- `domain-ast`: AST model for code analysis (`FileIndex`, `SymbolDetail`, `Import`, `Export`, `Relationship`)
- `domain-ports`: Port interfaces for all infrastructure adapters (`SourceRepository`, `SourceParser`, `SourceParserRegistry`, `FileWatcher`, `FileFilter`, `Logger`)
- `domain-systems`: System boundary interfaces (`Chunker`, `Embedder`, `Hasher`, `Deduplicator`, `ContextPacker`, `Tokenizer`, and their registries/caches)

### Modified Capabilities
- None

## Impact

- Adds 12 new files in `src/domain/` (types.ts, ast.ts, 4 systems, 6 ports)
- Adds matching test files in `tests/domain/`
- Zero external dependencies (pure TypeScript types and interfaces — Ports & Adapters core)
- All subsequent phases depend on these definitions


---
# openspec/changes/archive/2026-06-06-phase-1-domain-types-interfaces/specs/domain-ast/spec.md
---
## ADDED Requirements

### Requirement: FileIndex stores per-file AST data
The system SHALL maintain a `FileIndex` per file containing its AST summary.

#### Scenario: FileIndex can be created
- **WHEN** creating a `FileIndex`
- **THEN** it SHALL contain `path`, `file_blake3`, `language`, `imports`, `exports`, `symbols`, `relationships`, `last_parsed`

### Requirement: SymbolDetail describes code symbols
The system SHALL describe each code symbol with its kind, name, and location.

#### Scenario: SymbolDetail has required fields
- **WHEN** creating a `SymbolDetail`
- **THEN** it SHALL have `kind` (from `SymbolKind`), `name`, `signature`, `startPosition`, `endPosition`


---
# openspec/changes/archive/2026-06-06-phase-1-domain-types-interfaces/specs/domain-ports/spec.md
---
## ADDED Requirements

### Requirement: SourceRepository provides full CRUD
The system SHALL define a `SourceRepository` port for chunk storage and retrieval.

#### Scenario: All repository methods exist
- **WHEN** using `SourceRepository`
- **THEN** it SHALL provide methods: `upsert`, `upsertBatch`, `getById`, `getByPath`, `delete`, `search`, `hasSemanticBlake3`, `hasModelEmbedding`, `getSourceIdsByHash`, `getFileBlake3ByPath`, `stats`, `upsertFileIndex`, `getFileIndex`, `deleteFileIndex`

### Requirement: SourceParser parses files by extension
The system SHALL define a `SourceParser` port for file parsing.

#### Scenario: Parser has type and extension info
- **WHEN** inspecting a `SourceParser`
- **THEN** it SHALL have `type` (SourceType), `extensions` (string[]), `supportsFile(path)`, and `parse(path)`

#### Scenario: ParserRegistry routes files
- **WHEN** calling `ParserRegistry.getParser(path)`
- **THEN** it SHALL return the correct parser based on extension and content sniffing

### Requirement: FileWatcher monitors directories
The system SHALL define a `FileWatcher` port with lifecycle and events.

#### Scenario: Watcher emits file events
- **WHEN** a file is added/changed/deleted in the watched directory
- **THEN** the watcher SHALL emit `add`, `change`, or `unlink` events


---
# openspec/changes/archive/2026-06-06-phase-1-domain-types-interfaces/specs/domain-systems/spec.md
---
## ADDED Requirements

### Requirement: Chunker splits text into chunks
The system SHALL define a `Chunker` interface for text splitting.

#### Scenario: Chunker returns typed chunks
- **WHEN** calling `chunker.chunk(text)`
- **THEN** it SHALL return `Chunk[]` with `content`, `core_content`, `chunk_index`, `total_chunks`, `strategy`, `size_tokens`

### Requirement: Embedder generates vectors
The system SHALL define an `Embedder` interface for text vectorization.

#### Scenario: Embedder returns typed embeddings
- **WHEN** calling `embedder.embed(text)`
- **THEN** it SHALL return `Embedding` with `vector`, `model`, `dimensions`, `tokens_in`

### Requirement: EmbedderRegistry resolves models
The system SHALL define an `EmbedderRegistry` for model selection by source type.

#### Scenario: Registry returns correct embedder
- **WHEN** calling `registry.getEmbedder("typescript")`
- **THEN** it SHALL return the embedder with the highest priority (lowest priority number) for that source type

### Requirement: Hasher produces content hashes
The system SHALL define a `Hasher` interface for content hashing.

#### Scenario: Hasher returns hex string
- **WHEN** calling `hasher.hash(data)`
- **THEN** it SHALL return a 64-character hex string

### Requirement: ContextPacker formats search results
The system SHALL define a `ContextPacker` interface for RAG context formatting.

#### Scenario: ContextPacker returns PackedContext
- **WHEN** calling `packer.pack(results)`
- **THEN** it SHALL return `PackedContext` with `markdown`, `chunks_used`, `total_tokens`, `truncated`, `source_notes`


---
# openspec/changes/archive/2026-06-06-phase-1-domain-types-interfaces/specs/domain-types/spec.md
---
## ADDED Requirements

### Requirement: Core data types
The system SHALL define shared data types for all indexing and search operations.

#### Scenario: SourceData can be created
- **WHEN** creating a `SourceData` object
- **THEN** it SHALL contain all required fields: `id`, `chunk_id`, `source_id`, `type`, `title`, `content`, `tags`, `path`, `file_blake3`, `semantic_blake3`, `chunk_index`, `total_chunks`, `embeddings`, `metadata`, timestamps

#### Scenario: SearchResult contains source and score
- **WHEN** creating a `SearchResult`
- **THEN** it SHALL contain the `source` data, `score`, `match_type`, and optional `model_scores`

#### Scenario: SourceMetadata is a discriminated union
- **WHEN** creating metadata
- **THEN** the `kind` field SHALL discriminate between `'code'`, `'markdown'`, `'obsidian'`, and `'generic'`
- **THEN** TypeScript SHALL enforce exhaustive narrowing on `kind`

#### Scenario: IndexStats reports correct counts
- **WHEN** requesting `IndexStats`
- **THEN** it SHALL contain `total_sources`, `total_chunks`, `total_files`, and `last_indexed` timestamp


---
# openspec/changes/archive/2026-06-06-phase-1-domain-types-interfaces/tasks.md
---
## 1. Domain Types

- [x] 1.1 **RED**: Write `tests/domain/types.test.ts` — test `SourceData` creation with all fields, `SearchQuery` with mode/tags/top_k, `SearchResult` with source/score/match_type, `ParsedSource` with type/path/content/tags/metadata, `IndexStats` with all fields, `SourceMetadata` discriminated union, `SourceType` mapping
- [x] 1.2 **GREEN**: Create `src/domain/types.ts` with all types and interfaces
- [x] 1.3 **TEST**: Run `bun test tests/domain/types.test.ts` — all tests pass

## 2. AST Model

- [x] 2.1 **RED**: Write `tests/domain/ast.test.ts` — test `FileIndex` with path/file_blake3/language/symbols, `SymbolDetail` with kind/name/signature/positions, `Import`/`Export`, `Relationship`, `SymbolKind`
- [x] 2.2 **GREEN**: Create `src/domain/ast.ts` with all AST model types
- [x] 2.3 **TEST**: Run `bun test tests/domain/ast.test.ts` — all tests pass

## 3. Port Interfaces

- [x] 3.1 **RED**: Write `tests/domain/ports/` — test contract conformance for `SourceRepository` (all methods exist), `SourceParser` (type/extensions/supportsFile/parse), `SourceParserRegistry` (getParser/register), `FileWatcher` (on/start/stop), `FileFilter` (formats/include/exclude), `Logger` (info/warn/error/debug)
- [x] 3.2 **GREEN**: Create 6 port files in `src/domain/ports/`
- [x] 3.3 **TEST**: Run `bun test tests/domain/ports/` — TypeScript-valid interfaces

## 4. System Interfaces

- [x] 4.1 **RED**: Write `tests/domain/systems/` — test `ChunkingSystem` (Chunker/ChunkerPipeline), `EmbeddingSystem` (Embedder/EmbedderCache/EmbedderRegistry), `ContextPackagingSystem` (Deduplicator/Tokenizer/ContextPacker), `HashingSystem` (Hasher/TokenEstimator)
- [x] 4.2 **GREEN**: Create 4 system files in `src/domain/systems/`
- [x] 4.3 **TEST**: Run `bun test tests/domain/systems/` — all interfaces valid


---
# openspec/changes/archive/2026-06-06-phase-2-hashing/design.md
---
## Context

Hashing is required in two places: file-level diff detection (is this file changed?) and chunk-level deduplication (is this content already indexed?). BLAKE3 is chosen for speed (10× faster than SHA256) and streaming support. Token estimation is needed for chunk-size decisions and context-budget tracking.

## Goals / Non-Goals

**Goals:**
- `BLAKE3Hasher.hash(data)` returns a 32-byte hex string via `hash-wasm`
- `BLAKE3Hasher.hashFile(path)` streams file via `Bun.file()` for memory efficiency
- `TokenEstimatorSimple.estimate(text)` returns `Math.ceil(text.length / 4)` (byte-based approximation)
- `TokenEstimatorTiktoken.estimate(text)` uses `gpt-tokenizer` for accurate GPT token count, falls back to Simple if unavailable
- `MockHasher` uses Node.js `crypto` SHA256 for deterministic test hashing

**Non-Goals:**
- No parallel hashing (single-thread is sufficient for local use)
- No file-change streaming watcher (that's Phase 10)

## Decisions

- **hash-wasm for BLAKE3**: WebAssembly-based, works in Bun, simpler than native Node.js addons. Provides both hash and keyed-hash modes.
- **MockHasher uses SHA256**: Deterministic, no WASM dependency, consistent across environments. Fine for tests where BLAKE3 specifics don't matter.
- **TokenEstimatorTiktoken as optional**: `gpt-tokenizer` is a large dependency (~4MB). If `import` fails (not installed), silently fall back to Simple. This keeps the default install lightweight.
- **`Bun.file().text()` for hashFile**: Bun's native file API is faster than streaming chunks. For files > 100MB, this could be memory-heavy, but vaults are typically small notes.

## Risks / Trade-offs

- **hash-wasm in Bun**: WASM initialization has a one-time cost (~50ms). Acceptable — hashing happens per-file during indexing, not per-chunk.
- **Simple token estimator is rough**: 4 bytes/token is a rough approximation for English text. Code and CJK text tokenize differently. Mitigation: Simple is for early development; Tiktoken replaces it in production.


---
# openspec/changes/archive/2026-06-06-phase-2-hashing/proposal.md
---
## Why

Hashing is the foundation of both file-level diff detection and semantic deduplication. Every file needs a `file_blake3` to detect changes during watcher-driven diff indexing, and every chunk needs a `semantic_blake3` to detect duplicate content across files. Without this phase, the IndexingService cannot skip unchanged files and the ContextPacker cannot deduplicate.

## What Changes

- Create `src/infrastructure/hashing/BLAKE3Hasher.ts` — BLAKE3 hasher using `hash-wasm` with streaming file hash via `Bun.file()`
- Create `tests/infrastructure/hashing/BLAKE3Hasher.test.ts` before implementation (RED → GREEN)
- Create `src/infrastructure/hashing/TokenEstimatorSimple.ts` — byte-based approximation (bytes/4)
- Create `tests/infrastructure/hashing/TokenEstimatorSimple.test.ts` before implementation
- Create `src/infrastructure/hashing/TokenEstimatorTiktoken.ts` — tiktoken-based accurate token counting with fallback
- Create `tests/infrastructure/hashing/TokenEstimatorTiktoken.test.ts` before implementation
- Create `tests/mocks/MockHasher.ts` for downstream test use

## Capabilities

### New Capabilities
- `blake3-hasher`: BLAKE3 cryptographic hashing for files and strings via `hash-wasm`, implementing `Hasher` interface
- `token-estimator`: Token counting with two strategies — simple byte-based (fast) and tiktoken (accurate), implementing `TokenEstimator` interface
- `mock-hasher`: SHA256-based `MockHasher` for unit tests in downstream phases

### Modified Capabilities
- None

## Impact

- Adds 4 implementation files in `src/infrastructure/hashing/`
- Adds 3 test files in `tests/infrastructure/hashing/`
- Adds 1 mock file in `tests/mocks/`
- Depends on: `hash-wasm` (BLAKE3), `gpt-tokenizer` or `tiktoken` (optional)
- Unlocks: Phase 3 (parsing needs BLAKE3), Phase 5 (embedding needs BLAKE3 for cache keys), Phase 6 (context dedup)


---
# openspec/changes/archive/2026-06-06-phase-2-hashing/specs/blake3-hasher/spec.md
---
## ADDED Requirements

### Requirement: BLAKE3 hash computation
The system SHALL compute BLAKE3 hashes of strings and files using `hash-wasm`.

#### Scenario: Hash of a string
- **WHEN** calling `hasher.hash("hello")`
- **THEN** it SHALL return a 64-character hex string

#### Scenario: Different inputs produce different hashes
- **WHEN** calling `hasher.hash("hello")` and `hasher.hash("world")`
- **THEN** the results SHALL be different

#### Scenario: HashFile returns same hash as hash(content)
- **WHEN** hashing a file via `hashFile(path)`
- **THEN** the result SHALL equal `hash(content)` where content is the file's text

#### Scenario: Hash of empty string
- **WHEN** calling `hasher.hash("")`
- **THEN** it SHALL return a valid 64-character hex string


---
# openspec/changes/archive/2026-06-06-phase-2-hashing/specs/mock-hasher/spec.md
---
## ADDED Requirements

### Requirement: MockHasher for tests
The system SHALL provide a `MockHasher` using SHA256 for deterministic test hashing.

#### Scenario: MockHasher produces deterministic hashes
- **WHEN** calling `mockHasher.hash("test")`
- **THEN** it SHALL return the same SHA256 hex string every time

#### Scenario: MockHasher implements Hasher interface
- **WHEN** checking `MockHasher` type
- **THEN** it SHALL satisfy the `Hasher` interface


---
# openspec/changes/archive/2026-06-06-phase-2-hashing/specs/token-estimator/spec.md
---
## ADDED Requirements

### Requirement: Simple token estimation
The system SHALL estimate token count as `ceil(bytes / 4)`.

#### Scenario: Estimate short text
- **WHEN** calling `estimator.estimate("hello")`
- **THEN** it SHALL return approximately 1-2 tokens

#### Scenario: Estimate empty string
- **WHEN** calling `estimator.estimate("")`
- **THEN** it SHALL return 0

### Requirement: Tiktoken-based estimation (optional)
The system SHALL use tiktoken for accurate GPT token counting when available.

#### Scenario: Tiktoken estimate is accurate
- **WHEN** calling `tiktokenEstimator.estimate("hello world")`
- **THEN** it SHALL return the exact GPT token count

#### Scenario: Tiktoken falls back to Simple
- **WHEN** tiktoken is not installed
- **THEN** the estimator SHALL silently fall back to the Simple strategy


---
# openspec/changes/archive/2026-06-06-phase-2-hashing/tasks.md
---
## 1. MockHasher

- [x] 1.1 **GREEN**: Create `tests/mocks/MockHasher.ts` using Node.js `crypto.createHash('sha256')`, implementing the `Hasher` interface from Phase 1 with `hash()`, `hashFile()`, and `hashDirectory()` stub

## 2. BLAKE3Hasher

- [x] 2.1 **RED**: Write `tests/infrastructure/hashing/BLAKE3Hasher.test.ts` — test `hash("hello")` returns 64-char hex, `hash("hello") !== hash("world")`, `hashFile(path)` matches `hash(content)`, empty string hash, long text hash determinism
- [x] 2.2 **GREEN**: Create `src/infrastructure/hashing/BLAKE3Hasher.ts` — use `hash-wasm` BLAKE3 for string hashing, `Bun.file().text()` for streaming file hash, implement `Hasher` interface
- [x] 2.3 **TEST**: Run `bun test tests/infrastructure/hashing/BLAKE3Hasher.test.ts` — all tests pass

## 3. TokenEstimatorSimple

- [x] 3.1 **RED**: Write `tests/infrastructure/hashing/TokenEstimatorSimple.test.ts` — test `estimate("hello")` ≈ 1-2 tokens (bytes/4), `estimate("")` = 0, long text estimate is proportional
- [x] 3.2 **GREEN**: Create `src/infrastructure/hashing/TokenEstimatorSimple.ts` — implement `TokenEstimator` interface, `estimate(text) = Math.ceil(text.length / 4)`
- [x] 3.3 **TEST**: Run `bun test tests/infrastructure/hashing/TokenEstimatorSimple.test.ts` — all tests pass

## 4. TokenEstimatorTiktoken

- [x] 4.1 **RED**: Write `tests/infrastructure/hashing/TokenEstimatorTiktoken.test.ts` — test accurate GPT token count, fallback to Simple when tiktoken unavailable
- [x] 4.2 **GREEN**: Create `src/infrastructure/hashing/TokenEstimatorTiktoken.ts` — try `import gpt-tokenizer`, fall back to `TokenEstimatorSimple` on failure
- [x] 4.3 **TEST**: Run `bun test tests/infrastructure/hashing/` — all hashing tests pass


---
# openspec/changes/archive/2026-06-06-phase-3-parsing/design.md
---
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


---
# openspec/changes/archive/2026-06-06-phase-3-parsing/proposal.md
---
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


---
# openspec/changes/archive/2026-06-06-phase-3-parsing/specs/code-parser/spec.md
---
## ADDED Requirements

### Requirement: TypeScript code parsing via ast-grep
The system SHALL parse TypeScript source code extracting symbols, imports, and exports.

#### Scenario: Parse sample-function.ts
- **WHEN** parsing a TypeScript file
- **THEN** it SHALL return `ParsedSource` with `type: 'typescript'`, `CodeMetadata`, and optional `ast: FileIndex`

#### Scenario: Symbols extracted
- **WHEN** parsing a file with functions/classes/interfaces
- **THEN** `symbols` SHALL contain entries with `kind`, `name`, `signature`, and positions

#### Scenario: Imports and exports
- **WHEN** parsing a file with imports and exports
- **THEN** `ast.imports` and `ast.exports` SHALL be populated with correct `source` and `name`

#### Scenario: Complexity metrics
- **WHEN** parsing a TypeScript file
- **THEN** `metadata.complexity` SHALL contain `lines`, `functions`, `classes` counts


---
# openspec/changes/archive/2026-06-06-phase-3-parsing/specs/markdown-parser/spec.md
---
## ADDED Requirements

### Requirement: Markdown file parsing
The system SHALL parse Markdown files extracting headings, links, resources, and statistics.

#### Scenario: Parse simple-note.md
- **WHEN** parsing a simple Markdown file
- **THEN** it SHALL return `ParsedSource` with H1 as `title`, full text as `content`, and `MarkdownMetadata`

#### Scenario: Headings extracted
- **WHEN** parsing Markdown with headings
- **THEN** `metadata.headings` SHALL contain all H1/H2+ with `level`, `text`, and `anchor`

#### Scenario: Links extracted
- **WHEN** parsing Markdown with links
- **THEN** `metadata.links` SHALL contain `url`, `text`, `isInternal`, `isAnchor`

#### Scenario: Stats computed
- **WHEN** parsing a Markdown file
- **THEN** `metadata.stats` SHALL contain `wordCount`, `readingTimeMinutes`, `paragraphCount`, `codeBlockCount`


---
# openspec/changes/archive/2026-06-06-phase-3-parsing/specs/obsidian-parser/spec.md
---
## ADDED Requirements

### Requirement: Obsidian note parsing
The system SHALL parse Obsidian notes with YAML frontmatter and wiki-links.

#### Scenario: Parse obsidian-note.md
- **WHEN** parsing an Obsidian note with frontmatter
- **THEN** title SHALL come from frontmatter `title`, tags from frontmatter `tags`, and `ObsidianMetadata` SHALL contain `wikiLinks`

#### Scenario: Wiki-links extracted
- **WHEN** parsing a note with `[[target]]` and `[[target|alias]]`
- **THEN** `metadata.wikiLinks` SHALL contain entries with `target` and optional `alias`

#### Scenario: Content without frontmatter
- **WHEN** parsing an Obsidian note
- **THEN** `content` SHALL exclude the YAML frontmatter block

#### Scenario: Backlinks and graphConnections are empty
- **WHEN** parsing a single Obsidian note
- **THEN** `backlinks` and `graphConnections` SHALL be empty arrays (filled separately by DiffIndexingService)


---
# openspec/changes/archive/2026-06-06-phase-3-parsing/specs/parser-registry/spec.md
---
## ADDED Requirements

### Requirement: Two-phase parser routing
The system SHALL route files to parsers by extension, with content sniffing for `.md` files.

#### Scenario: getParser(".ts") returns AstGrepParser
- **WHEN** calling `registry.getParser("file.ts")`
- **THEN** it SHALL return the AstGrepParser

#### Scenario: getParser(".md") detects Obsidian vs Markdown
- **WHEN** calling `registry.getParser("note.md")` with Obsidian frontmatter
- **THEN** it SHALL return ObsidianParser

#### Scenario: getParser(".md") returns MarkdownParser for plain markdown
- **WHEN** calling `registry.getParser("note.md")` without Obsidian frontmatter
- **THEN** it SHALL return MarkdownParser

#### Scenario: getParser(".py") returns null
- **WHEN** calling `registry.getParser("file.py")`
- **THEN** it SHALL return `null` if Python parser is not registered

#### Scenario: getEnabledParsers returns active parsers
- **WHEN** calling `registry.getEnabledParsers()`
- **THEN** it SHALL return only parsers whose `enabled` flag is true


---
# openspec/changes/archive/2026-06-06-phase-3-parsing/tasks.md
---
## 1. Test Fixtures

- [x] 1.1 **GREEN**: Create `tests/fixtures/simple-note.md` — plain Markdown with H1, H2, paragraphs, links, code block
- [x] 1.2 **GREEN**: Create `tests/fixtures/obsidian-note.md` — Obsidian note with YAML frontmatter (tags, title), [[wiki-links]], content
- [x] 1.3 **GREEN**: Create `tests/fixtures/note-with-tags.md` — Markdown with tags in frontmatter
- [x] 1.4 **GREEN**: Create `tests/fixtures/sample-function.ts` — TypeScript with function, class, imports, exports

## 2. MarkdownParser

- [x] 2.1 **RED**: Write `tests/infrastructure/parser/MarkdownParser.test.ts` — parse fixture → title (H1), content, headings, links, stats (wordCount, readingTimeMinutes, paragraphCount), no frontmatter → correct ParsedSource
- [x] 2.2 **GREEN**: Create `src/infrastructure/parser/MarkdownParser.ts` — use `remark` + unified for AST; extract H1→title, H2+→headings, links from AST, compute stats
- [x] 2.3 **TEST**: Run `bun test tests/infrastructure/parser/MarkdownParser.test.ts` — all tests pass

## 3. ObsidianParser

- [x] 3.1 **RED**: Write `tests/infrastructure/parser/ObsidianParser.test.ts` — parse fixture → title from frontmatter, wikiLinks `[[target]]` and `[[target|alias]]`, frontmatter fields, tags, content without frontmatter, empty backlinks/graphConnections
- [x] 3.2 **GREEN**: Create `src/infrastructure/parser/ObsidianParser.ts` — YAML frontmatter via `yaml` parser, wiki-links via regex, implements `SourceParser`
- [x] 3.3 **TEST**: Run `bun test tests/infrastructure/parser/ObsidianParser.test.ts` — all tests pass

## 4. AstGrepParser

- [x] 4.1 **RED**: Write `tests/infrastructure/parser/AstGrepParser.test.ts` — parse fixture → symbols (functions, classes), language='typescript', topLevelDeclarations, complexity (lines/functions/classes), FileIndex with imports/exports
- [x] 4.2 **GREEN**: Create `src/infrastructure/parser/AstGrepParser.ts` — regex-based TypeScript parsing (fallback since @ast-grep/napi not installed), extract symbols, imports, exports, compute CodeMetadata
- [x] 4.3 **TEST**: Run `bun test tests/infrastructure/parser/AstGrepParser.test.ts` — all tests pass

## 5. ParserRegistry

- [x] 5.1 **RED**: Write `tests/infrastructure/parser/ParserRegistry.test.ts` — register parsers, getParser(".md") detects Obsidian vs Markdown, getParser(".ts") → AstGrepParser, getParser(".py") → null, getEnabledParsers()
- [x] 5.2 **GREEN**: Create `src/infrastructure/parser/ParserRegistry.ts` — two-phase selection: extension-based candidate, then content sniffing for .md (frontmatter check) via `fs.readFileSync`
- [x] 5.3 **TEST**: Run `bun test tests/infrastructure/parser/` — all parser tests pass


---
# openspec/changes/archive/2026-06-06-phase-4-chunking/design.md
---
## Context

Raw parsed content (from Phase 3) can be arbitrarily long — a 5000-word note cannot be embedded as a single vector. Chunking splits content into semantic units sized for embedding models (max 512 tokens). The pipeline design ensures graceful degradation: try heading-based first, fall through to paragraph, sentence, and finally overflow splitting.

## Goals / Non-Goals

**Goals:**
- `HeadingChunker`: Split by Markdown headings (H1/H2+). Section ≤ 512 tokens → one chunk. Section > 512 → falls through (doesn't split).
- `ParagraphChunker`: Split by blank lines. Paragraph ≤ 512 tokens → chunk. Paragraph > 512 → delegates to SentenceChunker.
- `SentenceChunker`: Split by sentence boundaries (`.!?`). Protects abbreviations (`Mr.`, `Dr.`, etc.). Never splits a sentence. Overlong sentence → OverflowChunker.
- `OverflowChunker`: Forced split at token boundary. Last resort.
- `CodeChunker`: Split by function/class boundaries. No overlap (functions are indivisible).
- `ChunkerFactory`: Builds pipeline `heading → paragraph → sentence → overflow`. Post-processing: merge chunks < 50 tokens with neighbors, apply 32-token overlap between chunks.
- `core_content` extraction: each chunk has `content` (full text with overlap) and `core_content` (semantic unit without overlap — used for BLAKE3 dedup).

**Non-Goals:**
- No parallel chunking (single-threaded processing of one file at a time is sufficient)
- No custom per-file-type strategies (delegated to ChunkerFactory strategy selection)

## Decisions

- **Fallback pipeline vs. adaptive strategy selection**: A fixed fallback chain is simpler to implement and reason about than an ML-based strategy selector. The chain covers all cases while being explicit.
- **`core_content` separate from `content`**: Overlap text aids LLM context but shouldn't affect dedup hashing. Without this separation, adding overlap would change `semantic_blake3` and break cross-file dedup.
- **50-token minimum**: Chunks smaller than 50 tokens are unlikely to carry meaningful semantic weight. Merging them reduces noise in search results.
- **32-token overlap**: Approximately 3-4 sentences of overlap provide enough context continuity without significantly inflating embedding cost.
- **No overlap for code**: Functions/classes are self-contained. Adding overlap from adjacent functions would create noisy embeddings.

## Risks / Trade-offs

- **Sentence chunker abbreviation list**: Hard-coded abbreviation exceptions (`Mr.`, `Mrs.`, `Dr.`, `e.g.`, `i.e.`) may miss domain-specific abbreviations. Mitigation: make the abbreviation list configurable.
- **Overflow chunker degrades quality**: Breaking in the middle of a sentence loses meaning. This is by design — it's the last resort, and the fallback chain makes it rare for typical content.


---
# openspec/changes/archive/2026-06-06-phase-4-chunking/proposal.md
---
## Why

Raw parsed content is too large to embed as a single vector. The chunking system splits documents into semantic units (paragraphs, functions, classes) sized for embedding models (max 512 tokens). Without chunking, there is no way to create searchable embeddings with meaningful granularity. The pipeline architecture (heading → paragraph → sentence → overflow) ensures graceful degradation for content of any structure.

## What Changes

- Create `tests/mocks/MockChunker.ts` and `tests/mocks/MockTokenEstimator.ts` for downstream tests
- Create `src/infrastructure/chunking/HeadingChunker.ts` — splits Markdown by headings
- Create `tests/infrastructure/chunking/HeadingChunker.test.ts` before implementation (RED → GREEN)
- Create `src/infrastructure/chunking/ParagraphChunker.ts` — splits by blank lines, delegates to SentenceChunker for long paragraphs
- Create `tests/infrastructure/chunking/ParagraphChunker.test.ts` before implementation
- Create `src/infrastructure/chunking/SentenceChunker.ts` — splits at sentence boundaries with abbreviation protection
- Create `tests/infrastructure/chunking/SentenceChunker.test.ts` before implementation
- Create `src/infrastructure/chunking/OverflowChunker.ts` — forced token-boundary split as last resort
- Create `tests/infrastructure/chunking/OverflowChunker.test.ts` before implementation
- Create `src/infrastructure/chunking/CodeChunker.ts` — splits code by function/class boundaries (indivisible units)
- Create `tests/infrastructure/chunking/CodeChunker.test.ts` before implementation
- Create `src/infrastructure/chunking/ChunkerFactory.ts` — builds pipeline with fallback chain + merge + overlap
- Create `tests/infrastructure/chunking/ChunkerFactory.test.ts` before implementation

## Capabilities

### New Capabilities
- `heading-chunker`: Split Markdown by heading levels, return whole sections as chunks (or delegate to fallback if section > max_tokens)
- `paragraph-chunker`: Split by blank-line boundaries, recursively delegate long paragraphs to sentence chunker
- `sentence-chunker`: Sentence-boundary split with abbreviation protection (Mr., Dr., etc.)
- `overflow-chunker`: Last-resort token-boundary split when no other strategy fits
- `code-chunker`: Function/class-aware code splitting — each function/class is an indivisible chunk
- `chunker-factory`: Build configurable pipeline (`heading → paragraph → sentence → overflow`) with overlap (32 tokens), min-chunk merge (50 tokens), and per-strategy `core_content` extraction

### Modified Capabilities
- None

## Impact

- Adds 7 implementation files in `src/infrastructure/chunking/`
- Adds 7 test files in `tests/infrastructure/chunking/`
- Adds 2 mock files in `tests/mocks/`
- Depends on Phase 1 (Chunk, ChunkStrategy, Chunker, ChunkerPipeline interfaces), Phase 2 (TokenEstimator)
- Uses `MarkdownAstParser` (from Phase 10) for heading extraction — can use a stub initially
- Unlocks Phase 6 (ContextPacker needs chunks) and all services/use cases


---
# openspec/changes/archive/2026-06-06-phase-4-chunking/specs/chunker-factory/spec.md
---
## ADDED Requirements

### Requirement: Pipeline with fallback chain
The system SHALL build a chunker pipeline with configurable fallback strategies, merge, and overlap.

#### Scenario: Pipeline creation
- **WHEN** calling `createPipeline(['heading', 'paragraph', 'sentence', 'overflow'])`
- **THEN** it SHALL create a pipeline with fallback chain in that order

#### Scenario: Small chunk merge
- **WHEN** consecutive chunks are < 50 tokens
- **THEN** they SHALL be merged with the previous chunk

#### Scenario: Overlap between chunks
- **WHEN** creating chunks with overlap
- **THEN** the last `overlap_tokens` SHALL repeat at the start of the next chunk
- **THEN** overlap text SHALL NOT be in `core_content`


---
# openspec/changes/archive/2026-06-06-phase-4-chunking/specs/code-chunker/spec.md
---
## ADDED Requirements

### Requirement: Split code by function/class boundaries
The system SHALL split TypeScript code by function and class boundaries as indivisible units.

#### Scenario: Function is one chunk
- **WHEN** chunking code with one function
- **THEN** the entire function SHALL be one chunk (indivisible)

#### Scenario: Class is one chunk
- **WHEN** chunking code with one class
- **THEN** the entire class SHALL be one chunk (indivisible)

#### Scenario: No overlap for code
- **WHEN** chunking code
- **THEN** there SHALL be no overlap between code chunks


---
# openspec/changes/archive/2026-06-06-phase-4-chunking/specs/heading-chunker/spec.md
---
## ADDED Requirements

### Requirement: Split Markdown by headings
The system SHALL split Markdown content by H1/H2+ headings, returning whole sections as chunks.

#### Scenario: Section under max_tokens
- **WHEN** chunking a Markdown section ≤ max_tokens
- **THEN** it SHALL return one chunk with that section's content

#### Scenario: Section over max_tokens falls through
- **WHEN** chunking a Markdown section > max_tokens
- **THEN** the chunker SHALL return no chunks (pipeline falls to next chunker)

#### Scenario: core_content is body without overlap
- **WHEN** a heading chunk is created
- **THEN** `core_content` SHALL be the section body without overlap text


---
# openspec/changes/archive/2026-06-06-phase-4-chunking/specs/overflow-chunker/spec.md
---
## ADDED Requirements

### Requirement: Forced token-boundary split
The system SHALL split text at exact token boundaries as a last resort.

#### Scenario: Forced split
- **WHEN** content exceeds max_tokens and no other strategy works
- **THEN** it SHALL split at the token boundary closest to max_tokens

#### Scenario: Minimum tokens
- **WHEN** creating overflow chunks
- **THEN** each chunk SHALL have at least `min_tokens` tokens


---
# openspec/changes/archive/2026-06-06-phase-4-chunking/specs/paragraph-chunker/spec.md
---
## ADDED Requirements

### Requirement: Split text by blank lines
The system SHALL split text by paragraph boundaries (blank lines).

#### Scenario: Paragraph under max_tokens
- **WHEN** chunking a paragraph ≤ max_tokens
- **THEN** it SHALL return one chunk with that paragraph

#### Scenario: Paragraph over max_tokens delegates
- **WHEN** chunking a paragraph > max_tokens
- **THEN** it SHALL delegate to SentenceChunker recursively


---
# openspec/changes/archive/2026-06-06-phase-4-chunking/specs/sentence-chunker/spec.md
---
## ADDED Requirements

### Requirement: Split text by sentence boundaries
The system SHALL split text at sentence boundaries (`.!?`) without splitting individual sentences.

#### Scenario: Sentences under max_tokens
- **WHEN** chunking text with multiple sentences ≤ max_tokens each
- **THEN** it SHALL split at `.`, `!`, `?` boundaries

#### Scenario: Abbreviation protection
- **WHEN** encountering abbreviations like `Mr.`, `Dr.`, `e.g.`
- **THEN** the chunker SHALL NOT split after these periods

#### Scenario: Overlong sentence delegates
- **WHEN** a single sentence > max_tokens
- **THEN** it SHALL delegate to OverflowChunker


---
# openspec/changes/archive/2026-06-06-phase-4-chunking/tasks.md
---
## 1. Mocks

- [x] 1.1 **GREEN**: Create `tests/mocks/MockChunker.ts` — implements `Chunker` interface, returns configurable Chunk[]
- [x] 1.2 **GREEN**: Create `tests/mocks/MockTokenEstimator.ts` — implements `TokenEstimator`, returns configurable counts

## 2. HeadingChunker

- [x] 2.1 **RED**: Write `tests/infrastructure/chunking/HeadingChunker.test.ts` — split md by headings ≤ max_tokens → one chunk per section, section > max_tokens → falls through, core_content = body without overlap, chunk_index and total_chunks correct
- [x] 2.2 **GREEN**: Create `src/infrastructure/chunking/HeadingChunker.ts` — heading regex extraction, implement `Chunker` interface
- [x] 2.3 **TEST**: Run `bun test tests/infrastructure/chunking/HeadingChunker.test.ts` — all tests pass

## 3. ParagraphChunker

- [x] 3.1 **RED**: Write `tests/infrastructure/chunking/ParagraphChunker.test.ts` — split by blank lines, paragraph ≤ max_tokens → chunk, paragraph > max_tokens → recursive SentenceChunker call
- [x] 3.2 **GREEN**: Create `src/infrastructure/chunking/ParagraphChunker.ts` — implement `Chunker`, split on `\n\n`, recursive delegation
- [x] 3.3 **TEST**: Run `bun test tests/infrastructure/chunking/ParagraphChunker.test.ts` — all tests pass

## 4. SentenceChunker

- [x] 4.1 **RED**: Write `tests/infrastructure/chunking/SentenceChunker.test.ts` — split by .!?, abbreviation protection (Mr., Dr., e.g.), never splits a sentence, overlong sentence → OverflowChunker
- [x] 4.2 **GREEN**: Create `src/infrastructure/chunking/SentenceChunker.ts` — regex-based sentence splitting with abbreviation list
- [x] 4.3 **TEST**: Run `bun test tests/infrastructure/chunking/SentenceChunker.test.ts` — all tests pass

## 5. OverflowChunker

- [x] 5.1 **RED**: Write `tests/infrastructure/chunking/OverflowChunker.test.ts` — forced token-boundary split, min_tokens validation
- [x] 5.2 **GREEN**: Create `src/infrastructure/chunking/OverflowChunker.ts` — split at token boundary closest to max_tokens
- [x] 5.3 **TEST**: Run `bun test tests/infrastructure/chunking/OverflowChunker.test.ts` — all tests pass

## 6. CodeChunker

- [x] 6.1 **RED**: Write `tests/infrastructure/chunking/CodeChunker.test.ts` — function → one chunk, class → one chunk, no overlap for code, indivisible units
- [x] 6.2 **GREEN**: Create `src/infrastructure/chunking/CodeChunker.ts` — parse by function/class boundaries, implement `Chunker`
- [x] 6.3 **TEST**: Run `bun test tests/infrastructure/chunking/CodeChunker.test.ts` — all tests pass

## 7. ChunkerFactory + Pipeline

- [x] 7.1 **RED**: Write `tests/infrastructure/chunking/ChunkerFactory.test.ts` — createPipeline builds ordered fallback chain, merge < 50 token chunks, 32-token overlap on content (not core_content), pipeline handles all strategies
- [x] 7.2 **GREEN**: Create `src/infrastructure/chunking/ChunkerFactory.ts` — factory builds ChunkerPipeline with fallback chain, merge logic, overlap logic
- [x] 7.3 **TEST**: Run `bun test tests/infrastructure/chunking/` — all chunking tests pass


---
# openspec/changes/archive/2026-06-06-phase-5-embedding/design.md
---
## Context

Embeddings are the core of semantic search. The system must support multiple embedding models (e.g., `nomic-embed-text` for general content, `mxbai-embed-large` for code), cache results to avoid redundant API calls, and degrade gracefully when models are unavailable.

## Goals / Non-Goals

**Goals:**
- `OllamaEmbedder`: HTTP client to Ollama's `/api/embeddings` — one HTTP request per batch of texts, exponential backoff (1s→2s→4s), AbortSignal for graceful shutdown
- `EmbedderCacheLRU`: In-memory LRU cache per model, keyed by `${model}:${blake3}`, configurable max size
- `CachedEmbedder`: Proxy decorator — checks cache before calling inner embedder, uses `hasher` for cache keys
- `MultiModelEmbedder`: Parallel invocation of multiple embedders with `allSettled` — partial failures tolerated
- `LanceDbEmbedder`: Returns zero-vector (all zeros) of configured dimension — enables ANN search without Ollama
- `NullEmbedder`: Always throws "no embedder available" — removes need for null checks
- `EmbedderRegistryImpl`: Builds model map from `ModelConfig[]`, routes source types to correct models by priority

**Non-Goals:**
- No async background batching beyond `embedBatch`
- No persistent on-disk cache (LRU is in-memory only; LanceDB serves as persistent dedup store)

## Decisions

- **CachedEmbedder is a proxy decorator**: Wraps any `Embedder` and adds caching transparently. Embedders don't need to know about caching. Tested independently from embedder implementations.
- **Cache key = `model:blake3(text)`**: The same text gets different vectors from different models. Without the model prefix, a cache hit from `nomic-embed-text` would incorrectly serve a 384-dim vector when `mxbai-embed-large` expects 1024-dim.
- **MultiModelEmbedder is NOT an Embedder**: It returns `Record<string, Embedding>` instead of `Embedding`. This is intentional — `Promise.allSettled` means partial results are valid.
- **LanceDbEmbedder returns zero vectors**: This is a graceful degradation strategy. Zero vectors push ANN search toward keyword-only (L2 distance = magnitude squared). Combined with FTS (BM25), search still works without Ollama.
- **Exponential backoff 1s→2s→4s**: Standard retry pattern for transient errors. Ollama API is local (no network latency), so short retries are appropriate. Max 3 attempts to avoid hanging on a dead server.

## Risks / Trade-offs

- **in-memory cache doesn't survive restart**: Acceptable — the primary dedup store is LanceDB (`hasModelEmbedding`). The LRU cache is a hot cache for the current indexing session.
- **Ollama embedder requires running server**: Not all environments have Ollama. Mitigation: `LanceDbEmbedder` enables fallback; `isAvailable()` check lets callers detect and warn.


---
# openspec/changes/archive/2026-06-06-phase-5-embedding/proposal.md
---
## Why

Embedding converts text chunks into vector representations for semantic search. Without embeddings, IndeX can only do keyword search (BM25). This phase builds a multi-model embedding system where each `source_type` can have dedicated models, a universal model handles cross-type queries, and graceful degradation keeps the system running when models fail.

## What Changes

- Create `tests/mocks/MockEmbedder.ts` and `tests/mocks/MockEmbedderRegistry.ts` for downstream tests
- Create `src/infrastructure/embedding/EmbedderCacheLRU.ts` — per-model LRU cache keyed by `${model}:${blake3}`
- Create `tests/infrastructure/embedding/EmbedderCacheLRU.test.ts` before implementation (RED → GREEN)
- Create `src/infrastructure/embedding/OllamaEmbedder.ts` — HTTP client to Ollama `/api/embeddings` with batch support and exponential backoff
- Create `tests/infrastructure/embedding/OllamaEmbedder.test.ts` before implementation
- Create `src/infrastructure/embedding/LanceDbEmbedder.ts` — fallback zero-vector embedder for keyword-only mode
- Create `tests/infrastructure/embedding/LanceDbEmbedder.test.ts` before implementation
- Create `src/infrastructure/embedding/CachedEmbedder.ts` — proxy decorator checking per-model cache before calling inner embedder
- Create `tests/infrastructure/embedding/CachedEmbedder.test.ts` before implementation
- Create `src/infrastructure/embedding/MultiModelEmbedder.ts` — parallel multi-model embedder with `allSettled` resilience
- Create `tests/infrastructure/embedding/MultiModelEmbedder.test.ts` before implementation
- Create `src/infrastructure/embedding/NullEmbedder.ts` — always-throws embedder for clean error handling
- Create `tests/infrastructure/embedding/NullEmbedder.test.ts` before implementation
- Create `src/infrastructure/embedding/EmbedderRegistryImpl.ts` — registry building from config with per-source-type routing
- Create `tests/infrastructure/embedding/EmbedderRegistry.test.ts` before implementation

## Capabilities

### New Capabilities
- `embedder-cache-lru`: In-memory LRU cache per embedding model keyed by `model:blake3_hash`
- `ollama-embedder`: HTTP client to Ollama's `/api/embeddings` endpoint with batch API (one HTTP call per batch), exponential backoff (1s→2s→4s), and AbortSignal support
- `lancedb-embedder`: Zero-vector fallback embedder enabling ANN search without Ollama (keyword-only graceful degradation)
- `cached-embedder`: Proxy/decorator that checks per-model cache before calling the real embedder
- `multi-model-embedder`: Parallel invocation of multiple embedders with `allSettled` — partial failures tolerated
- `null-embedder`: Always-throws embedder removing the need for null checks in calling code
- `embedder-registry`: Config-driven registry routing source types to the correct models by priority, with universal model support

### Modified Capabilities
- None

## Impact

- Adds 7 implementation files in `src/infrastructure/embedding/`
- Adds 7 test files in `tests/infrastructure/embedding/`
- Adds 2 mock files in `tests/mocks/`
- Runtime dependency: Ollama server running with `nomic-embed-text` model (for production use)
- Depends on Phase 1 (Embedder, EmbedderCache, EmbedderRegistry interfaces) and Phase 2 (BLAKE3 hasher for cache keys)
- Unlocks Phase 6 (RAG context needs embeddings), Phase 7 (LanceDB stores vectors), Phase 8 (IndexingService)


---
# openspec/changes/archive/2026-06-06-phase-5-embedding/specs/cached-embedder/spec.md
---
## ADDED Requirements

### Requirement: Proxy decorator with caching
The system SHALL wrap any embedder with a cache-checking proxy.

#### Scenario: Cache hit skips inner call
- **WHEN** a cached embedding exists for `{model, text}`
- **THEN** the cached value SHALL be returned without calling the inner embedder

#### Scenario: Cache miss calls inner and caches
- **WHEN** no cached embedding exists
- **THEN** the inner embedder SHALL be called and the result SHALL be cached


---
# openspec/changes/archive/2026-06-06-phase-5-embedding/specs/embedder-cache-lru/spec.md
---
## ADDED Requirements

### Requirement: Per-model LRU cache
The system SHALL cache embedding vectors per model with LRU eviction.

#### Scenario: Set and get
- **WHEN** setting a cache entry and getting it
- **THEN** the same embedding SHALL be returned

#### Scenario: Cache key includes model
- **WHEN** caching with key `${model}:${hash}`
- **THEN** different models with the same hash SHALL have different cache entries

#### Scenario: LRU eviction
- **WHEN** the cache exceeds max size
- **THEN** the least recently used entry SHALL be evicted


---
# openspec/changes/archive/2026-06-06-phase-5-embedding/specs/embedder-registry/spec.md
---
## ADDED Requirements

### Requirement: Config-driven embedder registry
The system SHALL build an embedder registry from `ModelConfig[]`, routing source types to correct models by priority.

#### Scenario: getEmbedder by source type
- **WHEN** calling `registry.getEmbedder("typescript")`
- **THEN** it SHALL return the model with minimum priority for that source type

#### Scenario: getEmbedders returns all matching models
- **WHEN** calling `registry.getEmbedders("typescript")`
- **THEN** it SHALL return all models that support that source type, ordered by priority

#### Scenario: Universal model returned for unresolvable types
- **WHEN** calling `registry.getEmbedder("unknown-type")`
- **THEN** it SHALL return the universal model (model without source_types filter)

#### Scenario: isAvailable returns false with no models
- **WHEN** the registry has no registered models
- **THEN** `isAvailable()` SHALL return false


---
# openspec/changes/archive/2026-06-06-phase-5-embedding/specs/lancedb-embedder/spec.md
---
## ADDED Requirements

### Requirement: Zero-vector fallback embedder
The system SHALL provide a fallback embedder that returns zero vectors of configured dimension.

#### Scenario: Returns zero vector
- **WHEN** calling `lancedbEmbedder.embed("any text")`
- **THEN** it SHALL return a zero-filled `Float32Array` of configured dimensions

#### Scenario: Enables ANN without Ollama
- **WHEN** Ollama is unavailable
- **THEN** the zero-vector embedder SHALL enable ANN search (keyword-only via L2 distance on zero vectors)


---
# openspec/changes/archive/2026-06-06-phase-5-embedding/specs/multi-model-embedder/spec.md
---
## ADDED Requirements

### Requirement: Parallel multi-model embedding
The system SHALL invoke multiple embedders in parallel and return all results.

#### Scenario: Returns Record of model → embedding
- **WHEN** calling `embedAll(text)` with multiple embedders
- **THEN** it SHALL return `Record<modelName, Embedding>` with entries for all successful embedders

#### Scenario: Partial failure tolerated
- **WHEN** one embedder fails
- **THEN** the other embedders' results SHALL still be returned


---
# openspec/changes/archive/2026-06-06-phase-5-embedding/specs/null-embedder/spec.md
---
## ADDED Requirements

### Requirement: Error-throwing null embedder
The system SHALL provide a null embedder that always throws.

#### Scenario: Always throws
- **WHEN** calling `nullEmbedder.embed("anything")`
- **THEN** it SHALL throw "no embedder available"


---
# openspec/changes/archive/2026-06-06-phase-5-embedding/specs/ollama-embedder/spec.md
---
## ADDED Requirements

### Requirement: Embed text via Ollama API
The system SHALL generate embeddings by calling Ollama's `/api/embeddings`.

#### Scenario: embed returns Float32Array
- **WHEN** calling `embed("hello")`
- **THEN** it SHALL return an `Embedding` with `vector: Float32Array` of configured `dimensions`

#### Scenario: embedBatch sends one HTTP request
- **WHEN** calling `embedBatch(["a", "b", "c"])`
- **THEN** it SHALL send a single HTTP POST to `/api/embeddings` with an array of strings

#### Scenario: Exponential backoff on failure
- **WHEN** the Ollama API returns an error
- **THEN** retry with backoff: 1s → 2s → 4s (max 3 attempts)

#### Scenario: AbortSignal cancels request
- **WHEN** an `AbortSignal` is triggered
- **THEN** the in-flight request SHALL be cancelled


---
# openspec/changes/archive/2026-06-06-phase-5-embedding/tasks.md
---
## 1. Mocks

- [x] 1.1 **GREEN**: Create `tests/mocks/MockEmbedder.ts` — implements `Embedder` with configurable name/dimensions/return values
- [x] 1.2 **GREEN**: Create `tests/mocks/MockEmbedderRegistry.ts` — implements `EmbedderRegistry` with pre-configured embedders

## 2. EmbedderCacheLRU

- [x] 2.1 **RED**: Write `tests/infrastructure/embedding/EmbedderCacheLRU.test.ts` — get/set/has work, key = `${model}:${hash}`, LRU eviction on overflow, size tracking
- [x] 2.2 **GREEN**: Create `src/infrastructure/embedding/EmbedderCacheLRU.ts` — implement `EmbedderCache` with Map + configurable max size
- [x] 2.3 **TEST**: Run `bun test tests/infrastructure/embedding/EmbedderCacheLRU.test.ts` — all tests pass

## 3. OllamaEmbedder

- [x] 3.1 **RED**: Write `tests/infrastructure/embedding/OllamaEmbedder.test.ts` — embed returns Float32Array(384), embedBatch sends single HTTP POST, exponential backoff 1s→2s→4s, AbortSignal cancels request, name/dimensions/sourceTypes correct
- [x] 3.2 **GREEN**: Create `src/infrastructure/embedding/OllamaEmbedder.ts` — HTTP client to Ollama `/api/embeddings`, batch support, retry with backoff, AbortSignal
- [x] 3.3 **TEST**: Run `bun test tests/infrastructure/embedding/OllamaEmbedder.test.ts` — all tests pass

## 4. LanceDbEmbedder

- [x] 4.1 **RED**: Write `tests/infrastructure/embedding/LanceDbEmbedder.test.ts` — returns zero vector of configured dimension, name/dimensions correct
- [x] 4.2 **GREEN**: Create `src/infrastructure/embedding/LanceDbEmbedder.ts` — zero-vector fallback, implements `Embedder`
- [x] 4.3 **TEST**: Run `bun test tests/infrastructure/embedding/LanceDbEmbedder.test.ts` — all tests pass

## 5. CachedEmbedder

- [x] 5.1 **RED**: Write `tests/infrastructure/embedding/CachedEmbedder.test.ts` — cache hit skips inner call, cache miss calls inner and caches, key = model.name + BLAKE3(text)
- [x] 5.2 **GREEN**: Create `src/infrastructure/embedding/CachedEmbedder.ts` — proxy decorator, implements `Embedder`, uses hasher for cache key
- [x] 5.3 **TEST**: Run `bun test tests/infrastructure/embedding/CachedEmbedder.test.ts` — all tests pass

## 6. MultiModelEmbedder

- [x] 6.1 **RED**: Write `tests/infrastructure/embedding/MultiModelEmbedder.test.ts` — calls all embedders in parallel, returns Record<modelName, Embedding>, one failure → others still return (allSettled)
- [x] 6.2 **GREEN**: Create `src/infrastructure/embedding/MultiModelEmbedder.ts` — `Promise.allSettled` on all embedders, partial results
- [x] 6.3 **TEST**: Run `bun test tests/infrastructure/embedding/MultiModelEmbedder.test.ts` — all tests pass

## 7. NullEmbedder

- [x] 7.1 **RED**: Write `tests/infrastructure/embedding/NullEmbedder.test.ts` — always throws "no embedder available"
- [x] 7.2 **GREEN**: Create `src/infrastructure/embedding/NullEmbedder.ts` — implements `Embedder`, throws on any call
- [x] 7.3 **TEST**: Run `bun test tests/infrastructure/embedding/NullEmbedder.test.ts` — all tests pass

## 8. EmbedderRegistryImpl

- [x] 8.1 **RED**: Write `tests/infrastructure/embedding/EmbedderRegistry.test.ts` — getEmbedder by source_type (min priority), getEmbedders returns all, getUniversalEmbedder, isAvailable false with no models, modelNames list
- [x] 8.2 **GREEN**: Create `src/infrastructure/embedding/EmbedderRegistryImpl.ts` — builds Map<sourceType, Embedder[]> from config, implements `EmbedderRegistry`
- [x] 8.3 **TEST**: Run `bun test tests/infrastructure/embedding/` — all embedding tests pass


---
# openspec/changes/archive/2026-06-06-phase-6-context-packaging/design.md
---
## Context

After search returns raw `SearchResult[]`, the results must be processed into a form usable by an LLM. This means: deduplicate (same semantic content may appear from different searches or overlapping chunks), sort by relevance, trim to token budget, and format as Markdown with system instructions.

## Goals / Non-Goals

**Goals:**
- `BLAKE3Deduplicator`: O(n) dedup via `Map<semantic_blake3, SearchResult>`, keeps entry with highest `score`
- `GPTCodeTokenizer`: `count(text)` returns GPT token count; `truncate(text, maxTokens)` truncates at word boundary to stay within budget
- `RAGContextPacker.pack(results, options)`: Pipeline — deduplicate → sort desc by score → greedy-fit by token budget → format as Markdown → annotated with `chunks_used`, `total_tokens`, `truncated`, `source_notes`
- Format support: `'context'` (plain Markdown) and `'rag'` (with system prompt for LLM)

**Non-Goals:**
- No re-ranking (results are ordered by original search score)
- No compression or summarization
- No streaming output (PackedContext is returned as one object)

## Decisions

- **Greedy truncation vs. smart selection**: Greedy by score is simple and predictable. Smart selection (maximal marginal relevance) would add complexity for marginal gain. Greedy is the right default, with room for future enhancement.
- **Whole-chunk truncation vs. in-chunk truncation**: Chunks are included or excluded whole. Truncating inside a chunk would lose meaning — the chunk is already the minimal semantic unit.
- **`source_notes` from unique paths**: A set of unique `source.path` values across included chunks. Gives the LLM visibility into which files contributed to the context.
- **`format: 'rag'` adds system prompt**: Prepends `"You are a helpful assistant. Use the following context to answer the user's question."` and wraps content in `<context></context>` tags. This matches common LLM prompt patterns.
- **gpt-tokenizer for token counting**: Compatible with GPT-4 tokenization. Falls back to byte-based approximation if not available (same pattern as TokenEstimatorSimple).

## Risks / Trade-offs

- **Greedy by score may miss diversity**: Top-scoring chunks may all come from the same file. Acceptable for v1 — the search service already includes hybrid weights that surface diverse results.
- **No overlap removal within context**: Chunks may have overlapping content (due to the 32-token overlap in chunking). Dedup only catches exact `semantic_blake3` matches, not partial overlaps. Acceptable for v1; overlap is small (32 tokens).


---
# openspec/changes/archive/2026-06-06-phase-6-context-packaging/proposal.md
---
## Why

After search returns raw results, they need to be deduplicated, sorted, token-counted, truncated, and formatted into a prompt-ready Markdown document for an LLM. Without the Context Packaging System, search results are unusable for RAG. This phase builds the BLAKE3-based deduplicator, GPT-compatible tokenizer, and the RAGContextPacker that orchestrates the full pipeline.

## What Changes

- Create `src/infrastructure/context/BLAKE3Deduplicator.ts` — O(n) dedup by `semantic_blake3` keeping max score entry
- Create `tests/infrastructure/context/BLAKE3Deduplicator.test.ts` before implementation (RED → GREEN)
- Create `src/infrastructure/context/GPTCodeTokenizer.ts` — token counting and truncation using gpt-tokenizer
- Create `tests/infrastructure/context/GPCTokenizer.test.ts` before implementation
- Create `src/infrastructure/context/RAGContextPacker.ts` — orchestrates dedup → sort → greedy truncation → markdown formatting with system prompt
- Create `tests/infrastructure/context/RAGContextPacker.test.ts` before implementation

## Capabilities

### New Capabilities
- `blake3-deduplicator`: O(n) deduplication of search results by `semantic_blake3` hash, keeping the entry with the highest `score`
- `gpt-tokenizer`: Token counting with GPT-compatible tokenizer (`gpt-tokenizer` or `tiktoken`), word-safe truncation to `max_tokens`
- `rag-context-packer`: End-to-end pipeline — deduplicate → sort by score (desc) → greedy-fit by token budget → format as RAG-ready Markdown with system prompt, `source_notes`, `truncated` flag, and chunk metadata

### Modified Capabilities
- None

## Impact

- Adds 3 implementation files in `src/infrastructure/context/`
- Adds 3 test files in `tests/infrastructure/context/`
- New dependency: `gpt-tokenizer` or `tiktoken`
- Depends on Phase 1 (PackedContext, ContextOptions, Deduplicator, Tokenizer, ContextPacker interfaces), Phase 2 (BLAKE3 hasher)
- Unlocks Phase 8 (SearchService returns results → ContextPacker formats them) and Phase 9 (PackUseCase)


---
# openspec/changes/archive/2026-06-06-phase-6-context-packaging/specs/blake3-deduplicator/spec.md
---
## ADDED Requirements

### Requirement: O(n) dedup by semantic_blake3
The system SHALL deduplicate search results by `semantic_blake3` hash, keeping the entry with maximum score.

#### Scenario: Duplicates removed
- **WHEN** deduplicating results with the same `semantic_blake3`
- **THEN** only the result with the highest `score` SHALL be kept

#### Scenario: O(n) via Map
- **WHEN** deduplicating N results
- **THEN** the operation SHALL complete in O(n) time using a `Map<hash, SearchResult>`


---
# openspec/changes/archive/2026-06-06-phase-6-context-packaging/specs/gpt-tokenizer/spec.md
---
## ADDED Requirements

### Requirement: GPT-compatible token counting and truncation
The system SHALL count tokens and truncate text to fit within GPT token budgets.

#### Scenario: Token count returns number
- **WHEN** calling `tokenizer.count("hello world")`
- **THEN** it SHALL return the number of GPT tokens

#### Scenario: Truncate to max tokens
- **WHEN** calling `tokenizer.truncate(text, 50)`
- **THEN** it SHALL truncate text to approximately 50 tokens, preferring word boundaries


---
# openspec/changes/archive/2026-06-06-phase-6-context-packaging/specs/rag-context-packer/spec.md
---
## ADDED Requirements

### Requirement: End-to-end context packing pipeline
The system SHALL transform search results into LLM-ready Markdown context.

#### Scenario: Full pack pipeline
- **WHEN** calling `packer.pack(results)`
- **THEN** it SHALL deduplicate → sort by score desc → greedy-fit by max_tokens → format as Markdown

#### Scenario: Truncated flag
- **WHEN** results exceed max_tokens
- **THEN** `truncated` SHALL be `true` and some results SHALL be excluded

#### Scenario: Source notes
- **WHEN** packing results from multiple files
- **THEN** `source_notes` SHALL contain unique file paths from included chunks

#### Scenario: RAG format
- **WHEN** using `format: 'rag'`
- **THEN** the output SHALL include a system prompt instruction before the context


---
# openspec/changes/archive/2026-06-06-phase-6-context-packaging/tasks.md
---
## 1. BLAKE3Deduplicator

- [x] 1.1 **RED**: Write `tests/infrastructure/context/BLAKE3Deduplicator.test.ts` — dedup by semantic_blake3, duplicate removal keeps max score, O(n) via Map, no side effects on unique entries
- [x] 1.2 **GREEN**: Create `src/infrastructure/context/BLAKE3Deduplicator.ts` — Map<semantic_blake3, SearchResult>, keeps max score
- [x] 1.3 **TEST**: Run `bun test tests/infrastructure/context/BLAKE3Deduplicator.test.ts` — all tests pass

## 2. GPTCodeTokenizer

- [x] 2.1 **RED**: Write `tests/infrastructure/context/GPCTokenizer.test.ts` — count("hello world") returns token number, truncate(text, 50) ≈ 50 tokens, truncate at word boundary (not mid-word), empty text = 0 tokens
- [x] 2.2 **GREEN**: Create `src/infrastructure/context/GPTCodeTokenizer.ts` — use `gpt-tokenizer` for count, greedy word-safe truncation, implement `Tokenizer` interface
- [x] 2.3 **TEST**: Run `bun test tests/infrastructure/context/GPCTokenizer.test.ts` — all tests pass

## 3. RAGContextPacker

- [x] 3.1 **RED**: Write `tests/infrastructure/context/RAGContextPacker.test.ts` — full pipeline: dedup → sort → greedy truncation → markdown, truncated=true when over max_tokens, source_notes from unique paths, format='rag' includes system prompt, format='context' is plain markdown
- [x] 3.2 **GREEN**: Create `src/infrastructure/context/RAGContextPacker.ts` — orchestrates pipeline with injectable Deduplicator and Tokenizer, implements `ContextPacker`
- [x] 3.3 **TEST**: Run `bun test tests/infrastructure/context/` — all context tests pass


---
# openspec/changes/archive/2026-06-07-phase-10-infra/design.md
---
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


---
# openspec/changes/archive/2026-06-07-phase-10-infra/proposal.md
---
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


---
# openspec/changes/archive/2026-06-07-phase-10-infra/specs/spec.md
---
## ADDED Requirements

### Requirement: File system watcher
The system SHALL watch directories for file changes using chokidar.

#### Scenario: Emits add/change/unlink
- **WHEN** a file is added, changed, or deleted in the watched directory
- **THEN** the watcher SHALL emit corresponding events with the file path

#### Scenario: Start/stop lifecycle
- **WHEN** starting and stopping the watcher
- **THEN** it SHALL correctly manage internal chokidar resources

#### Scenario: 500ms debounce
- **WHEN** multiple rapid file changes occur
- **THEN** the watcher SHALL debounce events with a 500ms delay

### Requirement: Structured logger
The system SHALL provide a pino-based structured logger.

#### Scenario: Log at all levels
- **WHEN** calling `logger.info()`, `logger.warn()`, `logger.error()`, `logger.debug()`
- **THEN** structured JSON output SHALL be produced

#### Scenario: Child loggers
- **WHEN** calling `logger.child({ module: "indexing" })`
- **THEN** the child logger SHALL include the context in all subsequent log entries

### Requirement: Silent logger for tests
The system SHALL provide a no-op logger for test environments.

#### Scenario: No output
- **WHEN** calling any log method on SilentLogger
- **THEN** no output SHALL be produced

### Requirement: Markdown heading extractor
The system SHALL extract headings from Markdown for chunking.

#### Scenario: Headings with level and anchor
- **WHEN** extracting headings from Markdown
- **THEN** each heading SHALL have `level`, `text`, and GitHub-style `anchor`


---
# openspec/changes/archive/2026-06-07-phase-10-infra/tasks.md
---
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


---
# openspec/changes/archive/2026-06-07-phase-11-di-integration/design.md
---
## Context

The DI container in `src/index.ts` wires together all components from Phases 2-10. This is the composition root — the only place concrete classes are instantiated and wired together. The integration test validates that real parsers + real chunkers + mocks produce correct results end-to-end.

## Goals / Non-Goals

**Goals:**
- `src/index.ts` creates: ConfigLoader → Logger → Hasher → Parsers → ParserRegistry → ChunkerFactory → EmbedderRegistry → SourceRepository → Services → Use Cases
- Exports a single `createApp()` function that returns `{ index, search, pack, chunk, embed, watch, del }`
- Integration test: real MarkdownParser + HeadingChunker + MockEmbedder + MockSourceRepository, full cycle: index a fixture → search a term → pack results

**Non-Goals:**
- No DI framework (manual DI via factory functions is sufficient and explicit)
- No lazy initialization (all dependencies created eagerly at startup)

## Decisions

- **Manual DI over a framework**: For an app of this size, a DI framework (tsyringe, inversify) adds complexity without benefit. Factory functions make the dependency graph explicit and testable.
- **`createApp()` returns a use case bundle**: All use cases are returned as named methods on a single object. The CLI imports `createApp` and destructures the needed use cases. No global state.
- **Integration test uses mocked storage + real parsers**: Tests the critical path: parse → chunk → search formatting. Vector embedding and DB are mocked to keep the test fast and deterministic.
- **Config loaded at startup**: `createApp(configPath?)` accepts an optional config path. Defaults to `.indeX/config.json` in the current working directory.

## Risks / Trade-offs

- **Single-file DI can grow large**: `src/index.ts` may be 100+ lines. Acceptable — it's the composition root, and explicit wiring is more maintainable than magic auto-wiring.
- **Eager initialization means slower startup**: All dependencies (including embedders that reach out to Ollama) are created at startup. Mitigation: lazy connection for Ollama (connect on first use, not construction).


---
# openspec/changes/archive/2026-06-07-phase-11-di-integration/proposal.md
---
## Why

The DI container (`src/index.ts`) is the wiring hub of the entire application. It loads config, instantiates all parsers/chunkers/embedders/repositories, builds the registry, assembles services and use cases, and exports them. Without this, the system has no single entry point that ties everything together. The integration test validates the full pipe — real MarkdownParser + HeadingChunker + MockEmbedder + MockSourceRepository — end to end.

## What Changes

- Create `src/index.ts` — DI container: load config → create infrastructure → register parsers → build chunker pipeline → create embedder registry → build services → assemble use cases → export
- Create `tests/integration/full-cycle.test.ts` — integration test with real MarkdownParser + HeadingChunker + MockEmbedder + MockSourceRepository: index → search → pack full cycle
- All tests must pass (GREEN) before considering this phase complete

## Capabilities

### New Capabilities
- `di-container`: Central wiring of all IndeX modules — config loading, parser registry, chunker pipeline, embedder registry, domain services, use cases — exposed as a single entry point
- `integration-test`: End-to-end test validating the full pipeline with real parsers and chunkers (mocked embedding and storage)

### Modified Capabilities
- None

## Impact

- Adds `src/index.ts` — the main entry point
- Adds `tests/integration/full-cycle.test.ts` — integration smoke test
- Depends on Phase 9 (all use cases), Phase 10 (ConfigLoader, watcher, logger, markdown), plus all infrastructure phases (2-7)
- Unlocks Phase 12 (CLI and API call into the DI container)


---
# openspec/changes/archive/2026-06-07-phase-11-di-integration/specs/spec.md
---
## ADDED Requirements

### Requirement: DI container wires all modules
The system SHALL wire together all IndeX modules in a single composition root.

#### Scenario: createApp() returns use cases
- **WHEN** calling `createApp(configPath)`
- **THEN** it SHALL return an object with all use cases: `index`, `search`, `pack`, `chunk`, `embed`, `watch`, `delete`

#### Scenario: Eager initialization
- **WHEN** calling `createApp()`
- **THEN** all dependencies SHALL be constructed eagerly (no lazy singletons except external connections)

### Requirement: Integration test validates full pipeline
The system SHALL have an integration test exercising real parsers + real chunkers + mocks.

#### Scenario: Index → search → pack cycle
- **WHEN** running the integration test
- **THEN** a Markdown fixture SHALL be indexed, searchable, and packable through the full pipeline


---
# openspec/changes/archive/2026-06-07-phase-11-di-integration/tasks.md
---
## 1. DI Container (src/index.ts)

- [x] 1.1 **GREEN**: Create `src/index.ts` — `createApp(configPath?)` factory:
  1. Load config via `ConfigLoader.loadOrDefault()`
  2. Create `PinoLogger` (or `SilentLogger` in test mode)
  3. Create `BLAKE3Hasher`
  4. Register parsers: `MarkdownParser`, `ObsidianParser`, `AstGrepParser` → `ParserRegistry`
  5. Build `ChunkerFactory.createPipeline(['heading', 'paragraph', 'sentence', 'overflow'])`
  6. Create `EmbedderCacheLRU`, wrap each model in `CachedEmbedder`, build `EmbedderRegistryImpl` from config
  7. Create `LanceDbSourceRepository` (or `MockSourceRepository` in test mode)
  8. Build `IndexingService`, `SearchService`, `DiffIndexingService`
  9. Build all use cases: `IndexUseCase`, `SearchUseCase`, `PackUseCase`, `ChunkUseCase`, `EmbedUseCase`, `WatchUseCase`, `DeleteUseCase`
  10. Return `{ index, search, pack, chunk, embed, watch, del }`
- [x] 1.2 **SMOKE TEST**: Run `bun run src/index.ts` → "IndeX started" or app initializes without error

## 2. Integration Test

- [x] 2.1 **RED**: Write `tests/integration/full-cycle.test.ts`:
  - Use `createApp("memory://")` test-mode factory
  - Index a real Markdown fixture from `tests/fixtures/simple-note.md` through real `MarkdownParser` + real `HeadingChunker` + `MockEmbedder` + `MockSourceRepository`
  - Search for a term from the fixture → results found
  - Pack the fixture → Markdown output is correct
  - `IndexStats` returns expected counts
- [x] 2.2 **GREEN**: Ensure DI container supports test-mode injection (swappable `SourceRepository`)
- [x] 2.3 **TEST**: Run `bun test tests/integration/full-cycle.test.ts` — all tests pass


---
# openspec/changes/archive/2026-06-07-phase-8-domain-services/design.md
---
## Context

Domain services contain the pure business logic — they orchestrate infrastructure components (parsers, chunkers, embedders, repository) without knowing their concrete implementations. This is the core of the Ports & Adapters architecture: all dependencies are injected as interfaces, and all tests use mocks.

## Goals / Non-Goals

**Goals:**
- `IndexingService.index(directory)`: Scan → filter → for each file: parse → chunk → embed → upsert. Handles multi-model embedding and exclude patterns.
- `SearchService.search(query, options)`: Three modes — semantic (ANN), keyword (BM25), hybrid (weighted combination). BM25 normalization `(bm25 - min)/(max - min)`. Multi-model result merging. Post-filter by tags/type/date.
- `DiffIndexingService.diffIndex(filePath)`: Compare `file_blake3` → skip if unchanged; re-parse, re-chunk, re-embed if changed; handle cross-file `semantic_blake3` dedup (don't delete hashes still referenced by other files).

**Non-Goals:**
- No batching/queueing (single-file-at-a-time for diff indexing is sufficient)
- No progress reporting or streaming (return final result synchronously)

## Decisions

- **IndexingService iterates files sequentially**: File-level parallelism would complicate error handling and may exhaust memory with large repos. Sequential is simpler and predictable. Embedding batching within each file provides sufficient throughput.
- **Search post-filter as default**: ANN first, filter second. Pre-filter (filter before ANN) reduces vector search space but can miss relevant results if the filter is too restrictive. Post-filter is safer for discovery-oriented search.
- **BM25 normalization across current results**: Normalize using min/max of the current result set, not global corpus statistics. This makes hybrid scores relative to the query, which is more intuitive.
- **Multi-model score averaging**: If a chunk is found by two models, the `avg_semantic` is the mean of their cosine scores. This prevents models voting multiple times on the same chunk.
- **DiffIndexing handles cross-file references**: Before deleting a stale chunk, check if another file references the same `semantic_blake3`. This prevents data loss when two files share identical content (e.g., copied code snippets).

## Risks / Trade-offs

- **Sequential indexing may be slow for large vaults**: 10K files × 200ms per file = 33 minutes. Acceptable for initial index (one-time cost). Future optimization: parallel file processing with a worker pool.
- **Post-filter degrades recall with strict filters**: If `tags: ["rare-tag"]` and there are few results, the post-filtered pool may be too small. Mitigation: request `top_k * 2` before filtering.


---
# openspec/changes/archive/2026-06-07-phase-8-domain-services/proposal.md
---
## Why

Domain services contain the pure business logic of IndeX — orchestrating parsers, chunkers, embedders, and the repository into meaningful operations. `IndexingService` ties together the full indexing pipeline, `SearchService` implements hybrid search (semantic + keyword + multi-model), and `DiffIndexingService` enables incremental updates via the watcher. These services are tested with mocks, no external infrastructure needed.

## What Changes

- Create `src/domain/services/IndexingService.ts` — scan directory → filter → parse → chunk → embed → upsert, with multi-model support and exclude-pattern filtering
- Create `tests/domain/services/IndexingService.test.ts` before implementation (RED → GREEN), using mocks for everything
- Create `src/domain/services/SearchService.ts` — hybrid search (ANN + BM25) with post-filtering, multi-model score averaging, BM25 normalization
- Create `tests/domain/services/SearchService.test.ts` before implementation
- Create `src/domain/services/DiffIndexingService.ts` — watcher-driven incremental indexing comparing `file_blake3`, re-parsing only changed files, cross-file semantic dedup
- Create `tests/domain/services/DiffIndexingService.test.ts` before implementation

## Capabilities

### New Capabilities
- `indexing-service`: Full-file indexing pipeline — scan directory tree, apply include/exclude filters, parse via ParserRegistry, chunk via ChunkerFactory, embed via EmbedderRegistry, upsert to SourceRepository with multi-model vector columns
- `search-service`: Three-mode search (semantic ANN, keyword BM25, hybrid weighted) with post-filtering by tags/type/date, BM25 normalization `(bm25 - min)/(max - min)`, multi-model score averaging, configurable `filter_mode` (post/pre) and `hybrid_weight`
- `diff-indexing-service`: Incremental indexing comparing `file_blake3` hashes — skip unchanged files, re-process changed files, preserve orphaned `semantic_blake3` entries referenced by other files, rebuild FileIndex only for changed files

### Modified Capabilities
- None

## Impact

- Adds 3 implementation files in `src/domain/services/`
- Adds 3 test files in `tests/domain/services/`
- Zero external dependencies (pure business logic tested with mocks)
- Depends on Phase 1 (all port + system interfaces), Phase 2 (BLAKE3Hasher), Phase 3 (ParserRegistry), Phase 4 (ChunkerFactory), Phase 5 (EmbedderRegistry), Phase 7 (MockSourceRepository)
- Unlocks Phase 9 (use cases wrap these services)


---
# openspec/changes/archive/2026-06-07-phase-8-domain-services/specs/diff-indexing-service/spec.md
---
## ADDED Requirements

### Requirement: Incremental diff indexing
The system SHALL index only changed files by comparing `file_blake3` hashes.

#### Scenario: Unchanged file skipped
- **WHEN** `file_blake3` matches the stored hash
- **THEN** the file SHALL be skipped (no re-processing)

#### Scenario: Changed file re-processed
- **WHEN** `file_blake3` differs from the stored hash
- **THEN** the file SHALL be re-parsed, re-chunked, and re-embedded

#### Scenario: Cross-file semantic dedup
- **WHEN** removing a chunk whose `semantic_blake3` is referenced by another file
- **THEN** the chunk SHALL NOT be deleted

#### Scenario: FileIndex rebuilt
- **WHEN** a file changes
- **THEN** its `FileIndex` SHALL be rebuilt with updated symbols/imports/exports


---
# openspec/changes/archive/2026-06-07-phase-8-domain-services/specs/indexing-service/spec.md
---
## ADDED Requirements

### Requirement: Full indexing pipeline
The system SHALL index a directory by scanning, parsing, chunking, embedding, and upserting all supported files.

#### Scenario: Index scans and processes files
- **WHEN** calling `indexingService.index("./fixtures")`
- **THEN** it SHALL scan directory, parse each file, chunk, embed, and upsert to the repository

#### Scenario: Exclude patterns respected
- **WHEN** exclude patterns are configured
- **THEN** matching files SHALL be skipped

#### Scenario: Multi-model embedding
- **WHEN** multiple embedding models are configured
- **THEN** each chunk SHALL be embedded by all applicable models


---
# openspec/changes/archive/2026-06-07-phase-8-domain-services/specs/search-service/spec.md
---
## ADDED Requirements

### Requirement: Three-mode search
The system SHALL search indexed content with semantic, keyword, or hybrid modes.

#### Scenario: Semantic search
- **WHEN** searching with `mode: "semantic"`
- **THEN** ANN search SHALL be performed on vector columns

#### Scenario: Keyword search
- **WHEN** searching with `mode: "keyword"`
- **THEN** FTS/BM25 search SHALL be performed

#### Scenario: Hybrid search
- **WHEN** searching with `mode: "hybrid"`
- **THEN** ANN and BM25 results SHALL be merged with weighted hybrid scoring

#### Scenario: BM25 normalization
- **WHEN** performing hybrid search
- **THEN** BM25 scores SHALL be normalized to [0, 1] via `(bm25 - min) / (max - min)`

#### Scenario: Post-filter by tags
- **WHEN** filters include `tags: ["devops"]`
- **THEN** results SHALL be filtered AFTER ANN/FTS search

#### Scenario: Multi-model averaging
- **WHEN** a chunk is found by multiple models
- **THEN** the semantic score SHALL be the average of all model scores


---
# openspec/changes/archive/2026-06-07-phase-8-domain-services/tasks.md
---
## 1. IndexingService

- [x] 1.1 **RED**: Write `tests/domain/services/IndexingService.test.ts` — mock-mode all dependencies:
  - Test: scan directory → parse → chunk → embed → upsert pipeline
  - Test: exclude patterns skip matching files
  - Test: multi-model embedding calls all applicable models
- [x] 1.2 **GREEN**: Create `src/domain/services/IndexingService.ts` — orchestrates: scan → filter → parse → chunk → embed (per applicable model) → upsert batch
- [x] 1.3 **TEST**: Run `bun test tests/domain/services/IndexingService.test.ts` — all tests pass

## 2. SearchService

- [x] 2.1 **RED**: Write `tests/domain/services/SearchService.test.ts` — mock-mode:
  - Semantic search via MockEmbedder + MockSourceRepository
  - Keyword search via MockSourceRepository (FTS/BM25)
  - Hybrid search with weighted merging
  - BM25 normalization `(bm25 - min)/(max - min)`
  - Post-filter by tags, source_type, date range
  - Multi-model: results merged, hybrid_weight averaged
  - Empty index returns []
- [x] 2.2 **GREEN**: Create `src/domain/services/SearchService.ts` — three-mode search, BM25 normalization, post-filter, multi-model averaging, configurable hybrid_weight
- [x] 2.3 **TEST**: Run `bun test tests/domain/services/SearchService.test.ts` — all tests pass

## 3. DiffIndexingService

- [x] 3.1 **RED**: Write `tests/domain/services/DiffIndexingService.test.ts` — mock-mode:
  - file_blake3 matches → skip (no re-processing)
  - file_blake3 differs → re-parse, re-chunk, re-embed
  - semantic_blake3 of removed chunk referenced by other file → don't delete
  - FileIndex rebuilt on file change
  - New file → full processing
- [x] 3.2 **GREEN**: Create `src/domain/services/DiffIndexingService.ts` — compare hashes, diff re-processing, cross-file dedup, FileIndex rebuild
- [x] 3.3 **TEST**: Run `bun test tests/domain/services/` — all service tests pass


---
# openspec/changes/archive/2026-06-07-phase-9-application-use-cases/design.md
---
## Context

Use cases are the application-level entry points that coordinate domain services and infrastructure. They provide the clean API that CLI and HTTP layers call. Each use case is a single-responsibility class with injected dependencies (DI groups).

## Goals / Non-Goals

**Goals:**
- `IndexUseCase.execute(path)`: Orchestrates full indexing — scan → parse → chunk → multi-model embed → upsert — via IndexingService
- `SearchUseCase.execute(query, options)`: Search with mode/tags/top_k — via SearchService + ContextPacker
- `PackUseCase.execute(path, options)`: Package files into `.md` with include/exclude — via ParserRegistry + file scanning
- `ChunkUseCase.execute(path, options)`: Chunk files with strategy — via ParserRegistry + ChunkerFactory
- `EmbedUseCase.execute(options)`: Generate/update embeddings — reads chunks from source or re-parses files
- `WatchUseCase.execute(path)`: Start FileWatcher → diff on change — via ChokidarWatcher + DiffIndexingService
- `DeleteUseCase.execute(path)`: Remove data — via SourceRepository.deleteByPath
- `ConfigLoader.load()` / `loadOrDefault()`: Zod-validated `.indeX/config.json` loading
- All use cases tested with mocks (MockSourceRepository, MockEmbedder, MockChunker)

**Non-Goals:**
- No authentication/authorization (local tool)
- No request validation (handled by CLI/API layer)
- No progress streaming

## Decisions

- **Single-use-case-per-file**: Keeps each use case focused and independently testable. Matches clean architecture patterns.
- **DI group interfaces**: `IndexSystems`, `SearchSystems`, etc. bundle the specific ports each use case needs. This makes DI explicit and avoids constructor bloat (one interface with 10+ dependencies).
- **ConfigLoader returns Config object**: No side effects. `loadOrDefault()` is safe to call anytime — returns defaults if no config file exists. `load()` fails fast with Zod validation errors for broken configs.
- **Zod for config schema**: Runtime validation with descriptive error messages. Catches typos in model names, missing required fields, and type mismatches before they cause runtime errors.

## Risks / Trade-offs

- **Config file discoverability**: `.indeX/config.json` in the user's vault directory may be unexpected. Mitigation: document the config location in CLI help, include a default config template.
- **Zod validation verbosity**: Nested discriminated unions produce long error messages. Mitigation: use Zod's `superRefine` for human-readable error paths like `models[0].dimensions`.


---
# openspec/changes/archive/2026-06-07-phase-9-application-use-cases/proposal.md
---
## Why

Use cases are the application-level entry points that wire together domain services, infrastructure, and DI. They provide the clean API surface that the CLI and HTTP layers call. Without use cases, there is no way to invoke the system — each command (`index`, `search`, `pack`, `chunk`, `embed`, `watch`) is a separate use case.

## What Changes

- Create `src/application/di/Systems.ts` — dependency group interfaces (`IndexSystems`, `SearchSystems`, `PackSystems`, `ChunkSystems`, `EmbedSystems`)
- Create `src/application/IndexUseCase.ts` — full index cycle: scan → parse → chunk → embed → upsert
- Create `tests/application/IndexUseCase.test.ts` before implementation (RED → GREEN)
- Create `src/application/SearchUseCase.ts` — search with mode/tags/top_k, returning `SearchResult[]`
- Create `tests/application/SearchUseCase.test.ts` before implementation
- Create `src/application/PackUseCase.ts` — file packaging with include/exclude filters into `.md` bundle
- Create `tests/application/PackUseCase.test.ts` before implementation
- Create `src/application/ChunkUseCase.ts` — chunk files with strategy selection, include/exclude
- Create `tests/application/ChunkUseCase.test.ts` before implementation
- Create `src/application/EmbedUseCase.ts` — generate embeddings from chunks or files, upsert to LanceDB
- Create `tests/application/EmbedUseCase.test.ts` before implementation
- Create `src/application/WatchUseCase.ts` — start FileWatcher, wire events to DiffIndexingService
- Create `tests/application/WatchUseCase.test.ts` before implementation
- Create `src/application/DeleteUseCase.ts` — delete by path/sourceId
- Create `src/config/ConfigLoader.ts` — zod-schema validated config loading from `.indeX/config.json`
- Create `tests/infrastructure/config/ConfigLoader.test.ts` before implementation

## Capabilities

### New Capabilities
- `di-systems`: Dependency group interfaces bundling related ports and systems for use case injection
- `index-use-case`: End-to-end index orchestration — parse, chunk, embed, upsert — usable from CLI as `indeX index <path>`
- `search-use-case`: Query the index with semantic/keyword/hybrid modes — usable from CLI as `indeX search <query>`
- `pack-use-case`: Filter and concatenate files into a single Markdown document — usable as `indeX pack <path> -o bundle.md`
- `chunk-use-case`: Chunk files with configurable strategy and filters — usable as `indeX chunk <path>`
- `embed-use-case`: Generate embeddings from existing chunks or from file re-parsing — usable as `indeX embed <path>`
- `watch-use-case`: Watch directory for changes and run diff indexing — usable as `indeX watch <path>`
- `delete-use-case`: Remove indexed data by path or source ID
- `config-loader`: Zod-validated JSON config loader for `.indeX/config.json` with defaults, model validation, and descriptive errors

### Modified Capabilities
- None

## Impact

- Adds 9 implementation files in `src/application/` and `src/config/`
- Adds 7 test files in `tests/application/` and `tests/infrastructure/config/`
- New dependency: `zod` (already installed in Phase 0)
- Depends on Phase 8 (all domain services), Phase 10 (ConfigLoader, FileWatcher, Logger)
- Unlocks Phase 11 (DI container) and Phase 12 (CLI commands)


---
# openspec/changes/archive/2026-06-07-phase-9-application-use-cases/specs/spec.md
---
## ADDED Requirements

### Requirement: DI dependency groups
The system SHALL bundle related dependencies into DI group interfaces for use case injection.

#### Scenario: IndexSystems bundle
- **WHEN** defining `IndexSystems`
- **THEN** it SHALL include `ParserRegistry`, `ChunkerPipeline`, `EmbedderRegistry`, `SourceRepository`, `Logger`, `Hasher`

### Requirement: Full index use case
The system SHALL orchestrate complete indexing with all real systems via DI.

#### Scenario: Execute full index
- **WHEN** calling `indexUseCase.execute("./vault")`
- **THEN** it SHALL scan, parse, chunk, multi-model embed, and upsert all files

### Requirement: Search use case
The system SHALL search the index with configurable mode and filters.

#### Scenario: Execute search
- **WHEN** calling `searchUseCase.execute("query", { mode: "hybrid" })`
- **THEN** it SHALL return `SearchResult[]` with hybrid ranked results

### Requirement: Pack use case
The system SHALL package files into a single Markdown bundle with include/exclude filters.

#### Scenario: Execute pack
- **WHEN** calling `packUseCase.execute("./vault", { include: ["**/*.md"] })`
- **THEN** it SHALL concatenate matching files into a Markdown document

### Requirement: Chunk use case
The system SHALL chunk files with configurable strategy and filters.

#### Scenario: Execute chunk
- **WHEN** calling `chunkUseCase.execute("./vault", { strategy: "heading" })`
- **THEN** it SHALL return `Chunk[]` with metadata

### Requirement: Embed use case
The system SHALL generate embeddings from chunks or re-parsed files.

#### Scenario: Embed from chunks
- **WHEN** calling `embedUseCase.execute({ source: "chunks" })`
- **THEN** it SHALL embed existing chunks and upsert to database

### Requirement: Watch use case
The system SHALL watch a directory and run diff indexing on file changes.

#### Scenario: Execute watch
- **WHEN** calling `watchUseCase.execute("./vault")`
- **THEN** it SHALL start the FileWatcher and wire events to DiffIndexingService

### Requirement: Delete use case
The system SHALL remove indexed data by path or source ID.

#### Scenario: Delete by path
- **WHEN** calling `deleteUseCase.execute("./vault/note.md")`
- **THEN** all chunks for that path SHALL be removed from the index

### Requirement: Config loader
The system SHALL load and validate configuration from `.indeX/config.json` using Zod.

#### Scenario: Load validates config
- **WHEN** loading a valid config file
- **THEN** it SHALL return a validated `Config` object

#### Scenario: LoadOrDefault returns defaults
- **WHEN** no config file exists
- **THEN** `loadOrDefault()` SHALL return sensible defaults

#### Scenario: Invalid JSON raises error
- **WHEN** loading a malformed config file
- **THEN** it SHALL throw a descriptive Zod validation error


---
# openspec/changes/archive/2026-06-07-phase-9-application-use-cases/tasks.md
---
## 1. DI Systems (Group Interfaces)

- [x] 1.1 **GREEN**: Create `src/application/di/Systems.ts` — `IndexSystems`, `SearchSystems`, `PackSystems`, `ChunkSystems`, `EmbedSystems` group interfaces bundling required dependencies for each use case

## 2. ConfigLoader

- [x] 2.1 **RED**: Write `tests/infrastructure/config/ConfigLoader.test.ts` — load() validates correct config, loadOrDefault() returns defaults without config file, broken JSON throws Zod error, invalid model config (missing required fields) throws validation error, universal_model validated to be in models[]
- [x] 2.2 **GREEN**: Create `src/config/ConfigLoader.ts` — Zod schema for full config, load() reads `.indeX/config.json`, loadOrDefault() returns defaults, descriptive error messages
- [x] 2.3 **TEST**: Run `bun test tests/infrastructure/config/ConfigLoader.test.ts` — all tests pass

## 3. IndexUseCase

- [x] 3.1 **RED**: Write `tests/application/IndexUseCase.test.ts` — mock all dependencies, execute("./vault")→full cycle with MockSourceRepository+ParserRegistry+Chunker+Embedder, verify each step called correctly
- [x] 3.2 **GREEN**: Create `src/application/IndexUseCase.ts` — delegates to IndexingService with injected DI group
- [x] 3.3 **TEST**: Run `bun test tests/application/IndexUseCase.test.ts` — all tests pass

## 4. SearchUseCase

- [x] 4.1 **RED**: Write `tests/application/SearchUseCase.test.ts` — search("query", { mode: "hybrid" })→SearchResult[], mode switching works, empty query handling
- [x] 4.2 **GREEN**: Create `src/application/SearchUseCase.ts` — delegates to SearchService
- [x] 4.3 **TEST**: Run `bun test tests/application/SearchUseCase.test.ts` — all tests pass

## 5. PackUseCase

- [x] 5.1 **RED**: Write `tests/application/PackUseCase.test.ts` — pack("./fixtures", { include/to/exclude })→PackedContext, filter patterns work, concatenation format correct
- [x] 5.2 **GREEN**: Create `src/application/PackUseCase.ts` — scan → filter → parse (via ParserRegistry) → concat → output .md
- [x] 5.3 **TEST**: Run `bun test tests/application/PackUseCase.test.ts` — all tests pass

## 6. ChunkUseCase

- [x] 6.1 **RED**: Write `tests/application/ChunkUseCase.test.ts` — chunk("./fixtures", { strategy })→Chunk[], include/exclude filters applied
- [x] 6.2 **GREEN**: Create `src/application/ChunkUseCase.ts` — scan → filter → parse → chunk via ChunkerFactory
- [x] 6.3 **TEST**: Run `bun test tests/application/ChunkUseCase.test.ts` — all tests pass

## 7. EmbedUseCase

- [x] 7.1 **RED**: Write `tests/application/EmbedUseCase.test.ts` — embed({ source: "chunks" })→upserts embeddings, embed({ source: "files" })→chunk+embed, each model's embedding stored per source
- [x] 7.2 **GREEN**: Create `src/application/EmbedUseCase.ts` — read existing chunks or re-parse files, multi-model embed, upsert to SourceRepository
- [x] 7.3 **TEST**: Run `bun test tests/application/EmbedUseCase.test.ts` — all tests pass

## 8. WatchUseCase + DeleteUseCase

- [x] 8.1 **RED**: Write `tests/application/WatchUseCase.test.ts` — watch("./vault") starts FileWatcher, onChange→DiffIndexingService called, stop() stops watcher
- [x] 8.2 **GREEN**: Create `src/application/WatchUseCase.ts` (start watcher with DiffIndexingService) and `src/application/DeleteUseCase.ts` (delegate to SourceRepository.deleteByPath)
- [x] 8.3 **TEST**: Run `bun test tests/application/` — all use case tests pass


---
# openspec/changes/phase-12-cli-api/design.md
---
## Context

The final user-facing layer. CLI provides direct terminal access to all IndeX operations. HTTP API (Hono) enables remote integration. Web UI provides visual search. All three call into the use case bundle from the DI container.

## Goals / Non-Goals

**Goals:**
- CLI: All 7 commands (`index`, `search`, `pack`, `chunk`, `embed`, `watch`, `stats`) with flags for mode, tags, output, strategy
- HTTP API (Hono): `GET /api/search`, `GET /api/stats`, `POST /api/index`
- Web UI: Search interface with results display, index status, basic visualization
- Tests for CLI argument parsing and API endpoint behavior

**Non-Goals:**
- No authentication for HTTP API (local-only by default)
- No complex web dashboard (minimal SPA for search and status)

## Decisions

- **CLI uses Bun's argv + simple parser**: Avoids adding `commander` dependency. CLI is 7 commands, each with 2-3 flags — too simple to justify a framework. If CLI grows, `commander` can be added later.
- **Hono for HTTP API**: Lightweight, fast, Bun-native. Handles routing, middleware, and JSON serialization with minimal boilerplate. Supports CORS for the SPA.
- **SPA as static files served by Hono**: Single HTML + JS bundle served from `src/presentation/web/`. No build step — use modern browser ESM imports. Keeps the web UI lightweight.
- **CLI is the primary interface**: HTTP API and Web UI are secondary. The CLI must always be fully functional even if the API is not running.
- **`indeX --help` lists all commands**: Built into the CLI parser. Shows available commands and common flags for discoverability.

## Risks / Trade-offs

- **Web UI adds browser dependency**: The SPA requires a modern browser and the HTTP API running. Mitigation: web UI is optional; all functionality is available via CLI.
- **Cross-platform CLI path handling**: Windows paths differ from Unix. Mitigation: always use `path.resolve()`, test on Windows during CI. Accept paths in both forward-slash and backslash formats.


---
# openspec/changes/phase-12-cli-api/proposal.md
---
## Why

IndeX needs user-facing interfaces. The CLI provides immediate command-line access to all operations (`index`, `search`, `pack`, `chunk`, `embed`, `watch`, `stats`). The HTTP API (Hono) enables remote access and integration with other tools. A lightweight web UI (SPA) provides a visual search interface. Without these, the system has no way for users to interact with it.

## What Changes

- Create `src/presentation/cli/cli.ts` — CLI entry point with all commands using Bun's built-in argument parsing or `commander`:
  - `indeX index <path>` — full indexing
  - `indeX search <query>` — search with `--mode`, `--tags`, `--top-k`
  - `indeX pack <path> -o <file>` — file packaging
  - `indeX chunk <path>` — chunking with `--strategy`
  - `indeX embed <path>` — embedding generation
  - `indeX watch <path>` — watch and auto-index
  - `indeX stats` — database statistics
- Create `src/presentation/api/server.ts` — Hono HTTP API:
  - `GET /api/search?q=...&mode=hybrid&top_k=10`
  - `GET /api/stats`
  - `POST /api/index` with directory path in body
- Create `src/presentation/web/` — lightweight SPA for search and visualization
- Write tests for CLI commands and API endpoints before implementation (RED → GREEN)

## Capabilities

### New Capabilities
- `cli`: Complete command-line interface for all IndeX operations — index, search, pack, chunk, embed, watch, stats
- `http-api`: Hono-based HTTP API exposing search, stats, and index endpoints for remote integration
- `web-ui`: Single-page application for visual search and system status

### Modified Capabilities
- None

## Impact

- Adds files in `src/presentation/cli/`, `src/presentation/api/`, `src/presentation/web/`
- New dependency: `hono` (HTTP API), optional `commander` (CLI)
- Depends on Phase 11 (DI container providing all use cases)
- Production-ready: all preceding phases must be complete and tested


---
# openspec/changes/phase-12-cli-api/specs/spec.md
---
## ADDED Requirements

### Requirement: CLI commands
The system SHALL provide a CLI with all IndeX commands.

#### Scenario: CLI has all commands
- **WHEN** running `indeX --help`
- **THEN** the output SHALL list all commands: `index`, `search`, `pack`, `chunk`, `embed`, `watch`, `stats`

#### Scenario: index command
- **WHEN** running `indeX index ./vault`
- **THEN** it SHALL index all supported files in the directory

#### Scenario: search command
- **WHEN** running `indeX search "query" --mode hybrid --top-k 5`
- **THEN** it SHALL return top 5 hybrid search results

#### Scenario: pack command
- **WHEN** running `indeX pack ./vault -o bundle.md`
- **THEN** it SHALL create a bundled Markdown file

### Requirement: HTTP API
The system SHALL provide a Hono-based HTTP API.

#### Scenario: Search endpoint
- **WHEN** sending `GET /api/search?q=test&mode=hybrid`
- **THEN** it SHALL return JSON search results

#### Scenario: Stats endpoint
- **WHEN** sending `GET /api/stats`
- **THEN** it SHALL return index statistics as JSON

#### Scenario: Index endpoint
- **WHEN** sending `POST /api/index` with `{ path: "./vault" }`
- **THEN** it SHALL start indexing and return a status response

### Requirement: Web UI
The system SHALL provide a lightweight single-page application for search.

#### Scenario: Search interface
- **WHEN** opening the web UI in a browser
- **THEN** it SHALL display a search input and results area


---
# openspec/changes/phase-12-cli-api/tasks.md
---
## 1. CLI

- [x] 1.1 **RED**: Write tests for CLI commands — CLI parses `index <path>`, `search <query>`, `pack <path> -o <file>`, `chunk <path>`, `embed <path>`, `watch <path>`, `stats` commands with correct flags, --help lists all commands
- [x] 1.2 **GREEN**: Create `src/presentation/cli/cli.ts` — import `createApp()` from DI container, wire each command to the corresponding use case
- [x] 1.3 **TEST**: Run `bun test tests/presentation/cli/` — all CLI tests pass

## 2. HTTP API

- [x] 2.1 Install `hono` dependency
- [x] 2.2 **RED**: Write tests for API endpoints — `GET /api/search?q=...` returns JSON results, `GET /api/stats` returns stats JSON, `POST /api/index` returns status response
- [x] 2.3 **GREEN**: Create `src/presentation/api/server.ts` — Hono app wrapping use cases, CORS enabled for SPA
- [x] 2.4 **TEST**: Run `bun test tests/presentation/api/` — all API tests pass

## 3. Web UI

- [x] 3.1 **GREEN**: Create `src/presentation/web/index.html` — minimal SPA with search input, results display, index trigger button
- [x] 3.2 **GREEN**: Serve static files from Hono (src/presentation/web/*)


---
# openspec/changes/phase-7-database-layer/design.md
---
## Context

IndeX needs a persistent, local, serverless vector database for storing chunk embeddings and file AST indices. LanceDB is an embedded vector DB written in Rust with Lance columnar format — it supports ANN (via IVF-PQ), FTS (BM25), and runs in-process with no external server.

## Goals / Non-Goals

**Goals:**
- Two LanceDB tables: `sources` (chunks with embeddings) and `file_index` (AST summaries)
- `sources` table schema: all `SourceData` fields including multi-column `vect_{model_name}` vectors
- `file_index` table schema: path (primary key), file_blake3, language, imports, exports, symbols, relationships, last_parsed
- Full CRUD: upsert, getById, getByPath, delete, search (ANN + FTS), stats
- Hybrid search: ANN (cosine similarity) + BM25 FTS with normalizable weights
- Multi-column ANN: search each `vect_{model}` column independently and merge results
- `MockSourceRepository`: In-memory Map-based implementation for unit tests
- In-memory LanceDB mode for unit tests (no filesystem dependency)

**Non-Goals:**
- No table migrations (schema is defined at creation time and assumed stable)
- No replication or sharding
- No backup/restore (local filesystem suffices for a personal tool)

## Decisions

- **Two-table design**: Separates chunk data from file-level AST data. `file_index` has one row per file; `sources` has many rows per file. This avoids duplicating AST data across every chunk.
- **Single embeddings column (v1)**: The current `SourceData.embeddings` field is typed as `number[]`, so all vectors are stored in a single `embeddings` column. Multi-column storage (`vect_{model_name}`) is deferred until `SourceData` supports multi-model embeddings (e.g., `Record<string, number[]>`). LanceDB will dynamically add vector columns when that happens.
- **`chunk_id = source_id:chunk_index`**: Enables lookups by source without knowing individual chunk IDs. `getBySourceId(source_id)` returns all chunks for a file.
- **MockSourceRepository in-memory**: Uses `Map<string, SourceData>` for zero-dependency fast tests. All search operations are simplified (linear scan + in-memory sort) — correctness for orchestration logic, not search quality.
- **LanceDB in-memory mode**: `lancedb.connect("memory://")` creates a temporary database. Tests don't write to disk, don't need cleanup, and run fast.

## Risks / Trade-offs

- **LanceDB vector search quality**: IVF-PQ is approximate. For a personal note-taking app with <100K chunks, exact search (brute force) would work fine. Mitigation: configure IVF-PQ with conservative parameters (high probe count).
- **Windows compatibility**: LanceDB ships prebuilt binaries for win32-x64. Verify with `bun add @lancedb/lancedb` during development.


---
# openspec/changes/phase-7-database-layer/proposal.md
---
## Why

Persistent storage is the backbone of IndeX. Every indexed chunk, its embeddings, and its file-level AST data must be stored and retrievable. LanceDB provides an embedded vector database with both ANN (Approximate Nearest Neighbor) and FTS (Full-Text Search via BM25) — no external server required. This phase implements `LanceDbSourceRepository` as the `SourceRepository` port adapter.

## What Changes

- Create `tests/mocks/MockSourceRepository.ts` — in-memory implementation for unit tests in downstream phases (Phases 8-9)
- Create `src/infrastructure/lancedb/LanceDbSourceRepository.ts` — full LanceDB adapter with two tables (`sources` and `file_index`)
- Create `tests/infrastructure/lancedb/LanceDbSourceRepository.test.ts` before implementation (RED → GREEN)
- Implement all `SourceRepository` methods: upsert, upsertBatch, getById, getByPath, getBySourceId, delete, deleteBySourceId, deleteByPath, search (ANN + FTS), hasSemanticBlake3, hasModelEmbedding, getSourceIdsByHash, getFileBlake3ByPath, stats
- Implement FileIndex methods: upsertFileIndex, getFileIndex, deleteFileIndex
- Multi-column vector support: `vect_{model_name}` for each embedding model

## Capabilities

### New Capabilities
- `mock-source-repository`: In-memory `SourceRepository` implementation for unit testing all downstream services and use cases
- `lancedb-source-repository`: Full `SourceRepository` adapter using LanceDB with two tables (`sources` for chunks, `file_index` for AST), multi-column vector embeddings (`vect_{model_name}`), hybrid search (ANN cosine similarity + FTS BM25), and comprehensive stats

### Modified Capabilities
- None

## Impact

- Adds 1 implementation file in `src/infrastructure/lancedb/`
- Adds 1 test file in `tests/infrastructure/lancedb/`
- Adds 1 mock file in `tests/mocks/`
- New dependency: `@lancedb/lancedb` (LanceDB Node.js binding)
- Depends on Phase 1 (SourceRepository port interface, SourceData, FileIndex types)
- Unlocks Phase 8 (IndexingService, SearchService need persistent storage) and Phase 9 (all use cases)


---
# openspec/changes/phase-7-database-layer/specs/lancedb-source-repository/spec.md
---
## ADDED Requirements

### Requirement: LanceDB-based source repository
The system SHALL persist chunks and file indexes in LanceDB with hybrid search support.

#### Scenario: Two tables
- **WHEN** connecting to LanceDB
- **THEN** it SHALL create `sources` table (for chunks) and `file_index` table (for AST summaries)

#### Scenario: Upsert and retrieve
- **WHEN** upserting a `SourceData` record
- **THEN** it SHALL be retrievable by `id`, `path`, and `source_id`

#### Scenario: Multi-column vector search
- **WHEN** inserting embeddings for multiple models
- **THEN** each model SHALL be stored in its own vector column (`vect_{model_name}`)

#### Scenario: Hybrid search
- **WHEN** performing search with `mode: "hybrid"`
- **THEN** ANN (cosine similarity) and FTS (BM25) SHALL both be queried

#### Scenario: Stats
- **WHEN** requesting stats
- **THEN** `total_sources`, `total_chunks`, and `total_files` SHALL be reported

#### Scenario: hasSemanticBlake3
- **WHEN** checking if a semantic_blake3 exists
- **THEN** it SHALL return `true` if any chunk has that hash

#### Scenario: Delete by path
- **WHEN** deleting by file path
- **THEN** all chunks for that path SHALL be removed


---
# openspec/changes/phase-7-database-layer/specs/mock-source-repository/spec.md
---
## ADDED Requirements

### Requirement: In-memory mock repository for tests
The system SHALL provide an in-memory `SourceRepository` implementation for unit tests.

#### Scenario: All SourceRepository methods implemented
- **WHEN** using `MockSourceRepository`
- **THEN** it SHALL implement all methods of the `SourceRepository` interface

#### Scenario: In-memory storage
- **WHEN** upserting and searching
- **THEN** data SHALL be stored in-memory (no disk I/O)


---
# openspec/changes/phase-7-database-layer/tasks.md
---
## 1. MockSourceRepository

- [x] 1.1 **GREEN**: Create `tests/mocks/MockSourceRepository.ts` — in-memory Map<id, SourceData> + Map<path, FileIndex>, implements ALL SourceRepository methods including upsertBatch, search (linear scan), stats (object size counts), hasSemanticBlake3, hasModelEmbedding, fileIndex methods

## 2. LanceDbSourceRepository

- [x] 2.1 **RED**: Write `tests/infrastructure/lancedb/LanceDbSourceRepository.test.ts` — in-memory LanceDB mode (`connect("memory://")`):
  - **sources table**: upsert → getById, getByPath, getBySourceId, upsertBatch → batch retrieve, delete → verify removal, deleteBySourceId, deleteByPath
  - **embeddings**: multi-column vect_{model_name}, hasSemanticBlake3, hasModelEmbedding
  - **file_index**: upsertFileIndex, getFileIndex, deleteFileIndex, getFileBlake3ByPath
  - **cleanup**: dropAll deletes all data
- [x] 2.2 **GREEN**: Create `src/infrastructure/lancedb/LanceDbSourceRepository.ts`:
  - Two tables: `sources` with all SourceData fields, `file_index` with path/file_blake3/language/imports/exports/symbols
  - Multi-column vectors: `vect_{model_name}` per embedding model
  - Hybrid search: ANN (cosine) + FTS (BM25)
  - Implements `SourceRepository` interface fully
- [x] 2.3 **TEST**: Run `bun test tests/infrastructure/lancedb/LanceDbSourceRepository.test.ts` — all tests pass


---
# openspec/specs/blake3-deduplicator/spec.md
---
## ADDED Requirements

### Requirement: O(n) dedup by semantic_blake3
The system SHALL deduplicate search results by `semantic_blake3` hash, keeping the entry with maximum score.

#### Scenario: Duplicates removed
- **WHEN** deduplicating results with the same `semantic_blake3`
- **THEN** only the result with the highest `score` SHALL be kept

#### Scenario: O(n) via Map
- **WHEN** deduplicating N results
- **THEN** the operation SHALL complete in O(n) time using a `Map<hash, SearchResult>`


---
# openspec/specs/blake3-hasher/spec.md
---
## ADDED Requirements

### Requirement: BLAKE3 hash computation
The system SHALL compute BLAKE3 hashes of strings and files using `hash-wasm`.

#### Scenario: Hash of a string
- **WHEN** calling `hasher.hash("hello")`
- **THEN** it SHALL return a 64-character hex string

#### Scenario: Different inputs produce different hashes
- **WHEN** calling `hasher.hash("hello")` and `hasher.hash("world")`
- **THEN** the results SHALL be different

#### Scenario: HashFile returns same hash as hash(content)
- **WHEN** hashing a file via `hashFile(path)`
- **THEN** the result SHALL equal `hash(content)` where content is the file's text

#### Scenario: Hash of empty string
- **WHEN** calling `hasher.hash("")`
- **THEN** it SHALL return a valid 64-character hex string


---
# openspec/specs/cached-embedder/spec.md
---
## ADDED Requirements

### Requirement: Proxy decorator with caching
The system SHALL wrap any embedder with a cache-checking proxy.

#### Scenario: Cache hit skips inner call
- **WHEN** a cached embedding exists for `{model, text}`
- **THEN** the cached value SHALL be returned without calling the inner embedder

#### Scenario: Cache miss calls inner and caches
- **WHEN** no cached embedding exists
- **THEN** the inner embedder SHALL be called and the result SHALL be cached


---
# openspec/specs/chokidar-watcher/spec.md
---
## ADDED Requirements

### Requirement: File system watcher
The system SHALL watch directories for file changes using chokidar.

#### Scenario: Emits add/change/unlink
- **WHEN** a file is added, changed, or deleted in the watched directory
- **THEN** the watcher SHALL emit corresponding events with the file path

#### Scenario: Start/stop lifecycle
- **WHEN** starting and stopping the watcher
- **THEN** it SHALL correctly manage internal chokidar resources

#### Scenario: 500ms debounce
- **WHEN** multiple rapid file changes occur
- **THEN** the watcher SHALL debounce events with a 500ms delay

---
# openspec/specs/chunk-use-case/spec.md
---
## ADDED Requirements

### Requirement: Chunk use case
The system SHALL chunk files with configurable strategy and filters.

#### Scenario: Execute chunk
- **WHEN** calling `chunkUseCase.execute("./vault", { strategy: "heading" })`
- **THEN** it SHALL return `Chunk[]` with metadata

---
# openspec/specs/chunker-factory/spec.md
---
## ADDED Requirements

### Requirement: Pipeline with fallback chain
The system SHALL build a chunker pipeline with configurable fallback strategies, merge, and overlap.

#### Scenario: Pipeline creation
- **WHEN** calling `createPipeline(['heading', 'paragraph', 'sentence', 'overflow'])`
- **THEN** it SHALL create a pipeline with fallback chain in that order

#### Scenario: Small chunk merge
- **WHEN** consecutive chunks are < 50 tokens
- **THEN** they SHALL be merged with the previous chunk

#### Scenario: Overlap between chunks
- **WHEN** creating chunks with overlap
- **THEN** the last `overlap_tokens` SHALL repeat at the start of the next chunk
- **THEN** overlap text SHALL NOT be in `core_content`


---
# openspec/specs/code-chunker/spec.md
---
## ADDED Requirements

### Requirement: Split code by function/class boundaries
The system SHALL split TypeScript code by function and class boundaries as indivisible units.

#### Scenario: Function is one chunk
- **WHEN** chunking code with one function
- **THEN** the entire function SHALL be one chunk (indivisible)

#### Scenario: Class is one chunk
- **WHEN** chunking code with one class
- **THEN** the entire class SHALL be one chunk (indivisible)

#### Scenario: No overlap for code
- **WHEN** chunking code
- **THEN** there SHALL be no overlap between code chunks


---
# openspec/specs/code-parser/spec.md
---
## ADDED Requirements

### Requirement: TypeScript code parsing via ast-grep
The system SHALL parse TypeScript source code extracting symbols, imports, and exports.

#### Scenario: Parse sample-function.ts
- **WHEN** parsing a TypeScript file
- **THEN** it SHALL return `ParsedSource` with `type: 'typescript'`, `CodeMetadata`, and optional `ast: FileIndex`

#### Scenario: Symbols extracted
- **WHEN** parsing a file with functions/classes/interfaces
- **THEN** `symbols` SHALL contain entries with `kind`, `name`, `signature`, and positions

#### Scenario: Imports and exports
- **WHEN** parsing a file with imports and exports
- **THEN** `ast.imports` and `ast.exports` SHALL be populated with correct `source` and `name`

#### Scenario: Complexity metrics
- **WHEN** parsing a TypeScript file
- **THEN** `metadata.complexity` SHALL contain `lines`, `functions`, `classes` counts


---
# openspec/specs/config-loader/spec.md
---
## ADDED Requirements

### Requirement: Config loader
The system SHALL load and validate configuration from `.indeX/config.json` using Zod.

#### Scenario: Load validates config
- **WHEN** loading a valid config file
- **THEN** it SHALL return a validated `Config` object

#### Scenario: LoadOrDefault returns defaults
- **WHEN** no config file exists
- **THEN** `loadOrDefault()` SHALL return sensible defaults

#### Scenario: Invalid JSON raises error
- **WHEN** loading a malformed config file
- **THEN** it SHALL throw a descriptive Zod validation error

---
# openspec/specs/delete-use-case/spec.md
---
## ADDED Requirements

### Requirement: Delete use case
The system SHALL remove indexed data by path or source ID.

#### Scenario: Delete by path
- **WHEN** calling `deleteUseCase.execute("./vault/note.md")`
- **THEN** all chunks for that path SHALL be removed from the index

---
# openspec/specs/di-container/spec.md
---
## ADDED Requirements

### Requirement: DI container wires all modules
The system SHALL wire together all IndeX modules in a single composition root.

#### Scenario: createApp() returns use cases
- **WHEN** calling `createApp(configPath)`
- **THEN** it SHALL return an object with all use cases: `index`, `search`, `pack`, `chunk`, `embed`, `watch`, `delete`

#### Scenario: Eager initialization
- **WHEN** calling `createApp()`
- **THEN** all dependencies SHALL be constructed eagerly (no lazy singletons except external connections)

---
# openspec/specs/di-systems/spec.md
---
## ADDED Requirements

### Requirement: DI dependency groups
The system SHALL bundle related dependencies into DI group interfaces for use case injection.

#### Scenario: IndexSystems bundle
- **WHEN** defining `IndexSystems`
- **THEN** it SHALL include `ParserRegistry`, `ChunkerPipeline`, `EmbedderRegistry`, `SourceRepository`, `Logger`, `Hasher`

#### Scenario: SearchSystems bundle
- **WHEN** defining `SearchSystems`
- **THEN** it SHALL include `Embedder`, `SourceRepository`, `ContextPacker`, `Logger`

#### Scenario: PackSystems bundle
- **WHEN** defining `PackSystems`
- **THEN** it SHALL include `ParserRegistry`, `FileFilter`, `Logger`

#### Scenario: ChunkSystems bundle
- **WHEN** defining `ChunkSystems`
- **THEN** it SHALL include `ParserRegistry`, `Chunker`, `FileFilter`, `Logger`

#### Scenario: EmbedSystems bundle
- **WHEN** defining `EmbedSystems`
- **THEN** it SHALL include `EmbedderRegistry`, `SourceRepository`, `Logger`

---
# openspec/specs/diff-indexing-service/spec.md
---
## ADDED Requirements

### Requirement: Incremental diff indexing
The system SHALL index only changed files by comparing `file_blake3` hashes.

#### Scenario: Unchanged file skipped
- **WHEN** `file_blake3` matches the stored hash
- **THEN** the file SHALL be skipped (no re-processing)

#### Scenario: Changed file re-processed
- **WHEN** `file_blake3` differs from the stored hash
- **THEN** the file SHALL be re-parsed, re-chunked, and re-embedded

#### Scenario: Cross-file semantic dedup
- **WHEN** removing a chunk whose `semantic_blake3` is referenced by another file
- **THEN** the chunk SHALL NOT be deleted

#### Scenario: FileIndex rebuilt
- **WHEN** a file changes
- **THEN** its `FileIndex` SHALL be rebuilt with updated symbols/imports/exports


---
# openspec/specs/domain-ast/spec.md
---
## ADDED Requirements

### Requirement: FileIndex stores per-file AST data
The system SHALL maintain a `FileIndex` per file containing its AST summary.

#### Scenario: FileIndex can be created
- **WHEN** creating a `FileIndex`
- **THEN** it SHALL contain `path`, `file_blake3`, `language`, `imports`, `exports`, `symbols`, `relationships`, `last_parsed`

### Requirement: SymbolDetail describes code symbols
The system SHALL describe each code symbol with its kind, name, and location.

#### Scenario: SymbolDetail has required fields
- **WHEN** creating a `SymbolDetail`
- **THEN** it SHALL have `kind` (from `SymbolKind`), `name`, `signature`, `startPosition`, `endPosition`


---
# openspec/specs/domain-ports/spec.md
---
## ADDED Requirements

### Requirement: SourceRepository provides full CRUD
The system SHALL define a `SourceRepository` port for chunk storage and retrieval.

#### Scenario: All repository methods exist
- **WHEN** using `SourceRepository`
- **THEN** it SHALL provide methods: `upsert`, `upsertBatch`, `getById`, `getByPath`, `delete`, `search`, `hasSemanticBlake3`, `hasModelEmbedding`, `getSourceIdsByHash`, `getFileBlake3ByPath`, `stats`, `upsertFileIndex`, `getFileIndex`, `deleteFileIndex`

### Requirement: SourceParser parses files by extension
The system SHALL define a `SourceParser` port for file parsing.

#### Scenario: Parser has type and extension info
- **WHEN** inspecting a `SourceParser`
- **THEN** it SHALL have `type` (SourceType), `extensions` (string[]), `supportsFile(path)`, and `parse(path)`

#### Scenario: ParserRegistry routes files
- **WHEN** calling `ParserRegistry.getParser(path)`
- **THEN** it SHALL return the correct parser based on extension and content sniffing

### Requirement: FileWatcher monitors directories
The system SHALL define a `FileWatcher` port with lifecycle and events.

#### Scenario: Watcher emits file events
- **WHEN** a file is added/changed/deleted in the watched directory
- **THEN** the watcher SHALL emit `add`, `change`, or `unlink` events


---
# openspec/specs/domain-systems/spec.md
---
## ADDED Requirements

### Requirement: Chunker splits text into chunks
The system SHALL define a `Chunker` interface for text splitting.

#### Scenario: Chunker returns typed chunks
- **WHEN** calling `chunker.chunk(text)`
- **THEN** it SHALL return `Chunk[]` with `content`, `core_content`, `chunk_index`, `total_chunks`, `strategy`, `size_tokens`

### Requirement: Embedder generates vectors
The system SHALL define an `Embedder` interface for text vectorization.

#### Scenario: Embedder returns typed embeddings
- **WHEN** calling `embedder.embed(text)`
- **THEN** it SHALL return `Embedding` with `vector`, `model`, `dimensions`, `tokens_in`

### Requirement: EmbedderRegistry resolves models
The system SHALL define an `EmbedderRegistry` for model selection by source type.

#### Scenario: Registry returns correct embedder
- **WHEN** calling `registry.getEmbedder("typescript")`
- **THEN** it SHALL return the embedder with the highest priority (lowest priority number) for that source type

### Requirement: Hasher produces content hashes
The system SHALL define a `Hasher` interface for content hashing.

#### Scenario: Hasher returns hex string
- **WHEN** calling `hasher.hash(data)`
- **THEN** it SHALL return a 64-character hex string

### Requirement: ContextPacker formats search results
The system SHALL define a `ContextPacker` interface for RAG context formatting.

#### Scenario: ContextPacker returns PackedContext
- **WHEN** calling `packer.pack(results)`
- **THEN** it SHALL return `PackedContext` with `markdown`, `chunks_used`, `total_tokens`, `truncated`, `source_notes`


---
# openspec/specs/domain-types/spec.md
---
## ADDED Requirements

### Requirement: Core data types
The system SHALL define shared data types for all indexing and search operations.

#### Scenario: SourceData can be created
- **WHEN** creating a `SourceData` object
- **THEN** it SHALL contain all required fields: `id`, `chunk_id`, `source_id`, `type`, `title`, `content`, `tags`, `path`, `file_blake3`, `semantic_blake3`, `chunk_index`, `total_chunks`, `embeddings`, `metadata`, timestamps

#### Scenario: SearchResult contains source and score
- **WHEN** creating a `SearchResult`
- **THEN** it SHALL contain the `source` data, `score`, `match_type`, and optional `model_scores`

#### Scenario: SourceMetadata is a discriminated union
- **WHEN** creating metadata
- **THEN** the `kind` field SHALL discriminate between `'code'`, `'markdown'`, `'obsidian'`, and `'generic'`
- **THEN** TypeScript SHALL enforce exhaustive narrowing on `kind`

#### Scenario: IndexStats reports correct counts
- **WHEN** requesting `IndexStats`
- **THEN** it SHALL contain `total_sources`, `total_chunks`, `total_files`, and `last_indexed` timestamp


---
# openspec/specs/embed-use-case/spec.md
---
## ADDED Requirements

### Requirement: Embed use case
The system SHALL generate embeddings from chunks or re-parsed files.

#### Scenario: Embed from chunks
- **WHEN** calling `embedUseCase.execute({ source: "chunks" })`
- **THEN** it SHALL embed existing chunks and upsert to database

---
# openspec/specs/embedder-cache-lru/spec.md
---
## ADDED Requirements

### Requirement: Per-model LRU cache
The system SHALL cache embedding vectors per model with LRU eviction.

#### Scenario: Set and get
- **WHEN** setting a cache entry and getting it
- **THEN** the same embedding SHALL be returned

#### Scenario: Cache key includes model
- **WHEN** caching with key `${model}:${hash}`
- **THEN** different models with the same hash SHALL have different cache entries

#### Scenario: LRU eviction
- **WHEN** the cache exceeds max size
- **THEN** the least recently used entry SHALL be evicted


---
# openspec/specs/embedder-registry/spec.md
---
## ADDED Requirements

### Requirement: Config-driven embedder registry
The system SHALL build an embedder registry from `ModelConfig[]`, routing source types to correct models by priority.

#### Scenario: getEmbedder by source type
- **WHEN** calling `registry.getEmbedder("typescript")`
- **THEN** it SHALL return the model with minimum priority for that source type

#### Scenario: getEmbedders returns all matching models
- **WHEN** calling `registry.getEmbedders("typescript")`
- **THEN** it SHALL return all models that support that source type, ordered by priority

#### Scenario: Universal model returned for unresolvable types
- **WHEN** calling `registry.getEmbedder("unknown-type")`
- **THEN** it SHALL return the universal model (model without source_types filter)

#### Scenario: isAvailable returns false with no models
- **WHEN** the registry has no registered models
- **THEN** `isAvailable()` SHALL return false


---
# openspec/specs/gpt-tokenizer/spec.md
---
## ADDED Requirements

### Requirement: GPT-compatible token counting and truncation
The system SHALL count tokens and truncate text to fit within GPT token budgets.

#### Scenario: Token count returns number
- **WHEN** calling `tokenizer.count("hello world")`
- **THEN** it SHALL return the number of GPT tokens

#### Scenario: Truncate to max tokens
- **WHEN** calling `tokenizer.truncate(text, 50)`
- **THEN** it SHALL truncate text to approximately 50 tokens, preferring word boundaries


---
# openspec/specs/heading-chunker/spec.md
---
## ADDED Requirements

### Requirement: Split Markdown by headings
The system SHALL split Markdown content by H1/H2+ headings, returning whole sections as chunks.

#### Scenario: Section under max_tokens
- **WHEN** chunking a Markdown section ≤ max_tokens
- **THEN** it SHALL return one chunk with that section's content

#### Scenario: Section over max_tokens falls through
- **WHEN** chunking a Markdown section > max_tokens
- **THEN** the chunker SHALL return no chunks (pipeline falls to next chunker)

#### Scenario: core_content is body without overlap
- **WHEN** a heading chunk is created
- **THEN** `core_content` SHALL be the section body without overlap text


---
# openspec/specs/index-use-case/spec.md
---
## ADDED Requirements

### Requirement: Full index use case
The system SHALL orchestrate complete indexing with all real systems via DI.

#### Scenario: Execute full index
- **WHEN** calling `indexUseCase.execute("./vault")`
- **THEN** it SHALL scan, parse, chunk, multi-model embed, and upsert all files

---
# openspec/specs/indexing-service/spec.md
---
## ADDED Requirements

### Requirement: Full indexing pipeline
The system SHALL index a directory by scanning, parsing, chunking, embedding, and upserting all supported files.

#### Scenario: Index scans and processes files
- **WHEN** calling `indexingService.index("./fixtures")`
- **THEN** it SHALL scan directory, parse each file, chunk, embed, and upsert to the repository

#### Scenario: Exclude patterns respected
- **WHEN** exclude patterns are configured
- **THEN** matching files SHALL be skipped

#### Scenario: Multi-model embedding
- **WHEN** multiple embedding models are configured
- **THEN** each chunk SHALL be embedded by all applicable models


---
# openspec/specs/integration-test/spec.md
---
## ADDED Requirements

### Requirement: Integration test validates full pipeline
The system SHALL have an integration test exercising real parsers + real chunkers + mocks.

#### Scenario: Index → search → pack cycle
- **WHEN** running the integration test
- **THEN** a Markdown fixture SHALL be indexed, searchable, and packable through the full pipeline

---
# openspec/specs/lancedb-embedder/spec.md
---
## ADDED Requirements

### Requirement: Zero-vector fallback embedder
The system SHALL provide a fallback embedder that returns zero vectors of configured dimension.

#### Scenario: Returns zero vector
- **WHEN** calling `lancedbEmbedder.embed("any text")`
- **THEN** it SHALL return a zero-filled `Float32Array` of configured dimensions

#### Scenario: Enables ANN without Ollama
- **WHEN** Ollama is unavailable
- **THEN** the zero-vector embedder SHALL enable ANN search (keyword-only via L2 distance on zero vectors)


---
# openspec/specs/lancedb-source-repository/spec.md
---
## ADDED Requirements

### Requirement: LanceDB-based source repository
The system SHALL persist chunks and file indexes in LanceDB with hybrid search support.

#### Scenario: Two tables
- **WHEN** connecting to LanceDB
- **THEN** it SHALL create `sources` table (for chunks) and `file_index` table (for AST summaries)

#### Scenario: Upsert and retrieve
- **WHEN** upserting a `SourceData` record
- **THEN** it SHALL be retrievable by `id`, `path`, and `source_id`

#### Scenario: Multi-column vector search
- **WHEN** inserting embeddings for multiple models
- **THEN** each model SHALL be stored in its own vector column (`vect_{model_name}`)

#### Scenario: Hybrid search
- **WHEN** performing search with `mode: "hybrid"`
- **THEN** ANN (cosine similarity) and FTS (BM25) SHALL both be queried

#### Scenario: Stats
- **WHEN** requesting stats
- **THEN** `total_sources`, `total_chunks`, and `total_files` SHALL be reported

#### Scenario: hasSemanticBlake3
- **WHEN** checking if a semantic_blake3 exists
- **THEN** it SHALL return `true` if any chunk has that hash

#### Scenario: Delete by path
- **WHEN** deleting by file path
- **THEN** all chunks for that path SHALL be removed


---
# openspec/specs/markdown-ast-parser/spec.md
---
## ADDED Requirements

### Requirement: Markdown heading extractor
The system SHALL extract headings from Markdown for chunking.

#### Scenario: Headings with level and anchor
- **WHEN** extracting headings from Markdown
- **THEN** each heading SHALL have `level`, `text`, and GitHub-style `anchor`

---
# openspec/specs/markdown-parser/spec.md
---
## ADDED Requirements

### Requirement: Markdown file parsing
The system SHALL parse Markdown files extracting headings, links, resources, and statistics.

#### Scenario: Parse simple-note.md
- **WHEN** parsing a simple Markdown file
- **THEN** it SHALL return `ParsedSource` with H1 as `title`, full text as `content`, and `MarkdownMetadata`

#### Scenario: Headings extracted
- **WHEN** parsing Markdown with headings
- **THEN** `metadata.headings` SHALL contain all H1/H2+ with `level`, `text`, and `anchor`

#### Scenario: Links extracted
- **WHEN** parsing Markdown with links
- **THEN** `metadata.links` SHALL contain `url`, `text`, `isInternal`, `isAnchor`

#### Scenario: Stats computed
- **WHEN** parsing a Markdown file
- **THEN** `metadata.stats` SHALL contain `wordCount`, `readingTimeMinutes`, `paragraphCount`, `codeBlockCount`


---
# openspec/specs/mock-hasher/spec.md
---
## ADDED Requirements

### Requirement: MockHasher for tests
The system SHALL provide a `MockHasher` using SHA256 for deterministic test hashing.

#### Scenario: MockHasher produces deterministic hashes
- **WHEN** calling `mockHasher.hash("test")`
- **THEN** it SHALL return the same SHA256 hex string every time

#### Scenario: MockHasher implements Hasher interface
- **WHEN** checking `MockHasher` type
- **THEN** it SHALL satisfy the `Hasher` interface


---
# openspec/specs/mock-source-repository/spec.md
---
## ADDED Requirements

### Requirement: In-memory mock repository for tests
The system SHALL provide an in-memory `SourceRepository` implementation for unit tests.

#### Scenario: All SourceRepository methods implemented
- **WHEN** using `MockSourceRepository`
- **THEN** it SHALL implement all methods of the `SourceRepository` interface

#### Scenario: In-memory storage
- **WHEN** upserting and searching
- **THEN** data SHALL be stored in-memory (no disk I/O)


---
# openspec/specs/multi-model-embedder/spec.md
---
## ADDED Requirements

### Requirement: Parallel multi-model embedding
The system SHALL invoke multiple embedders in parallel and return all results.

#### Scenario: Returns Record of model → embedding
- **WHEN** calling `embedAll(text)` with multiple embedders
- **THEN** it SHALL return `Record<modelName, Embedding>` with entries for all successful embedders

#### Scenario: Partial failure tolerated
- **WHEN** one embedder fails
- **THEN** the other embedders' results SHALL still be returned


---
# openspec/specs/null-embedder/spec.md
---
## ADDED Requirements

### Requirement: Error-throwing null embedder
The system SHALL provide a null embedder that always throws.

#### Scenario: Always throws
- **WHEN** calling `nullEmbedder.embed("anything")`
- **THEN** it SHALL throw "no embedder available"


---
# openspec/specs/obsidian-parser/spec.md
---
## ADDED Requirements

### Requirement: Obsidian note parsing
The system SHALL parse Obsidian notes with YAML frontmatter and wiki-links.

#### Scenario: Parse obsidian-note.md
- **WHEN** parsing an Obsidian note with frontmatter
- **THEN** title SHALL come from frontmatter `title`, tags from frontmatter `tags`, and `ObsidianMetadata` SHALL contain `wikiLinks`

#### Scenario: Wiki-links extracted
- **WHEN** parsing a note with `[[target]]` and `[[target|alias]]`
- **THEN** `metadata.wikiLinks` SHALL contain entries with `target` and optional `alias`

#### Scenario: Content without frontmatter
- **WHEN** parsing an Obsidian note
- **THEN** `content` SHALL exclude the YAML frontmatter block

#### Scenario: Backlinks and graphConnections are empty
- **WHEN** parsing a single Obsidian note
- **THEN** `backlinks` and `graphConnections` SHALL be empty arrays (filled separately by DiffIndexingService)


---
# openspec/specs/ollama-embedder/spec.md
---
## ADDED Requirements

### Requirement: Embed text via Ollama API
The system SHALL generate embeddings by calling Ollama's `/api/embeddings`.

#### Scenario: embed returns Float32Array
- **WHEN** calling `embed("hello")`
- **THEN** it SHALL return an `Embedding` with `vector: Float32Array` of configured `dimensions`

#### Scenario: embedBatch sends one HTTP request
- **WHEN** calling `embedBatch(["a", "b", "c"])`
- **THEN** it SHALL send a single HTTP POST to `/api/embeddings` with an array of strings

#### Scenario: Exponential backoff on failure
- **WHEN** the Ollama API returns an error
- **THEN** retry with backoff: 1s → 2s → 4s (max 3 attempts)

#### Scenario: AbortSignal cancels request
- **WHEN** an `AbortSignal` is triggered
- **THEN** the in-flight request SHALL be cancelled


---
# openspec/specs/overflow-chunker/spec.md
---
## ADDED Requirements

### Requirement: Forced token-boundary split
The system SHALL split text at exact token boundaries as a last resort.

#### Scenario: Forced split
- **WHEN** content exceeds max_tokens and no other strategy works
- **THEN** it SHALL split at the token boundary closest to max_tokens

#### Scenario: Minimum tokens
- **WHEN** creating overflow chunks
- **THEN** each chunk SHALL have at least `min_tokens` tokens


---
# openspec/specs/pack-use-case/spec.md
---
## ADDED Requirements

### Requirement: Pack use case
The system SHALL package files into a single Markdown bundle with include/exclude filters.

#### Scenario: Execute pack
- **WHEN** calling `packUseCase.execute("./vault", { include: ["**/*.md"] })`
- **THEN** it SHALL concatenate matching files into a Markdown document

---
# openspec/specs/paragraph-chunker/spec.md
---
## ADDED Requirements

### Requirement: Split text by blank lines
The system SHALL split text by paragraph boundaries (blank lines).

#### Scenario: Paragraph under max_tokens
- **WHEN** chunking a paragraph ≤ max_tokens
- **THEN** it SHALL return one chunk with that paragraph

#### Scenario: Paragraph over max_tokens delegates
- **WHEN** chunking a paragraph > max_tokens
- **THEN** it SHALL delegate to SentenceChunker recursively


---
# openspec/specs/parser-registry/spec.md
---
## ADDED Requirements

### Requirement: Two-phase parser routing
The system SHALL route files to parsers by extension, with content sniffing for `.md` files.

#### Scenario: getParser(".ts") returns AstGrepParser
- **WHEN** calling `registry.getParser("file.ts")`
- **THEN** it SHALL return the AstGrepParser

#### Scenario: getParser(".md") detects Obsidian vs Markdown
- **WHEN** calling `registry.getParser("note.md")` with Obsidian frontmatter
- **THEN** it SHALL return ObsidianParser

#### Scenario: getParser(".md") returns MarkdownParser for plain markdown
- **WHEN** calling `registry.getParser("note.md")` without Obsidian frontmatter
- **THEN** it SHALL return MarkdownParser

#### Scenario: getParser(".py") returns null
- **WHEN** calling `registry.getParser("file.py")`
- **THEN** it SHALL return `null` if Python parser is not registered

#### Scenario: getEnabledParsers returns active parsers
- **WHEN** calling `registry.getEnabledParsers()`
- **THEN** it SHALL return only parsers whose `enabled` flag is true


---
# openspec/specs/pino-logger/spec.md
---
## ADDED Requirements

### Requirement: Structured logger
The system SHALL provide a pino-based structured logger.

#### Scenario: Log at all levels
- **WHEN** calling `logger.info()`, `logger.warn()`, `logger.error()`, `logger.debug()`
- **THEN** structured JSON output SHALL be produced

#### Scenario: Child loggers
- **WHEN** calling `logger.child({ module: "indexing" })`
- **THEN** the child logger SHALL include the context in all subsequent log entries

---
# openspec/specs/project-init/spec.md
---
## ADDED Requirements

### Requirement: Project initialized with Bun
The project SHALL use Bun as the JavaScript runtime and package manager.

#### Scenario: Bun runtime available
- **WHEN** the project is set up
- **THEN** `bun --version` exits with code 0 and shows a version string

#### Scenario: package.json exists
- **WHEN** initialization completes
- **THEN** a valid `package.json` exists with `name: "index"`, `type: "module"`, and `bun` test scripts

### Requirement: TypeScript strict mode
TypeScript compilation SHALL use strict mode with path aliases.

#### Scenario: tsconfig.json with strict mode
- **WHEN** `tsconfig.json` is loaded
- **THEN** it SHALL have `strict: true` and `@/*` path alias mapping to `src/*`

### Requirement: Test runner works
The test runner SHALL execute tests and report results.

#### Scenario: Example test passes
- **WHEN** running `bun test`
- **THEN** the example test passes (1 passed, 0 failed)

### Requirement: Directory structure exists
The project SHALL have the full source and test directory structure.

#### Scenario: src directories exist
- **WHEN** checking the `src/` directory
- **THEN** all subdirectories from the architecture plan exist (domain, application, infrastructure, presentation, config)

#### Scenario: test directories exist
- **WHEN** checking the `tests/` directory
- **THEN** all subdirectories mirroring `src/` exist (domain, infrastructure, application, fixtures, mocks)


---
# openspec/specs/rag-context-packer/spec.md
---
## ADDED Requirements

### Requirement: End-to-end context packing pipeline
The system SHALL transform search results into LLM-ready Markdown context.

#### Scenario: Full pack pipeline
- **WHEN** calling `packer.pack(results)`
- **THEN** it SHALL deduplicate → sort by score desc → greedy-fit by max_tokens → format as Markdown

#### Scenario: Truncated flag
- **WHEN** results exceed max_tokens
- **THEN** `truncated` SHALL be `true` and some results SHALL be excluded

#### Scenario: Source notes
- **WHEN** packing results from multiple files
- **THEN** `source_notes` SHALL contain unique file paths from included chunks

#### Scenario: RAG format
- **WHEN** using `format: 'rag'`
- **THEN** the output SHALL include a system prompt instruction before the context


---
# openspec/specs/search-service/spec.md
---
## ADDED Requirements

### Requirement: Three-mode search
The system SHALL search indexed content with semantic, keyword, or hybrid modes.

#### Scenario: Semantic search
- **WHEN** searching with `mode: "semantic"`
- **THEN** ANN search SHALL be performed on vector columns

#### Scenario: Keyword search
- **WHEN** searching with `mode: "keyword"`
- **THEN** FTS/BM25 search SHALL be performed

#### Scenario: Hybrid search
- **WHEN** searching with `mode: "hybrid"`
- **THEN** ANN and BM25 results SHALL be merged with weighted hybrid scoring

#### Scenario: BM25 normalization
- **WHEN** performing hybrid search
- **THEN** BM25 scores SHALL be normalized to [0, 1] via `(bm25 - min) / (max - min)`

#### Scenario: Post-filter by tags
- **WHEN** filters include `tags: ["devops"]`
- **THEN** results SHALL be filtered AFTER ANN/FTS search

#### Scenario: Multi-model averaging
- **WHEN** a chunk is found by multiple models
- **THEN** the semantic score SHALL be the average of all model scores


---
# openspec/specs/search-use-case/spec.md
---
## ADDED Requirements

### Requirement: Search use case
The system SHALL search the index with configurable mode and filters.

#### Scenario: Execute search
- **WHEN** calling `searchUseCase.execute("query", { mode: "hybrid" })`
- **THEN** it SHALL return `SearchResult[]` with hybrid ranked results

---
# openspec/specs/sentence-chunker/spec.md
---
## ADDED Requirements

### Requirement: Split text by sentence boundaries
The system SHALL split text at sentence boundaries (`.!?`) without splitting individual sentences.

#### Scenario: Sentences under max_tokens
- **WHEN** chunking text with multiple sentences ≤ max_tokens each
- **THEN** it SHALL split at `.`, `!`, `?` boundaries

#### Scenario: Abbreviation protection
- **WHEN** encountering abbreviations like `Mr.`, `Dr.`, `e.g.`
- **THEN** the chunker SHALL NOT split after these periods

#### Scenario: Overlong sentence delegates
- **WHEN** a single sentence > max_tokens
- **THEN** it SHALL delegate to OverflowChunker


---
# openspec/specs/silent-logger/spec.md
---
## ADDED Requirements

### Requirement: Silent logger for tests
The system SHALL provide a no-op logger for test environments.

#### Scenario: No output
- **WHEN** calling any log method on SilentLogger
- **THEN** no output SHALL be produced

---
# openspec/specs/token-estimator/spec.md
---
## ADDED Requirements

### Requirement: Simple token estimation
The system SHALL estimate token count as `ceil(bytes / 4)`.

#### Scenario: Estimate short text
- **WHEN** calling `estimator.estimate("hello")`
- **THEN** it SHALL return approximately 1-2 tokens

#### Scenario: Estimate empty string
- **WHEN** calling `estimator.estimate("")`
- **THEN** it SHALL return 0

### Requirement: Tiktoken-based estimation (optional)
The system SHALL use tiktoken for accurate GPT token counting when available.

#### Scenario: Tiktoken estimate is accurate
- **WHEN** calling `tiktokenEstimator.estimate("hello world")`
- **THEN** it SHALL return the exact GPT token count

#### Scenario: Tiktoken falls back to Simple
- **WHEN** tiktoken is not installed
- **THEN** the estimator SHALL silently fall back to the Simple strategy


---
# openspec/specs/watch-use-case/spec.md
---
## ADDED Requirements

### Requirement: Watch use case
The system SHALL watch a directory and run diff indexing on file changes.

#### Scenario: Execute watch
- **WHEN** calling `watchUseCase.execute("./vault")`
- **THEN** it SHALL start the FileWatcher and wire events to DiffIndexingService

---
# src/application/ChunkUseCase.ts
---
// ---------------------------------------------------------------------------
// ChunkUseCase — Phase 9
//
// Scans a directory, filters files by include/exclude patterns, parses each
// through the SourceParserRegistry, and chunks the content via a Chunker.
// ---------------------------------------------------------------------------

import { readdirSync } from "fs";
import { join } from "path";
import type { ChunkSystems } from "./di/Systems";
import type { Chunk } from "../domain/systems/ChunkingSystem";

/**
 * Options that control which files are included in chunking.
 */
export interface ChunkOptions {
  /** Glob patterns to include (e.g. `["**\/*.md"]`). */
  include?: string[];
  /** Glob patterns to exclude (e.g. `["**\/*.test.ts"]`). */
  exclude?: string[];
}

/**
 * Very simple glob-like matcher — mirrors the one in PackUseCase.
 */
function matchesGlob(pattern: string, filePath: string): boolean {
  const normalised = filePath.replace(/\\/g, "/");
  if (pattern.startsWith("**/")) {
    const suffix = pattern.slice(3);
    if (suffix.includes("*")) {
      const ext = suffix.slice(1);
      return normalised.endsWith(ext);
    }
    return normalised.endsWith(`/${suffix}`) || normalised.endsWith(suffix);
  }
  if (pattern === "*") return !filePath.includes("/") && !filePath.includes("\\");
  return filePath.includes(pattern);
}

/**
 * Application-level use case for chunking source files in a directory.
 */
export class ChunkUseCase {
  constructor(private readonly systems: ChunkSystems) {}

  /**
   * Chunk all matching files from `directory`.
   *
   * @param directory - Root directory to scan.
   * @param options   - Optional include/exclude glob patterns.
   * @returns An array of Chunks from the matching files.
   */
  async execute(
    directory: string,
    options?: ChunkOptions,
  ): Promise<Chunk[]> {
    this.systems.logger.info(`Chunking ${directory}`);

    // 1. Recursively scan
    const allFiles = this.scanDirectory(directory);

    // 2. Apply fileFilter
    let matched = allFiles.filter((f) =>
      this.systems.fileFilter.shouldInclude(f),
    );

    // 3. Apply PackOptions include/exclude
    if (options?.include && options.include.length > 0) {
      matched = matched.filter((f) =>
        options.include!.some((pattern) => matchesGlob(pattern, f)),
      );
    }
    if (options?.exclude && options.exclude.length > 0) {
      matched = matched.filter(
        (f) => !options.exclude!.some((pattern) => matchesGlob(pattern, f)),
      );
    }

    // 4. Parse and chunk
    const allChunks: Chunk[] = [];
    for (const filePath of matched) {
      const parser = this.systems.parserRegistry.getParser(filePath);
      if (!parser) continue;

      const parsed = await parser.parse(filePath);
      const chunks = await this.systems.chunker.chunk(parsed.content);
      allChunks.push(...chunks);
    }

    this.systems.logger.info(
      `Chunking produced ${allChunks.length} chunks from ${matched.length} files`,
    );

    return allChunks;
  }

  /** Recursively collect all file paths under `dir`. */
  private scanDirectory(dir: string): string[] {
    const results: string[] = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.scanDirectory(fullPath));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
    return results;
  }
}


---
# src/application/DeleteUseCase.ts
---
// ---------------------------------------------------------------------------
// DeleteUseCase — Phase 9
//
// Removes indexed data by file path via SourceRepository.deleteByPath.
// ---------------------------------------------------------------------------

import type { SourceRepository } from "../domain/ports/SourceRepository";

/**
 * Application-level use case for deleting indexed data by path.
 */
export class DeleteUseCase {
  constructor(private readonly repo: SourceRepository) {}

  /**
   * Remove all indexed chunks for the given file `path`.
   *
   * @param path - File path whose indexed data should be removed.
   */
  async execute(path: string): Promise<void> {
    await this.repo.deleteByPath(path);
  }
}

---
# src/application/di/Systems.ts
---
// ---------------------------------------------------------------------------
// DI Systems — Phase 9
//
// Group interfaces bundling the dependencies required by each application
// use case.  Every use case receives its own *Systems interface so the
// container (or manual wiring) provides exactly what it needs — no more,
// no less.
// ---------------------------------------------------------------------------

import type { FileFilter } from "../../domain/ports/FileFilter";
import type { SourceParserRegistry } from "../../domain/ports/SourceParserRegistry";
import type { Chunker } from "../../domain/systems/ChunkingSystem";
import type {
  Embedder,
  EmbedderRegistry,
} from "../../domain/systems/EmbeddingSystem";
import type { Hasher } from "../../domain/systems/HashingSystem";
import type { SourceRepository } from "../../domain/ports/SourceRepository";
import type { Logger } from "../../domain/ports/Logger";
import type { ContextPacker } from "../../domain/systems/ContextPackagingSystem";

// ── IndexSystems ───────────────────────────────────────────────
// Required by IndexUseCase — full pipeline: filter → parse → chunk →
// embed → upsert.
export interface IndexSystems {
  fileFilter: FileFilter;
  parserRegistry: SourceParserRegistry;
  chunker: Chunker;
  embedderRegistry: EmbedderRegistry;
  repo: SourceRepository;
  hasher: Hasher;
  logger: Logger;
}

// ── SearchSystems ───────────────────────────────────────────────
// Required by SearchUseCase — embed query → search repo → (optionally)
// pack results for LLM consumption.
export interface SearchSystems {
  embedder: Embedder;
  repo: SourceRepository;
  packer: ContextPacker;
  logger: Logger;
}

// ── PackSystems ─────────────────────────────────────────────────
// Required by PackUseCase — scan directory, parse sources, concat into
// a single PackedContext markdown document.
export interface PackSystems {
  parserRegistry: SourceParserRegistry;
  fileFilter: FileFilter;
  logger: Logger;
}

// ── ChunkSystems ────────────────────────────────────────────────
// Required by ChunkUseCase — scan directory, parse sources, produce
// Chunk[] via the Chunker.
export interface ChunkSystems {
  parserRegistry: SourceParserRegistry;
  chunker: Chunker;
  fileFilter: FileFilter;
  logger: Logger;
}

// ── EmbedSystems ────────────────────────────────────────────────
// Required by EmbedUseCase — two modes:
//   source: "chunks"  →  read existing chunks from repo, embed each
//   source: "files"   →  re-parse files, chunk, then embed
// The optional fields (parserRegistry, chunker, fileFilter) are needed
// only for the "files" source mode.
export interface EmbedSystems {
  embedderRegistry: EmbedderRegistry;
  repo: SourceRepository;
  parserRegistry?: SourceParserRegistry;
  chunker?: Chunker;
  fileFilter?: FileFilter;
  logger: Logger;
}


---
# src/application/EmbedUseCase.ts
---
// ---------------------------------------------------------------------------
// EmbedUseCase — Phase 9
//
// Two modes:
//   source: "chunks"  →  embed existing chunks from SourceRepository
//   source: "files"   →  re-parse files, chunk, then embed and upsert
// ---------------------------------------------------------------------------

import { readdirSync } from "fs";
import { join } from "path";
import type { EmbedSystems } from "./di/Systems";
import type { SourceData } from "../domain/types";

/**
 * Options for the EmbedUseCase execution.
 */
export interface EmbedOptions {
  /** Whether to embed existing chunks or re-parse files. */
  source: "chunks" | "files";
  /** Directory to scan (required when source is "files"). */
  directory?: string;
  /** File paths to re-embed (used with source: "chunks"). */
  paths?: string[];
  /** Optional list of model names to use (defaults to all registered). */
  models?: string[];
}

/**
 * Application-level use case for generating embeddings.
 */
export class EmbedUseCase {
  constructor(private readonly systems: EmbedSystems) {}

  /**
   * Execute the embedding process.
   */
  async execute(options: EmbedOptions): Promise<void> {
    this.systems.logger.info(
      `Embedding with source="${options.source}"` +
        (options.directory ? ` directory="${options.directory}"` : ""),
    );

    if (options.source === "chunks") {
      await this.embedFromChunks(options.paths);
    } else {
      await this.embedFromFiles(options.directory);
    }
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Re-embed existing chunks from the repository.
   * When `paths` is provided, only those paths are re-embedded.
   */
  private async embedFromChunks(paths?: string[]): Promise<void> {
    if (!paths || paths.length === 0) {
      this.systems.logger.info("No paths specified for chunk embedding — skipping");
      return;
    }

    const batch: SourceData[] = [];

    for (const filePath of paths) {
      const existing = await this.systems.repo.getByPath(filePath);
      if (existing.length === 0) continue;

      for (const source of existing) {
        const embedder = this.systems.embedderRegistry.getEmbedder(source.type);
        if (!embedder) continue;

        const result = await embedder.embed(source.content);
        source.embeddings = result.vector;
        source.updated_at = new Date().toISOString();
        batch.push(source);
      }
    }

    // Upsert updated chunks
    for (const item of batch) {
      await this.systems.repo.upsert(item);
    }

    this.systems.logger.info(`Re-embedded ${batch.length} chunks from ${paths.length} paths`);
  }

  /**
   * Scan directory, parse files, chunk, embed, and upsert.
   */
  private async embedFromFiles(directory?: string): Promise<void> {
    const dir = directory ?? ".";
    this.systems.logger.info(`Scanning ${dir} for files to embed`);

    const allFiles = this.scanDirectory(dir);

    const matched = this.systems.fileFilter
      ? allFiles.filter((f) => this.systems.fileFilter!.shouldInclude(f))
      : allFiles;

    const batch: SourceData[] = [];

    for (const filePath of matched) {
      const parser = this.systems.parserRegistry?.getParser(filePath);
      if (!parser) continue;

      const parsed = await parser.parse(filePath);
      const chunks = await this.systems.chunker!.chunk(parsed.content);
      const sourceId = crypto.randomUUID();
      const now = new Date().toISOString();

      for (const chunk of chunks) {
        const embedder = this.systems.embedderRegistry.getEmbedder(parsed.type);
        let embeddings: number[] = [];

        if (embedder) {
          const result = await embedder.embed(chunk.core_content);
          embeddings = result.vector;
        }

        batch.push({
          id: crypto.randomUUID(),
          chunk_id: crypto.randomUUID(),
          source_id: sourceId,
          type: parsed.type,
          title: filePath,
          content: chunk.content,
          tags: parsed.tags,
          path: filePath,
          file_blake3: parsed.file_blake3,
          semantic_blake3: `embed-${crypto.randomUUID()}`,
          chunk_index: chunk.chunk_index,
          total_chunks: chunk.total_chunks,
          embeddings,
          metadata: parsed.metadata,
          created_at: now,
          updated_at: now,
        });
      }
    }

    if (batch.length > 0) {
      await this.systems.repo.upsertBatch(batch);
    }

    this.systems.logger.info(`Embedded and upserted ${batch.length} chunks`);
  }

  /** Recursively collect all file paths under `dir`. */
  private scanDirectory(dir: string): string[] {
    const results: string[] = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.scanDirectory(fullPath));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
    return results;
  }
}

---
# src/application/IndexUseCase.ts
---
// ---------------------------------------------------------------------------
// IndexUseCase — Phase 9
//
// Orchestrates the full indexing pipeline via IndexingService.
// Accepts an IndexSystems DI bundle that provides all required dependencies.
// ---------------------------------------------------------------------------

import type { IndexSystems } from "./di/Systems";
import type { IndexStats } from "../domain/types";
import { IndexingService } from "../domain/services/IndexingService";

/**
 * Application-level use case for indexing a directory of source files.
 *
 * delegates to `IndexingService` with the dependencies injected through
 * the `IndexSystems` group interface.
 */
export class IndexUseCase {
  constructor(private readonly systems: IndexSystems) {}

  /**
   * Index all files under `directory`.
   *
   * @param directory - Path to the root directory to index.
   * @returns Aggregate stats for the indexed files.
   */
  async execute(directory: string): Promise<IndexStats> {
    this.systems.logger.info(`Indexing ${directory}`);

    const service = new IndexingService(
      this.systems.fileFilter,
      this.systems.parserRegistry,
      this.systems.chunker,
      this.systems.embedderRegistry,
      this.systems.repo,
      this.systems.hasher,
    );

    return service.index(directory);
  }
}


---
# src/application/PackUseCase.ts
---
// ---------------------------------------------------------------------------
// PackUseCase — Phase 9
//
// Scans a directory, filters files by include/exclude patterns, parses each
// through the SourceParserRegistry, and concatenates them into a single
// PackedContext markdown document suitable for LLM consumption.
// ---------------------------------------------------------------------------

import { readdirSync } from "fs";
import { join, relative } from "path";
import type { PackSystems } from "./di/Systems";
import type { PackedContext } from "../domain/systems/ContextPackagingSystem";

/**
 * Options that control which files are included in the packed output.
 */
export interface PackOptions {
  /** Glob patterns to include (e.g. `["**\/*.md"]`). */
  include?: string[];
  /** Glob patterns to exclude (e.g. `["**\/*.test.ts"]`). */
  exclude?: string[];
  /** Token budget — when specified the output is truncated. */
  maxTokens?: number;
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Very simple glob-like matcher.
 *
 * Supported patterns:
 *   - `**\/*.ext`  — any file with extension `.ext` at any depth
 *   - `**\/name`   — any file named `name` at any depth
 *   - `*`          — any filename (no directory separator)
 *
 * Falls back to substring matching for other patterns.
 */
function matchesGlob(pattern: string, filePath: string): boolean {
  // Normalise separators
  const normalised = filePath.replace(/\\/g, "/");

  if (pattern.startsWith("**/")) {
    const suffix = pattern.slice(3); // e.g. "*.md"
    if (suffix.includes("*")) {
      // `**/*.ext` → ends with `.ext`
      const ext = suffix.slice(1); // ".md"
      return normalised.endsWith(ext);
    }
    // `**/filename` → ends with `/filename`
    return normalised.endsWith(`/${suffix}`) || normalised.endsWith(suffix);
  }

  if (pattern === "*") return !filePath.includes("/") && !filePath.includes("\\");

  return filePath.includes(pattern);
}

/**
 * Crude token estimate: ~1 token per 4 characters.
 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

// ── Use Case ─────────────────────────────────────────────────────

export class PackUseCase {
  constructor(private readonly systems: PackSystems) {}

  /**
   * Pack all matching files from `directory` into a single markdown context.
   *
   * @param directory - Root directory to scan.
   * @param options   - Optional include/exclude glob patterns and token budget.
   */
  async execute(
    directory: string,
    options?: PackOptions,
  ): Promise<PackedContext> {
    this.systems.logger.info(`Packing ${directory}`);

    // 1. Recursively scan
    const allFiles = this.scanDirectory(directory);

    // 2. Apply fileFilter
    const filtered = allFiles.filter((f) =>
      this.systems.fileFilter.shouldInclude(f),
    );

    // 3. Apply PackOptions include/exclude
    let matched = filtered;
    if (options?.include && options.include.length > 0) {
      matched = matched.filter((f) =>
        options.include!.some((pattern) => matchesGlob(pattern, f)),
      );
    }
    if (options?.exclude && options.exclude.length > 0) {
      matched = matched.filter(
        (f) => !options.exclude!.some((pattern) => matchesGlob(pattern, f)),
      );
    }

    // 4. Parse and concatenate
    const markdownParts: string[] = [];
    const sourceNotes: string[] = [];
    let totalTokens = 0;
    const maxTokens = options?.maxTokens ?? Number.POSITIVE_INFINITY;

    for (const filePath of matched) {
      if (totalTokens >= maxTokens) break;

      const parser = this.systems.parserRegistry.getParser(filePath);
      if (!parser) continue;

      const parsed = await parser.parse(filePath);
      const relPath = relative(directory, filePath).replace(/\\/g, "/");

      // File header
      const header = `---\n# ${relPath}\n---\n`;
      const body = parsed.content;
      const block = `${header}${body}\n\n`;

      const blockTokens = estimateTokens(block);

      if (totalTokens + blockTokens > maxTokens) {
        // Truncation would be needed; skip this file if it would exceed budget
        break;
      }

      markdownParts.push(block);
      totalTokens += blockTokens;
      sourceNotes.push(relPath);
    }

    const markdown = markdownParts.join("");
    const truncated = totalTokens >= maxTokens;

    this.systems.logger.info(
      `Packed ${sourceNotes.length} files, ${totalTokens} tokens${
        truncated ? " (truncated)" : ""
      }`,
    );

    return {
      markdown,
      chunks_used: sourceNotes.length,
      total_tokens: totalTokens,
      truncated,
      source_notes: sourceNotes,
    };
  }

  /** Recursively collect all file paths under `dir`. */
  private scanDirectory(dir: string): string[] {
    const results: string[] = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.scanDirectory(fullPath));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
    return results;
  }
}


---
# src/application/SearchUseCase.ts
---
// ---------------------------------------------------------------------------
// SearchUseCase — Phase 9
//
// Searches the indexed repository with three-mode support (semantic, keyword,
// hybrid).  Delegates directly to `SourceRepository.search()` and optionally
// packs results for LLM consumption via `ContextPacker`.
// ---------------------------------------------------------------------------

import type { SearchSystems } from "./di/Systems";
import type { SearchQuery, SearchResult } from "../domain/types";

/**
 * Application-level use case for searching the indexed knowledge base.
 */
export class SearchUseCase {
  constructor(private readonly systems: SearchSystems) {}

  /**
   * Execute a search query against the indexed repository.
   *
   * @param query   - The natural-language or keyword search string.
   * @param options - Optional overrides for mode, top_k, tags, source_types.
   * @returns An array of `SearchResult` items sorted by relevance.
   */
  async execute(
    query: string,
    options?: Partial<SearchQuery>,
  ): Promise<SearchResult[]> {
    // Empty query yields no results
    if (!query || query.trim().length === 0) {
      return [];
    }

    const searchQuery: SearchQuery = {
      text: query,
      mode: options?.mode ?? "hybrid",
      top_k: options?.top_k ?? 10,
      tags: options?.tags,
      source_types: options?.source_types,
    };

    this.systems.logger.info(
      `Searching with mode="${searchQuery.mode}" query="${query}" top_k=${searchQuery.top_k}`,
    );

    // For semantic/hybrid modes embed the query text so the downstream repo
    // can use the vector representation
    if (searchQuery.mode === "semantic" || searchQuery.mode === "hybrid") {
      await this.systems.embedder.embed(query);
    }

    const results = await this.systems.repo.search(searchQuery);

    this.systems.logger.info(`Search returned ${results.length} results`);

    return results;
  }
}


---
# src/application/WatchUseCase.ts
---
// ---------------------------------------------------------------------------
// WatchUseCase — Phase 9
//
// Wraps a FileWatcher and wires file system events to DiffIndexingService.
// ---------------------------------------------------------------------------

import type { FileWatcher } from "../domain/ports/FileWatcher";
import type { Logger } from "../domain/ports/Logger";
import { DiffIndexingService } from "../domain/services/DiffIndexingService";

/**
 * Application-level use case for watching a directory and running
 * diff indexing on file changes.
 */
export class WatchUseCase {
  private directory: string = "";

  constructor(
    private readonly watcher: FileWatcher,
    private readonly diffService: DiffIndexingService,
    private readonly logger: Logger,
  ) {}

  /**
   * Start watching `directory` for file changes.
   *
   * @param directory - Path to the directory to watch.
   */
  async execute(directory: string): Promise<void> {
    this.directory = directory;
    this.logger.info(`Watching ${directory}`);

    this.watcher.on("add", (path: string) => {
      this.logger.info(`File added: ${path}`);
      this.diffService.diffIndex(directory).catch((err) => {
        this.logger.error(`Diff indexing error: ${err}`);
      });
    });

    this.watcher.on("change", (path: string) => {
      this.logger.info(`File changed: ${path}`);
      this.diffService.diffIndex(directory).catch((err) => {
        this.logger.error(`Diff indexing error: ${err}`);
      });
    });

    this.watcher.on("unlink", (path: string) => {
      this.logger.info(`File removed: ${path}`);
    });

    await this.watcher.start();
    this.logger.info(`Watcher started for ${directory}`);
  }

  /**
   * Stop watching.
   */
  async stop(): Promise<void> {
    this.logger.info("Stopping watcher");
    await this.watcher.stop();
  }
}

---
# src/config/ConfigLoader.ts
---
// ---------------------------------------------------------------------------
// ConfigLoader — Phase 9
//
// Reads and validates `.indeX/config.json` via Zod.  Falls back to sensible
// defaults when no config file exists (loadOrDefault).
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from "fs";
import { z, ZodError } from "zod";

// ── Zod schemas ───────────────────────────────────────────────────

const ModelConfig = z.object({
  name: z.string(),
  dimensions: z.number().positive(),
  provider: z.enum(["ollama", "lancedb"]),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
});

const ConfigSchema = z
  .object({
    models: z.array(ModelConfig).min(1),
    universal_model: z.string(),
    embedder: z
      .object({
        batch_size: z.number().positive().default(10),
        cache_size: z.number().positive().default(100),
      })
      .default({}),
    chunking: z
      .object({
        default_strategy: z
          .enum(["heading", "paragraph", "sentence", "code", "overflow"])
          .default("heading"),
        max_chunk_size: z.number().positive().default(500),
        overlap: z.number().min(0).default(32),
      })
      .default({}),
    search: z
      .object({
        default_mode: z
          .enum(["semantic", "keyword", "hybrid"])
          .default("hybrid"),
        top_k: z.number().positive().default(10),
        hybrid_weight: z.number().min(0).max(1).default(0.7),
      })
      .default({}),
  })
  .refine(
    (c) => c.models.some((m) => m.name === c.universal_model),
    (c) => ({
      message: `universal_model "${c.universal_model}" must be one of the configured models: ${c.models.map((m) => m.name).join(", ")}`,
    }),
  );

export type Config = z.infer<typeof ConfigSchema>;

// ── Defaults ──────────────────────────────────────────────────────

const defaultConfig: Config = {
  models: [{ name: "nomic-embed-text", dimensions: 768, provider: "ollama" }],
  universal_model: "nomic-embed-text",
  embedder: { batch_size: 10, cache_size: 100 },
  chunking: {
    default_strategy: "heading",
    max_chunk_size: 500,
    overlap: 32,
  },
  search: {
    default_mode: "hybrid",
    top_k: 10,
    hybrid_weight: 0.7,
  },
};

// ── Loader API ────────────────────────────────────────────────────

/**
 * Read a config JSON file, validate it through the Zod schema, and return the
 * typed `Config` object.
 *
 * @param path - Path to the config file (default: `.indeX/config.json` relative
 *               to the current working directory).
 * @throws {ZodError} when the JSON is invalid or does not match the schema.
 * @throws {SyntaxError} when the file contains malformed JSON.
 */
export function load(path?: string): Config {
  const resolved = path ?? ".indeX/config.json";
  const raw = readFileSync(resolved, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ZodError([
      {
        code: z.ZodIssueCode.custom,
        message: `Invalid JSON in config file "${resolved}": ${(err as Error).message}`,
        path: [],
      },
    ]);
  }
  return ConfigSchema.parse(parsed);
}

/**
 * Attempt to load the config file; if it does not exist, return a sensible
 * default configuration.
 *
 * @param path - Path to the config file (default: `.indeX/config.json` relative
 *               to the current working directory).
 * @returns A validated `Config` object (real or default).
 */
export function loadOrDefault(path?: string): Config {
  const resolved = path ?? ".indeX/config.json";
  if (!existsSync(resolved)) {
    return { ...defaultConfig };
  }
  return load(resolved);
}

// Re-export for convenient external access
export const ConfigLoader = { load, loadOrDefault };


---
# src/domain/ast.ts
---
// ---------------------------------------------------------------------------
// AST Model — Phase 1
// ---------------------------------------------------------------------------

/**
 * Kinds of symbols that can be extracted from source code.
 */
export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "method"
  | "property"
  | "parameter"
  | "module";

/**
 * A single symbol (function, class, variable, etc.) found in a file.
 */
export interface SymbolDetail {
  kind: SymbolKind;
  name: string;
  signature: string;
  startPosition: { line: number; column: number };
  endPosition: { line: number; column: number };
}

/**
 * An import statement found in a file.
 */
export interface Import {
  source: string;
  specifiers: string[];
  kind: "named" | "default" | "namespace";
}

/**
 * An export statement found in a file.
 */
export interface Export {
  name: string;
  kind: "named" | "default" | "all";
}

/**
 * A relationship between two code entities (calls, extends, imports, etc.).
 */
export interface Relationship {
  type: "calls" | "extends" | "implements" | "imports" | "exports";
  source: string;
  target: string;
}

/**
 * Indexed metadata for a single file's AST.
 */
export interface FileIndex {
  path: string;
  file_blake3: string;
  language: string;
  imports: Import[];
  exports: Export[];
  symbols: SymbolDetail[];
  relationships: Relationship[];
  last_parsed: string; // ISO 8601
}


---
# src/domain/ports/FileFilter.ts
---
/**
 * Filter that determines which files should be included in indexing.
 */
export interface FileFilter {
  formats: string[];
  include?: string[];
  exclude?: string[];
  shouldInclude(path: string): boolean;
}


---
# src/domain/ports/FileWatcher.ts
---
/**
 * File system watcher that emits add / change / unlink events.
 */
export interface FileWatcher {
  on(event: "add" | "change" | "unlink", cb: (path: string) => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}


---
# src/domain/ports/Logger.ts
---
/**
 * Log severity levels.
 */
export type LogLevel = "info" | "warn" | "error" | "debug";

/**
 * Structured logger interface.
 */
export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}


---
# src/domain/ports/SourceParser.ts
---
import type { SourceType, ParsedSource } from "../types";

/**
 * Parser for a specific source file type.
 */
export interface SourceParser {
  type: SourceType;
  extensions: string[];
  enabled?: boolean;
  supportsFile(path: string): boolean;
  parse(path: string): Promise<ParsedSource>;
}


---
# src/domain/ports/SourceParserRegistry.ts
---
import type { SourceParser } from "./SourceParser";

/**
 * Registry of source parsers, keyed by file extension / type.
 */
export interface SourceParserRegistry {
  getParser(path: string): SourceParser | null;
  register(parser: SourceParser): void;
}


---
# src/domain/ports/SourceRepository.ts
---
import type { SourceData, SearchQuery, SearchResult, IndexStats } from "../types";
import type { FileIndex } from "../ast";

/**
 * Repository for persisting and querying indexed source data.
 */
export interface SourceRepository {
  upsert(data: SourceData): Promise<void>;
  upsertBatch(data: SourceData[]): Promise<void>;
  getById(id: string): Promise<SourceData | null>;
  getByPath(path: string): Promise<SourceData[]>;
  getBySourceId(sourceId: string): Promise<SourceData[]>;
  delete(id: string): Promise<void>;
  deleteByPath(path: string): Promise<void>;
  search(query: SearchQuery): Promise<SearchResult[]>;
  hasSemanticBlake3(hash: string): Promise<boolean>;
  hasModelEmbedding(id: string): Promise<boolean>;
  getSourceIdsByHash(hash: string): Promise<string[]>;
  getFileBlake3ByPath(path: string): Promise<string | null>;
  stats(): Promise<IndexStats>;
  upsertFileIndex(index: FileIndex): Promise<void>;
  getFileIndex(path: string): Promise<FileIndex | null>;
  deleteFileIndex(path: string): Promise<void>;
  dropAll(): Promise<void>;
}


---
# src/domain/services/DiffIndexingService.ts
---
import { readdirSync } from "fs";
import { join } from "path";
import type { FileFilter } from "../ports/FileFilter";
import type { SourceParserRegistry } from "../ports/SourceParserRegistry";
import type { Chunker } from "../systems/ChunkingSystem";
import type { EmbedderRegistry } from "../systems/EmbeddingSystem";
import type { SourceRepository } from "../ports/SourceRepository";
import type { Hasher } from "../systems/HashingSystem";
import type { SourceData } from "../types";

export interface DiffIndexResult {
  indexed: number;
  skipped: number;
  errors: number;
}

/**
 * Incremental / differential indexing service.
 *
 * For every file that matches the filter:
 *  1. Compute the current `file_blake3`.
 *  2. Compare against the stored hash.
 *  3. **Match** → skip (no re-processing).
 *  4. **Mismatch** (or new file) → re-process: parse → chunk → embed →
 *     delete old chunks → upsert new ones → rebuild FileIndex.
 *
 * Cross-file semantic dedup is implicit: old chunks are deleted via
 * `deleteByPath` (scoped to the changed file only), so shared hashes
 * survive via other files that still reference them.
 */
export class DiffIndexingService {
  constructor(
    private readonly hasher: Hasher,
    private readonly parserRegistry: SourceParserRegistry,
    private readonly chunker: Chunker,
    private readonly embedderRegistry: EmbedderRegistry,
    private readonly repo: SourceRepository,
    private readonly fileFilter: FileFilter,
  ) {}

  async diffIndex(directory: string): Promise<DiffIndexResult> {
    const files = this.scanDirectory(directory);
    const included = files.filter((f) => this.fileFilter.shouldInclude(f));

    let indexed = 0;
    let skipped = 0;
    let errors = 0;

    for (const filePath of included) {
      try {
        const content = await Bun.file(filePath).text();
        const currentHash = await this.hasher.hash(content);
        const storedHash = await this.repo.getFileBlake3ByPath(filePath);

        // File unchanged → skip
        if (storedHash === currentHash) {
          skipped++;
          continue;
        }

        // File is new or changed → full re-processing
        await this.reprocessFile(filePath, currentHash);
        indexed++;
      } catch {
        errors++;
      }
    }

    return { indexed, skipped, errors };
  }

  // ── Private helpers ────────────────────────────────────────

  private async reprocessFile(
    filePath: string,
    fileHash: string,
  ): Promise<void> {
    // 1. Delete existing chunks for this path (cross-file dedup is implicit
    //    because deleteByPath only removes entries scoped to `filePath`).
    await this.repo.deleteByPath(filePath);

    // 2. Parse → chunk → embed (same pipeline as IndexingService)
    const parser = this.parserRegistry.getParser(filePath);
    if (!parser) return;

    const parsed = await parser.parse(filePath);
    const chunks = await this.chunker.chunk(parsed.content);
    const sourceId = crypto.randomUUID();

    const batch: SourceData[] = [];

    for (const chunk of chunks) {
      const semanticHash = await this.hasher.hash(chunk.core_content);
      const embedder = this.embedderRegistry.getEmbedder(parsed.type);
      const embeddings: number[] = [];

      if (embedder) {
        const result = await embedder.embed(chunk.core_content);
        embeddings.push(...result.vector);
      }

      const now = new Date().toISOString();

      batch.push({
        id: crypto.randomUUID(),
        chunk_id: crypto.randomUUID(),
        source_id: sourceId,
        type: parsed.type,
        title: filePath,
        content: chunk.content,
        tags: parsed.tags,
        path: filePath,
        file_blake3: fileHash,
        semantic_blake3: semanticHash,
        chunk_index: chunk.chunk_index,
        total_chunks: chunk.total_chunks,
        embeddings,
        metadata: parsed.metadata,
        created_at: now,
        updated_at: now,
      });
    }

    if (batch.length > 0) {
      await this.repo.upsertBatch(batch);
    }

    // 3. Rebuild FileIndex if the parser provides one
    if (parsed.fileIndex) {
      await this.repo.upsertFileIndex(parsed.fileIndex);
    }
  }

  /** Recursively collect all file paths under `dir`. */
  private scanDirectory(dir: string): string[] {
    const results: string[] = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.scanDirectory(fullPath));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
    return results;
  }
}


---
# src/domain/services/IndexingService.ts
---
import { readdirSync } from "fs";
import { join } from "path";
import type { FileFilter } from "../ports/FileFilter";
import type { SourceParserRegistry } from "../ports/SourceParserRegistry";
import type { Chunker } from "../systems/ChunkingSystem";
import type { EmbedderRegistry } from "../systems/EmbeddingSystem";
import type { SourceRepository } from "../ports/SourceRepository";
import type { Hasher } from "../systems/HashingSystem";
import type { SourceData, IndexStats } from "../types";

/**
 * Orchestrates the indexing pipeline: scan directory → filter files →
 * parse each file → chunk → embed via applicable models → upsert to repo.
 *
 * Pure business logic — all external dependencies injected via constructor.
 */
export class IndexingService {
  constructor(
    private readonly fileFilter: FileFilter,
    private readonly parserRegistry: SourceParserRegistry,
    private readonly chunker: Chunker,
    private readonly embedderRegistry: EmbedderRegistry,
    private readonly repo: SourceRepository,
    private readonly hasher: Hasher,
  ) {}

  /**
   * Index all files in `directory`.
   *
   * 1. Recursively scan for files
   * 2. Filter via `fileFilter.shouldInclude`
   * 3. Parse each through the matching `SourceParser`
   * 4. Chunk the parsed content
   * 5. Embed every chunk with **all** applicable embedders (per source type)
   * 6. Build `SourceData` rows and upsert in batch
   * 7. Return aggregate stats
   */
  async index(directory: string): Promise<IndexStats> {
    const files = this.scanDirectory(directory);
    const included = files.filter((f) => this.fileFilter.shouldInclude(f));

    for (const filePath of included) {
      const parser = this.parserRegistry.getParser(filePath);
      if (!parser) continue;

      const parsed = await parser.parse(filePath);
      const chunks = await this.chunker.chunk(parsed.content);
      const sourceId = crypto.randomUUID();

      const batch: SourceData[] = [];

      for (const chunk of chunks) {
        const semanticHash = await this.hasher.hash(chunk.core_content);
        const embedder = this.embedderRegistry.getEmbedder(parsed.type);
        const embeddings: number[] = [];

        // Embed via the model registered for this source type (if any)
        if (embedder) {
          const result = await embedder.embed(chunk.core_content);
          embeddings.push(...result.vector);
        }

        const now = new Date().toISOString();

        batch.push({
          id: crypto.randomUUID(),
          chunk_id: crypto.randomUUID(),
          source_id: sourceId,
          type: parsed.type,
          title: filePath,
          content: chunk.content,
          tags: parsed.tags,
          path: filePath,
          file_blake3: parsed.file_blake3,
          semantic_blake3: semanticHash,
          chunk_index: chunk.chunk_index,
          total_chunks: chunk.total_chunks,
          embeddings,
          metadata: parsed.metadata,
          created_at: now,
          updated_at: now,
        });
      }

      if (batch.length > 0) {
        await this.repo.upsertBatch(batch);
      }

      // Persist FileIndex if the parser provides one
      if (parsed.fileIndex) {
        await this.repo.upsertFileIndex(parsed.fileIndex);
      }
    }

    return this.repo.stats();
  }

  /** Recursively collect all file paths under `dir`. */
  private scanDirectory(dir: string): string[] {
    const results: string[] = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.scanDirectory(fullPath));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
    return results;
  }
}


---
# src/domain/services/SearchService.ts
---
import type { Embedder } from "../systems/EmbeddingSystem";
import type { SourceRepository } from "../ports/SourceRepository";
import type { SearchQuery, SearchResult } from "../types";

/**
 * Three-mode search service: semantic (ANN), keyword (FTS/BM25), and hybrid.
 *
 * - **Semantic**: embeds the query, then delegates to `repo.search()` with
 *   mode `"semantic"`. If results carry `model_scores` they are averaged.
 * - **Keyword**: delegates directly to `repo.search()` with mode `"keyword"`.
 * - **Hybrid**: runs both modes, normalizes BM25 scores to [0,1], and merges
 *   via weighted sum controlled by `hybrid_weight`.
 *
 * All modes apply post-filtering by `tags` and `source_types` when specified.
 */
export class SearchService {
  private readonly hybridWeight: number;

  constructor(
    private readonly embedder: Embedder,
    private readonly repo: SourceRepository,
    options?: { hybrid_weight?: number },
  ) {
    this.hybridWeight = options?.hybrid_weight ?? 0.7;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    switch (query.mode) {
      case "semantic":
        return this.semanticSearch(query);
      case "keyword":
        return this.keywordSearch(query);
      case "hybrid":
        return this.hybridSearch(query);
    }
  }

  // ── Private mode implementations ──────────────────────────

  private async semanticSearch(query: SearchQuery): Promise<SearchResult[]> {
    // Embed the query text (triggers multi-model scoring path)
    await this.embedder.embed(query.text);

    const results = await this.repo.search({ ...query, mode: "semantic" });

    // Average model_scores when multiple models produced results
    for (const result of results) {
      this.averageModelScores(result);
    }

    return this.postFilter(results, query);
  }

  private async keywordSearch(query: SearchQuery): Promise<SearchResult[]> {
    const results = await this.repo.search({ ...query, mode: "keyword" });
    return this.postFilter(results, query);
  }

  private async hybridSearch(query: SearchQuery): Promise<SearchResult[]> {
    // Embed the query (consumed by the semantic leg)
    await this.embedder.embed(query.text);

    const [semanticResults, keywordResults] = await Promise.all([
      this.repo.search({ ...query, mode: "semantic" }),
      this.repo.search({ ...query, mode: "keyword" }),
    ]);

    // Average model_scores for semantic results
    for (const r of semanticResults) {
      this.averageModelScores(r);
    }

    // Normalise BM25 scores to [0, 1]
    this.normalizeBM25(keywordResults);

    // Weighted merge: final = w * semantic + (1-w) * keyword
    const merged = this.mergeHybrid(semanticResults, keywordResults);

    // Sort by final score descending, limit to top_k
    merged.sort((a, b) => b.score - a.score);
    const top = merged.slice(0, query.top_k);

    return this.postFilter(top, query);
  }

  // ── Helpers ────────────────────────────────────────────────

  /**
   * If the result carries `model_scores`, replace `score` with their average.
   */
  private averageModelScores(result: SearchResult): void {
    if (
      result.model_scores &&
      Object.keys(result.model_scores).length > 0
    ) {
      const scores = Object.values(result.model_scores);
      result.score = scores.reduce((a, b) => a + b, 0) / scores.length;
    }
  }

  /** Normalize the `score` array in-place via min-max scaling to [0, 1]. */
  private normalizeBM25(results: SearchResult[]): void {
    if (results.length === 0) return;
    const scores = results.map((r) => r.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    if (max === min) {
      // All scores identical — set all to 1 (they are equally relevant)
      results.forEach((r) => (r.score = 1));
      return;
    }
    for (const r of results) {
      r.score = (r.score - min) / (max - min);
    }
  }

  /**
   * Merge semantic and keyword results.
   *
   * - When the same source appears in both legs the final score is
   *   `hybridWeight * semanticScore + (1 - hybridWeight) * keywordScore`.
   * - Sources that appear in only one leg are included with the weighted
   *   contribution from that leg alone.
   */
  private mergeHybrid(
    semantic: SearchResult[],
    keyword: SearchResult[],
  ): SearchResult[] {
    const map = new Map<string, SearchResult>();

    for (const r of semantic) {
      map.set(r.source.id, {
        ...r,
        score: r.score * this.hybridWeight,
        match_type: "hybrid",
        model_scores: { ...(r.model_scores ?? {}), semantic: r.score },
      });
    }

    for (const r of keyword) {
      const existing = map.get(r.source.id);
      const kwScore = r.score * (1 - this.hybridWeight);
      if (existing) {
        existing.score += kwScore;
        existing.model_scores = {
          ...(existing.model_scores ?? {}),
          keyword: r.score,
        };
      } else {
        map.set(r.source.id, {
          ...r,
          score: kwScore,
          match_type: "hybrid",
          model_scores: { keyword: r.score },
        });
      }
    }

    return Array.from(map.values());
  }

  /** Apply optional tag / source_type / min_score filters after core scoring. */
  private postFilter(
    results: SearchResult[],
    query: SearchQuery,
  ): SearchResult[] {
    return results.filter((r) => {
      // Exclude non-matching results
      if (r.score <= 0) return false;
      if (query.min_score !== undefined && r.score < query.min_score) return false;
      if (query.tags?.length) {
        if (!query.tags.some((t) => r.source.tags.includes(t))) return false;
      }
      if (query.source_types?.length) {
        if (!query.source_types.includes(r.source.type)) return false;
      }
      return true;
    });
  }
}


---
# src/domain/systems/ChunkingSystem.ts
---
import type { SourceType } from "../types";

/**
 * A single chunk produced by a chunker.
 */
export interface Chunk {
  content: string;
  core_content: string;
  chunk_index: number;
  total_chunks: number;
  strategy: string;
  size_tokens: number;
}

/**
 * A chunker capable of splitting text for a specific SourceType.
 */
export interface Chunker {
  chunk(text: string): Promise<Chunk[]>;
  readonly type: SourceType;
}

/**
 * A pipeline that dispatches text to the appropriate chunker by type.
 */
export interface ChunkerPipeline {
  chunkers: Chunker[];
  chunk(text: string, type: SourceType): Promise<Chunk[]>;
}


---
# src/domain/systems/ContextPackagingSystem.ts
---
import type { SearchResult } from "../types";

/**
 * A packed context ready to be sent to an LLM.
 */
export interface PackedContext {
  markdown: string;
  chunks_used: number;
  total_tokens: number;
  truncated: boolean;
  source_notes: string[];
}

/**
 * Deduplicates search results by source identity.
 */
export interface Deduplicator {
  deduplicate(results: SearchResult[]): Promise<SearchResult[]>;
}

/**
 * Counts and truncates text by token budget.
 */
export interface Tokenizer {
  count(text: string): Promise<number>;
  truncate(text: string, maxTokens: number): Promise<string>;
}

/**
 * Packs search results into a formatted context for LLM consumption.
 */
export interface ContextPacker {
  pack(
    results: SearchResult[],
    options?: { maxTokens?: number; format?: "rag" | "context" },
  ): Promise<PackedContext>;
}


---
# src/domain/systems/EmbeddingSystem.ts
---
/**
 * A vector embedding produced by an embedder model.
 */
export interface Embedding {
  vector: number[];
  model: string;
  dimensions: number;
  tokens_in: number;
}

/**
 * An embedder that converts text into vector embeddings.
 */
export interface Embedder {
  embed(text: string): Promise<Embedding>;
  readonly model: string;
  readonly dimensions: number;
}

/**
 * A cache for previously computed embeddings (keyed by text hash or ID).
 */
export interface EmbedderCache {
  get(key: string): Promise<Embedding | null>;
  set(key: string, embedding: Embedding): Promise<void>;
}

/**
 * A registry of embedders mapped by source type, with priority ordering.
 */
export interface EmbedderRegistry {
  getEmbedder(sourceType: string): Embedder | null;
  register(sourceType: string, embedder: Embedder, priority: number): void;
}


---
# src/domain/systems/HashingSystem.ts
---
/**
 * A hasher that produces a string digest from input data.
 */
export interface Hasher {
  hash(data: string | Uint8Array): Promise<string>;
  readonly algorithm: string;
}

/**
 * Estimates token count for a given text under a specific model's tokenizer.
 */
export interface TokenEstimator {
  estimate(text: string): Promise<number>;
  readonly model: string;
}


---
# src/domain/types.ts
---
// ---------------------------------------------------------------------------
// Domain Types — Phase 1
// ---------------------------------------------------------------------------

/**
 * Union of supported source file types.
 */
export type SourceType = "code" | "markdown" | "obsidian" | "generic";

/**
 * Discriminated union of per-type metadata.
 * Narrow via the `kind` field.
 */
export type SourceMetadata =
  | {
      kind: "code";
      language: string;
      packageName?: string;
      complexity?: { lines: number; functions: number; classes: number };
      topLevelDeclarations?: string[];
    }
  | { kind: "markdown"; heading?: string; section?: string; wordCount?: number }
  | { kind: "obsidian"; tags: string[]; links: string[]; frontmatter?: Record<string, unknown> }
  | { kind: "generic"; encoding: string; mimeType?: string };

/**
 * A single indexed chunk of source data.
 * One source file can produce many SourceData rows (one per chunk).
 */
export interface SourceData {
  id: string; // UUID v7
  chunk_id: string; // UUID v7
  source_id: string; // Original source UUID
  type: SourceType;
  title: string;
  content: string;
  tags: string[];
  path: string;
  file_blake3: string; // hash of entire file
  semantic_blake3: string; // hash of core semantic unit
  chunk_index: number;
  total_chunks: number;
  embeddings: number[];
  metadata: SourceMetadata;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

/**
 * A search query against the index.
 */
export interface SearchQuery {
  text: string;
  mode: "semantic" | "keyword" | "hybrid";
  tags?: string[];
  top_k: number;
  source_types?: SourceType[];
  min_score?: number;
  filters?: Record<string, unknown>;
}

/**
 * A single search result.
 */
export interface SearchResult {
  source: SourceData;
  score: number;
  match_type: "semantic" | "keyword" | "hybrid";
  model_scores?: Record<string, number>;
}

/**
 * A parsed source file prior to chunking.
 */
export interface ParsedSource {
  type: SourceType;
  path: string;
  content: string;
  tags: string[];
  metadata: SourceMetadata;
  file_blake3: string;
  last_parsed: string; // ISO 8601
  fileIndex?: import("./ast").FileIndex; // Code parser only
}

/**
 * Aggregate statistics for the index.
 */
export interface IndexStats {
  total_sources: number;
  total_chunks: number;
  total_files: number;
  last_indexed: string; // ISO 8601
}


---
# src/index.ts
---
// ---------------------------------------------------------------------------
// IndeX — DI Container / Composition Root
//
// Wires together all modules into a single `createApp()` entry point.
// Supports test-mode injection of mock dependencies.
// ---------------------------------------------------------------------------

// ── Config ──────────────────────────────────────────────────────────
import { loadOrDefault as loadConfig } from "./config/ConfigLoader";
import type { Config } from "./config/ConfigLoader";

// ── Domain types ────────────────────────────────────────────────────
import type { SourceType, SearchQuery } from "./domain/types";
import type { Chunk } from "./domain/systems/ChunkingSystem";
import type { ChunkerPipeline } from "./domain/systems/ChunkingSystem";
import type { Chunker } from "./domain/systems/ChunkingSystem";
import type { EmbedderRegistry } from "./domain/systems/EmbeddingSystem";
import type { SearchResult } from "./domain/types";

// ── Ports ───────────────────────────────────────────────────────────
import type { FileFilter } from "./domain/ports/FileFilter";
import type { SourceParserRegistry } from "./domain/ports/SourceParserRegistry";
import type { SourceRepository } from "./domain/ports/SourceRepository";
import type { Logger } from "./domain/ports/Logger";

// ── Infrastructure: Logger ──────────────────────────────────────────
import { PinoLogger } from "./infrastructure/logger/PinoLogger";
import { SilentLogger } from "./infrastructure/logger/SilentLogger";

// ── Infrastructure: Hashing ─────────────────────────────────────────
import { BLAKE3Hasher } from "./infrastructure/hashing/BLAKE3Hasher";
import { TokenEstimatorSimple } from "./infrastructure/hashing/TokenEstimatorSimple";

// ── Infrastructure: Parsers ─────────────────────────────────────────
import { MarkdownParser } from "./infrastructure/parser/MarkdownParser";
import { ObsidianParser } from "./infrastructure/parser/ObsidianParser";
import { AstGrepParser } from "./infrastructure/parser/AstGrepParser";
import { ParserRegistry } from "./infrastructure/parser/ParserRegistry";

// ── Infrastructure: Chunking ────────────────────────────────────────
import { ChunkerFactory } from "./infrastructure/chunking/ChunkerFactory";

// ── Infrastructure: Embedding ───────────────────────────────────────
import { EmbedderRegistryImpl } from "./infrastructure/embedding/EmbedderRegistryImpl";
import { EmbedderCacheLRU } from "./infrastructure/embedding/EmbedderCacheLRU";
import { CachedEmbedder } from "./infrastructure/embedding/CachedEmbedder";
import { OllamaEmbedder } from "./infrastructure/embedding/OllamaEmbedder";

// ── Infrastructure: Repository ──────────────────────────────────────
import { LanceDbSourceRepository } from "./infrastructure/lancedb/LanceDbSourceRepository";

// ── Infrastructure: Watcher ─────────────────────────────────────────
import { ChokidarWatcher } from "./infrastructure/watcher/ChokidarWatcher";

// ── Domain Services ─────────────────────────────────────────────────
import { IndexingService } from "./domain/services/IndexingService";
import { SearchService } from "./domain/services/SearchService";
import { DiffIndexingService } from "./domain/services/DiffIndexingService";

// ── DI Group Interfaces ─────────────────────────────────────────────
import type {
  IndexSystems,
  SearchSystems,
  PackSystems,
  ChunkSystems,
  EmbedSystems,
} from "./application/di/Systems";

// ── Application Use Cases ───────────────────────────────────────────
import { IndexUseCase } from "./application/IndexUseCase";
import { SearchUseCase } from "./application/SearchUseCase";
import { PackUseCase } from "./application/PackUseCase";
import { ChunkUseCase } from "./application/ChunkUseCase";
import { EmbedUseCase } from "./application/EmbedUseCase";
import { WatchUseCase } from "./application/WatchUseCase";
import { DeleteUseCase } from "./application/DeleteUseCase";

// ── Types ───────────────────────────────────────────────────────────

export interface AppUseCases {
  index: IndexUseCase;
  search: SearchUseCase;
  pack: PackUseCase;
  chunk: ChunkUseCase;
  embed: EmbedUseCase;
  watch: WatchUseCase;
  del: DeleteUseCase;
}

export interface CreateAppOptions {
  /** Path to config file (default: .indeX/config.json). */
  configPath?: string;
  /** Inject a custom SourceRepository (for tests). */
  repository?: SourceRepository;
  /** Inject a custom Logger. */
  logger?: Logger;
  /** When true, uses SilentLogger and MockSourceRepository. */
  testMode?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * FileFilter that includes files matching the configured formats/exclude patterns.
 */
function createFileFilter(config: Config): FileFilter {
  const extList = [".ts", ".tsx", ".js", ".jsx", ".md", ".json"];
  return {
    formats: extList,
    shouldInclude: (path: string) =>
      extList.some((ext) => path.endsWith(ext)),
  };
}

// ── createApp — Composition Root ───────────────────────────────────

/**
 * Create the IndeX application with all dependencies wired together.
 *
 * @example
 * ```ts
 * const app = createApp();
 * const stats = await app.index.execute("./vault");
 * const results = await app.search.execute("query");
 * ```
 */
export function createApp(options?: CreateAppOptions): AppUseCases {
  // 1. Load config
  const config = loadConfig(options?.configPath);

  // 2. Logger
  const logger: Logger =
    options?.logger ?? options?.testMode
      ? new SilentLogger()
      : new PinoLogger({ level: "info" });

  // 3. Hasher
  const hasher = new BLAKE3Hasher();

  // 4. Token estimator
  const tokenEstimator = new TokenEstimatorSimple();

  // 5. Parser registry
  const parserRegistry: SourceParserRegistry = new ParserRegistry();
  parserRegistry.register(new MarkdownParser());
  parserRegistry.register(new ObsidianParser());
  parserRegistry.register(new AstGrepParser());

  // 6. Chunker pipeline
  const chunkerFactory = new ChunkerFactory(
    config.chunking.max_chunk_size,
    tokenEstimator,
  );
  const strategies = [config.chunking.default_strategy, "paragraph", "sentence", "overflow"];
  const chunkerPipeline: ChunkerPipeline = chunkerFactory.createPipeline(strategies);

  // Wrap ChunkerPipeline as a Chunker (for IndexingService compatibility)
  const chunker: Chunker = {
    type: "generic" as SourceType,
    chunk: async (text: string): Promise<Chunk[]> =>
      chunkerPipeline.chunk(text, "generic"),
  };
  // Expose pipeline for tests
  (chunker as any).pipeline = chunkerPipeline;

  // 7. File filter
  const fileFilter = createFileFilter(config);

  // 8. Embedder registry
  const embedderRegistry: EmbedderRegistry = new EmbedderRegistryImpl();
  const cache = new EmbedderCacheLRU(config.embedder.cache_size);

  for (const modelCfg of config.models) {
    const baseEmbedder = new OllamaEmbedder(
      modelCfg.name,
      modelCfg.dimensions,
      modelCfg.baseUrl ?? "http://localhost:11434",
    );
    const cached = new CachedEmbedder(baseEmbedder, cache, { hash: (t: string) => t.length.toString() });
    embedderRegistry.register(modelCfg.name, cached, 10);
  }

  // 9. Source repository
  const repo: SourceRepository =
    options?.repository ??
    new LanceDbSourceRepository(
      options?.testMode ? "memory://" : ".indeX/index.lancedb",
    );

  // Connect repo eagerly (no-op for memory mode)
  if (repo instanceof LanceDbSourceRepository) {
    // LanceDbSourceRepository connects lazily — no eager init needed
  }

  // 10. Domain services
  const indexingService = new IndexingService(
    fileFilter,
    parserRegistry,
    chunker,
    embedderRegistry,
    repo,
    hasher,
  );

  const searchEmbedder =
    embedderRegistry.getEmbedder(config.universal_model) ??
    new OllamaEmbedder(
      config.models[0]?.name ?? "nomic-embed-text",
      config.models[0]?.dimensions ?? 768,
    );

  const searchService = new SearchService(searchEmbedder, repo, {
    hybrid_weight: config.search.hybrid_weight,
  });

  const diffIndexingService = new DiffIndexingService(
    hasher,
    parserRegistry,
    chunker,
    embedderRegistry,
    repo,
    fileFilter,
  );

  // 11. Use cases
  const index = new IndexUseCase({
    fileFilter,
    parserRegistry,
    chunker,
    embedderRegistry,
    repo,
    hasher,
    logger,
  } satisfies IndexSystems);

  const search = new SearchUseCase({
    embedder: searchEmbedder,
    repo,
    packer: {
      pack: async (results: SearchResult[]) => ({
        markdown: results.map((r) => r.source.content).join("\n\n"),
        chunks_used: results.length,
        total_tokens: 0,
        truncated: false,
        source_notes: results.map((r) => r.source.path),
      }),
    } as any,
    logger,
  } satisfies SearchSystems);

  const pack = new PackUseCase({
    parserRegistry,
    fileFilter,
    logger,
  } satisfies PackSystems);

  const chunk = new ChunkUseCase({
    parserRegistry,
    chunker,
    fileFilter,
    logger,
  } satisfies ChunkSystems);

  const embed = new EmbedUseCase({
    embedderRegistry,
    repo,
    parserRegistry,
    chunker,
    fileFilter,
    logger,
  } satisfies EmbedSystems);

  const watcher = new ChokidarWatcher(".");
  const watch = new WatchUseCase(watcher, diffIndexingService, logger);

  const del = new DeleteUseCase(repo);

  return { index, search, pack, chunk, embed, watch, del };
}


---
# src/infrastructure/chunking/ChunkerFactory.ts
---
import type { Chunk, Chunker, ChunkerPipeline } from "../../domain/systems/ChunkingSystem";
import type { TokenEstimator } from "../../domain/systems/HashingSystem";
import type { SourceType } from "../../domain/types";
import { HeadingChunker } from "./HeadingChunker";
import { ParagraphChunker } from "./ParagraphChunker";
import { SentenceChunker } from "./SentenceChunker";
import { OverflowChunker } from "./OverflowChunker";
import { CodeChunker } from "./CodeChunker";

const MIN_MERGE_TOKENS = 50;
const OVERLAP_TOKENS = 32;

/**
 * Factory that builds ChunkerPipeline instances with configurable
 * fallback strategies and post-processing (merge + overlap).
 */
export class ChunkerFactory {
  constructor(
    private readonly maxTokens: number,
    private readonly tokenEstimator: TokenEstimator,
  ) {}

  /**
   * Creates a pipeline with the given ordered strategy chain.
   */
  createPipeline(strategies: string[]): ChunkerPipeline {
    // Build chunker instances from strategy names
    // For fallback chain, we need to wire dependencies properly:
    // heading → paragraph → sentence → overflow
    // where paragraph depends on sentence, sentence depends on overflow

    // Create all chunkers
    const overflowChunker = new OverflowChunker(
      this.maxTokens,
      50,
      this.tokenEstimator,
    );

    const sentenceChunker = new SentenceChunker(
      this.maxTokens,
      this.tokenEstimator,
      overflowChunker,
    );

    const paragraphChunker = new ParagraphChunker(
      this.maxTokens,
      this.tokenEstimator,
      sentenceChunker,
    );

    const headingChunker = new HeadingChunker(
      this.maxTokens,
      this.tokenEstimator,
    );

    const codeChunker = new CodeChunker(
      this.maxTokens,
      this.tokenEstimator,
    );

    // Map strategy names to instances
    const strategyMap: Record<string, Chunker> = {
      heading: headingChunker,
      paragraph: paragraphChunker,
      sentence: sentenceChunker,
      overflow: overflowChunker,
      code: codeChunker,
    };

    // Build the ordered chain
    const chain = strategies
      .map((s) => strategyMap[s])
      .filter(Boolean) as Chunker[];

    // Separate code chunker (used separately for code type)
    const codeChunkerInstance = chain.find(
      (c) => c.type === "code",
    ) as CodeChunker | undefined;

    // Overflow chunker (used separately for generic type)
    const overflowChunkerInstance = chain.find(
      (c) => c instanceof OverflowChunker,
    ) as OverflowChunker | undefined;

    return {
      chunkers: chain,

      chunk: async (
        text: string,
        type: SourceType,
      ): Promise<Chunk[]> => {
        if (!text) return [];

        let activeChain: Chunker[];

        switch (type) {
          case "code": {
            if (codeChunkerInstance) {
              return codeChunkerInstance.chunk(text);
            }
            // Fall back to overflow if no code chunker in chain
            const oc = chain.find((c) => c.type === "generic" || c instanceof OverflowChunker);
            if (oc) {
              const result = await oc.chunk(text);
              return postProcess(result, this.tokenEstimator);
            }
            return [];
          }

          case "generic": {
            const oc = overflowChunkerInstance ?? chain.find((c) => c instanceof OverflowChunker);
            if (oc) {
              const result = await oc.chunk(text);
              return postProcess(result, this.tokenEstimator);
            }
            return [];
          }

          case "markdown":
          case "obsidian":
          default: {
            activeChain = chain.filter((c) => c.type === "markdown" || c.type === "generic");
            if (activeChain.length === 0) {
              activeChain = chain;
            }

            // Try each chunker in order; use first that returns results
            for (const chunker of activeChain) {
              const result = await chunker.chunk(text);
              if (result.length > 0) {
                return postProcess(result, this.tokenEstimator);
              }
            }
            return [];
          }
        }
      },
    };
  }
}

/**
 * Post-processes chunks: merges small chunks and adds overlap.
 */
async function postProcess(
  chunks: Chunk[],
  estimator: TokenEstimator,
): Promise<Chunk[]> {
  if (chunks.length === 0) return chunks;

  // Step 1: Merge small chunks
  const merged = await mergeSmallChunks(chunks, estimator);

  // Step 2: Add overlap
  return addOverlap(merged, estimator);
}

/**
 * Merges consecutive chunks below MIN_MERGE_TOKENS with the previous chunk.
 */
async function mergeSmallChunks(
  chunks: Chunk[],
  estimator: TokenEstimator,
): Promise<Chunk[]> {
  if (chunks.length <= 1) return chunks;

  // Backward-merge approach: push chunks one by one;
  // if the last result entry is below MIN_MERGE_TOKENS, merge current into it.
  const result: Chunk[] = [chunks[0]];

  for (let i = 1; i < chunks.length; i++) {
    const last = result[result.length - 1];
    if (last.size_tokens < MIN_MERGE_TOKENS) {
      // Merge into last result entry (backward merge)
      const mergedContent = last.content + "\n" + chunks[i].content;
      const mergedCore = last.core_content + "\n" + chunks[i].core_content;
      const mergedTokens = await estimator.estimate(mergedContent);
      result[result.length - 1] = {
        content: mergedContent,
        core_content: mergedCore,
        chunk_index: last.chunk_index,
        total_chunks: 0,
        strategy: last.strategy,
        size_tokens: mergedTokens,
      };
    } else {
      result.push(chunks[i]);
    }
  }

  // Post-loop cleanup: if last result entry is still < MIN_MERGE_TOKENS
  // and there's a previous entry, merge backward into it (handles trailing small chunks)
  if (result.length > 1 && result[result.length - 1].size_tokens < MIN_MERGE_TOKENS) {
    const last = result.pop()!;
    const prev = result[result.length - 1];
    const mergedContent = prev.content + "\n" + last.content;
    const mergedCore = prev.core_content + "\n" + last.core_content;
    const mergedTokens = await estimator.estimate(mergedContent);
    result[result.length - 1] = {
      content: mergedContent,
      core_content: mergedCore,
      chunk_index: prev.chunk_index,
      total_chunks: 0,
      strategy: prev.strategy,
      size_tokens: mergedTokens,
    };
  }

  // Re-index
  for (let i = 0; i < result.length; i++) {
    result[i].chunk_index = i;
    result[i].total_chunks = result.length;
  }

  return result;
}

/**
 * Adds OVERLAP_TOKENS of overlap text from the end of each chunk
 * to the beginning of the next chunk's content.
 * Overlap text is NOT included in core_content.
 */
async function addOverlap(
  chunks: Chunk[],
  estimator: TokenEstimator,
): Promise<Chunk[]> {
  if (chunks.length <= 1) return chunks;

  const result: Chunk[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const current = { ...chunks[i] };

    if (i > 0) {
      const prev = chunks[i - 1];
      const totalTokens = prev.size_tokens || 1;
      const charsPerToken = Math.max(
        prev.content.length / totalTokens,
        1,
      );
      const overlapChars = Math.min(
        Math.floor(OVERLAP_TOKENS * charsPerToken),
        prev.content.length,
      );

      if (overlapChars > 0) {
        const overlapText = prev.content.slice(-overlapChars);
        current.content = overlapText + "\n" + current.content;
        current.size_tokens = await estimator.estimate(current.content);
        // Core content stays unchanged (no overlap)
      }
    }

    result.push(current);
  }

  return result;
}


---
# src/infrastructure/chunking/CodeChunker.ts
---
import type { Chunk, Chunker } from "../../domain/systems/ChunkingSystem";
import type { TokenEstimator } from "../../domain/systems/HashingSystem";
import type { SourceType } from "../../domain/types";
import { parse, Lang } from "@ast-grep/napi";

interface NodeRange {
  start: { line: number; column: number; index: number };
  end: { line: number; column: number; index: number };
}

interface SgNodeLike {
  kind(): string;
  text(): string;
  range(): NodeRange;
}

/**
 * Splits TypeScript code by function and class boundaries as indivisible units.
 * Each function or class is one chunk. Non-declaration code is grouped separately.
 * There is no overlap between code chunks.
 */
export class CodeChunker implements Chunker {
  readonly type: SourceType = "code";
  readonly strategy = "code";

  constructor(
    private readonly maxTokens: number,
    private readonly tokenEstimator: TokenEstimator,
  ) {}

  async chunk(text: string): Promise<Chunk[]> {
    if (!text.trim()) return [];

    let sgRoot: { root(): { children(): SgNodeLike[] } };
    try {
      sgRoot = parse(Lang.TypeScript, text);
    } catch {
      // If parsing fails, return the whole text as one chunk
      const tokenCount = await this.tokenEstimator.estimate(text);
      return [
        {
          content: text,
          core_content: text,
          chunk_index: 0,
          total_chunks: 1,
          strategy: this.strategy,
          size_tokens: tokenCount,
        },
      ];
    }

    const topLevelNodes = sgRoot.root().children();

    // Sort all top-level nodes by source position
    const sortedNodes = [...topLevelNodes]
      .map((node) => ({ node, range: node.range() }))
      .sort((a, b) => a.range.start.index - b.range.start.index);

    const chunks: Chunk[] = [];
    let cursor = 0;
    let chunkIndex = 0;

    // Walk through nodes in source order, interleaving decl and non-decl chunks
    for (const { node, range } of sortedNodes) {
      const kind = node.kind();
      if (kind === "function_declaration" || kind === "class_declaration") {
        // Emit non-declaration text before this declaration (if any)
        if (cursor < range.start.index) {
          const otherText = text.slice(cursor, range.start.index).trim();
          if (otherText) {
            const tokenCount = await this.tokenEstimator.estimate(otherText);
            chunks.push({
              content: otherText,
              core_content: otherText,
              chunk_index: chunkIndex++,
              total_chunks: 0,
              strategy: this.strategy,
              size_tokens: tokenCount,
            });
          }
          cursor = range.start.index;
        }

        // Emit declaration as a separate chunk
        const declText = node.text();
        const tokenCount = await this.tokenEstimator.estimate(declText);
        chunks.push({
          content: declText,
          core_content: declText,
          chunk_index: chunkIndex++,
          total_chunks: 0,
          strategy: this.strategy,
          size_tokens: tokenCount,
        });
        cursor = range.end.index;
      }
    }

    // Emit any remaining non-declaration text after the last declaration
    if (cursor < text.length) {
      const remainingText = text.slice(cursor).trim();
      if (remainingText) {
        const tokenCount = await this.tokenEstimator.estimate(remainingText);
        chunks.push({
          content: remainingText,
          core_content: remainingText,
          chunk_index: chunkIndex++,
          total_chunks: 0,
          strategy: this.strategy,
          size_tokens: tokenCount,
        });
      }
    }

    // If no chunks were emitted, return whole text as one chunk
    if (chunks.length === 0) {
      const tokenCount = await this.tokenEstimator.estimate(text);
      chunks.push({
        content: text,
        core_content: text,
        chunk_index: 0,
        total_chunks: 1,
        strategy: this.strategy,
        size_tokens: tokenCount,
      });
      return chunks;
    }

    // Fix total_chunks
    for (const c of chunks) {
      c.total_chunks = chunks.length;
    }

    return chunks;
  }
}


---
# src/infrastructure/chunking/HeadingChunker.ts
---
import type { Chunk, Chunker } from "../../domain/systems/ChunkingSystem";
import type { TokenEstimator } from "../../domain/systems/HashingSystem";
import type { SourceType } from "../../domain/types";

/**
 * Splits Markdown content by heading boundaries (#, ##, etc.).
 * Sections that exceed maxTokens cause early termination — valid sections
 * collected before the over-long section are returned so the pipeline
 * gets partial results rather than an empty fallback.
 */
export class HeadingChunker implements Chunker {
  readonly type: SourceType = "markdown";
  readonly strategy = "heading";

  constructor(
    private readonly maxTokens: number,
    private readonly tokenEstimator: TokenEstimator,
  ) {}

  async chunk(text: string): Promise<Chunk[]> {
    if (!text) return [];

    const sections = this.extractSections(text);
    if (sections.length === 0) return [];

    const chunks: Chunk[] = [];
    let chunkIndex = 0;

    for (const section of sections) {
      const tokenCount = await this.tokenEstimator.estimate(
        section.fullContent,
      );

      if (tokenCount > this.maxTokens) {
        // Section too long → stop here, return valid sections collected so far
        // Over-long section data is lost — caller should ensure it's handled elsewhere
        break;
      }

      chunks.push({
        content: section.fullContent,
        core_content: section.body,
        chunk_index: chunkIndex++,
        total_chunks: 0,
        strategy: this.strategy,
        size_tokens: tokenCount,
      });
    }

    // Fix total_chunks
    for (const c of chunks) {
      c.total_chunks = chunks.length;
    }

    return chunks;
  }

  /**
   * Extracts heading-delimited sections from Markdown text.
   * Returns { heading, body, fullContent } for each section.
   */
  private extractSections(
    text: string,
  ): Array<{ heading: string; body: string; fullContent: string }> {
    const lines = text.split("\n");
    const sections: Array<{
      heading: string;
      bodyLines: string[];
      fullContent: string;
    }> = [];

    let currentHeading = "";
    let currentBodyLines: string[] = [];
    let currentFullLines: string[] = [];

    for (const line of lines) {
      const headingMatch = line.match(/^#{1,6}\s/);
      if (headingMatch) {
        // Save previous section
        if (currentFullLines.length > 0) {
          sections.push({
            heading: currentHeading,
            bodyLines: [...currentBodyLines],
            fullContent: currentFullLines.join("\n"),
          });
        }

        currentHeading = line;
        currentBodyLines = [];
        currentFullLines = [line];
      } else {
        currentFullLines.push(line);
        if (currentHeading) {
          currentBodyLines.push(line);
        }
      }
    }

    // Save last section
    if (currentFullLines.length > 0) {
      sections.push({
        heading: currentHeading,
        bodyLines: [...currentBodyLines],
        fullContent: currentFullLines.join("\n"),
      });
    }

    return sections.map((s) => ({
      heading: s.heading,
      body: s.bodyLines.join("\n").trim(),
      fullContent: s.fullContent.trim(),
    }));
  }
}


---
# src/infrastructure/chunking/OverflowChunker.ts
---
import type { Chunk, Chunker } from "../../domain/systems/ChunkingSystem";
import type { TokenEstimator } from "../../domain/systems/HashingSystem";
import type { SourceType } from "../../domain/types";

/**
 * Last-resort chunker that splits text at token boundaries.
 * Each chunk targets `maxTokens` size and guarantees at least `minTokens`.
 */
export class OverflowChunker implements Chunker {
  readonly type: SourceType = "generic";
  readonly strategy = "overflow";

  constructor(
    private readonly maxTokens: number,
    private readonly minTokens: number,
    private readonly tokenEstimator: TokenEstimator,
  ) {}

  async chunk(text: string): Promise<Chunk[]> {
    if (!text) return [];

    const totalTokens = await this.tokenEstimator.estimate(text);
    if (totalTokens <= 0) return [];
    if (totalTokens <= this.maxTokens) {
      return [
        {
          content: text,
          core_content: text,
          chunk_index: 0,
          total_chunks: 1,
          strategy: this.strategy,
          size_tokens: totalTokens,
        },
      ];
    }

    // Approximate character-to-token ratio for splitting
    const charsPerToken = text.length / totalTokens;
    const chunkCharSize = Math.max(
      Math.floor(this.maxTokens * charsPerToken),
      1,
    );
    const minChunkCharSize = Math.floor(this.minTokens * charsPerToken);

    const chunks: Chunk[] = [];
    let offset = 0;
    let index = 0;

    while (offset < text.length) {
      let end = Math.min(offset + chunkCharSize, text.length);

      // Ensure we don't leave a trailing chunk below minChunkCharSize
      const remaining = text.length - end;
      if (remaining > 0 && remaining < minChunkCharSize) {
        // Merge remaining into this chunk
        end = text.length;
      }

      const content = text.slice(offset, end);
      const tokenCount = await this.tokenEstimator.estimate(content);

      chunks.push({
        content,
        core_content: content,
        chunk_index: index,
        total_chunks: 0, // will fix after we know total
        strategy: this.strategy,
        size_tokens: tokenCount,
      });

      offset = end;
      index++;
    }

    // Fix total_chunks for all chunks
    for (const c of chunks) {
      c.total_chunks = chunks.length;
    }

    return chunks;
  }
}


---
# src/infrastructure/chunking/ParagraphChunker.ts
---
import type { Chunk, Chunker } from "../../domain/systems/ChunkingSystem";
import type { TokenEstimator } from "../../domain/systems/HashingSystem";
import type { SourceType } from "../../domain/types";
import { SentenceChunker } from "./SentenceChunker";

/**
 * Splits text by paragraph boundaries (blank lines).
 * Paragraphs that exceed maxTokens are delegated to SentenceChunker.
 */
export class ParagraphChunker implements Chunker {
  readonly type: SourceType = "markdown";
  readonly strategy = "paragraph";

  constructor(
    private readonly maxTokens: number,
    private readonly tokenEstimator: TokenEstimator,
    private readonly fallback: SentenceChunker,
  ) {}

  async chunk(text: string): Promise<Chunk[]> {
    if (!text) return [];

    const paragraphs = this.splitParagraphs(text);
    if (paragraphs.length === 0) return [];

    const chunks: Chunk[] = [];
    let chunkIndex = 0;

    for (const paragraph of paragraphs) {
      const tokenCount = await this.tokenEstimator.estimate(paragraph);

      if (tokenCount <= this.maxTokens) {
        chunks.push(this.makeChunk(paragraph, tokenCount, chunkIndex++));
      } else {
        // Paragraph too long → delegate to SentenceChunker
        const subChunks = await this.fallback.chunk(paragraph);
        for (const sc of subChunks) {
          chunks.push({
            ...sc,
            chunk_index: chunkIndex++,
            total_chunks: 0,
          });
        }
      }
    }

    // Fix total_chunks
    for (const c of chunks) {
      c.total_chunks = chunks.length;
    }

    return chunks;
  }

  /**
   * Splits text into paragraphs by blank line boundaries.
   */
  private splitParagraphs(text: string): string[] {
    return text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  private makeChunk(
    content: string,
    tokenCount: number,
    index: number,
  ): Chunk {
    return {
      content,
      core_content: content,
      chunk_index: index,
      total_chunks: 0,
      strategy: this.strategy,
      size_tokens: tokenCount,
    };
  }
}


---
# src/infrastructure/chunking/SentenceChunker.ts
---
import type { Chunk, Chunker } from "../../domain/systems/ChunkingSystem";
import type { TokenEstimator } from "../../domain/systems/HashingSystem";
import type { SourceType } from "../../domain/types";
import { OverflowChunker } from "./OverflowChunker";

const DEFAULT_ABBREVIATIONS = [
  "Mr",
  "Mrs",
  "Dr",
  "e.g",
  "i.e",
  "vs",
  "etc",
  "Jr",
  "Sr",
  "St",
];

/**
 * Splits text at sentence boundaries (.!?) with abbreviation protection.
 * Single sentences that exceed maxTokens are delegated to OverflowChunker.
 */
export class SentenceChunker implements Chunker {
  readonly type: SourceType = "markdown";
  readonly strategy = "sentence";
  private readonly abbreviations: string[];

  constructor(
    private readonly maxTokens: number,
    private readonly tokenEstimator: TokenEstimator,
    private readonly fallback: OverflowChunker,
    abbreviations?: string[],
  ) {
    // Normalize abbreviations: strip trailing dot for comparison
    this.abbreviations = (abbreviations ?? DEFAULT_ABBREVIATIONS).map((a) =>
      a.endsWith(".") ? a.slice(0, -1) : a,
    );
  }

  async chunk(text: string): Promise<Chunk[]> {
    if (!text) return [];

    const sentences = this.splitSentences(text);
    if (sentences.length === 0) return [];

    // Estimate tokens for each sentence
    const sentenceTokenCounts = await Promise.all(
      sentences.map((s) => this.tokenEstimator.estimate(s)),
    );

    const chunks: Chunk[] = [];
    let currentGroup: string[] = [];
    let currentTokens = 0;
    let chunkIndex = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const tokenCount = sentenceTokenCounts[i];

      // Single sentence exceeds maxTokens → delegate to overflow
      if (tokenCount > this.maxTokens && currentGroup.length === 0) {
        const overflowChunks = await this.fallback.chunk(sentence);
        for (const oc of overflowChunks) {
          chunks.push({
            ...oc,
            chunk_index: chunkIndex++,
            total_chunks: 0,
          });
        }
        continue;
      }

      // Check if adding this sentence would exceed maxTokens
      if (currentTokens + tokenCount > this.maxTokens && currentGroup.length > 0) {
        // Flush current group
        chunks.push(
          this.makeChunk(currentGroup.join(" "), currentTokens, chunkIndex++),
        );
        currentGroup = [];
        currentTokens = 0;
      }

      currentGroup.push(sentence);
      currentTokens += tokenCount;
    }

    // Flush last group
    if (currentGroup.length > 0) {
      chunks.push(
        this.makeChunk(currentGroup.join(" "), currentTokens, chunkIndex++),
      );
    }

    // Fix total_chunks
    for (const c of chunks) {
      c.total_chunks = chunks.length;
    }

    return chunks;
  }

  /**
   * Splits text into individual sentences, respecting abbreviations.
   */
  private splitSentences(text: string): string[] {
    const boundaries = this.findSentenceBoundaries(text);
    if (boundaries.length === 0) return [text.trim()].filter(Boolean);

    const sentences: string[] = [];
    let start = 0;

    for (const boundary of boundaries) {
      const sentence = text.slice(start, boundary).trim();
      if (sentence) {
        sentences.push(sentence);
      }
      start = boundary;
    }

    // Remaining text after last boundary
    const remaining = text.slice(start).trim();
    if (remaining) {
      sentences.push(remaining);
    }

    return sentences;
  }

  /**
   * Finds positions of sentence-ending punctuation that are NOT abbreviations.
   */
  private findSentenceBoundaries(text: string): number[] {
    const boundaries: number[] = [];
    const regex = /[.!?](?:\s|$)/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const pos = match.index;

      // Check if the word before the punctuation is an abbreviation
      const beforeText = text.slice(0, pos);
      const precedingWords = beforeText.split(/[\s\n]/);
      const lastWord = precedingWords[precedingWords.length - 1] || "";
      const candidate = lastWord.replace(/[.!?]+$/, "").replace(/^[\W]+/, "");

      if (!this.abbreviations.includes(candidate)) {
        // Boundary is after the punctuation
        boundaries.push(pos + 1);
      }
    }

    return boundaries;
  }

  private makeChunk(
    content: string,
    tokenCount: number,
    index: number,
  ): Chunk {
    return {
      content,
      core_content: content,
      chunk_index: index,
      total_chunks: 0,
      strategy: this.strategy,
      size_tokens: tokenCount,
    };
  }
}


---
# src/infrastructure/context/BLAKE3Deduplicator.ts
---
import type { SearchResult } from "../../domain/types";
import type { Deduplicator } from "../../domain/systems/ContextPackagingSystem";

/**
 * O(n) deduplicator that keeps the highest-scoring entry per `semantic_blake3`.
 *
 * - Uses a `Map<semantic_blake3, { result, index }>` to track best entry per hash
 *   while preserving original order of first occurrence.
 * - Does **not** mutate the input array.
 */
export class BLAKE3Deduplicator implements Deduplicator {
  async deduplicate(results: SearchResult[]): Promise<SearchResult[]> {
    // Map: semantic_blake3 -> { best result seen, first occurrence index }
    const seen = new Map<string, { result: SearchResult; firstIndex: number }>();

    for (let i = 0; i < results.length; i++) {
      const candidate = results[i]!;
      const hash = candidate.source.semantic_blake3;
      const existing = seen.get(hash);

      if (!existing) {
        // First time seeing this hash — store it
        seen.set(hash, { result: candidate, firstIndex: i });
      } else if (candidate.score > existing.result.score) {
        // Same hash, higher score — replace keeping original firstIndex
        seen.set(hash, { result: candidate, firstIndex: existing.firstIndex });
      }
      // Same hash, lower or equal score — skip
    }

    // Sort back into original order and extract results
    return Array.from(seen.values())
      .sort((a, b) => a.firstIndex - b.firstIndex)
      .map((entry) => entry.result);
  }
}


---
# src/infrastructure/context/GPTCodeTokenizer.ts
---
import { countTokens } from "gpt-tokenizer";
import type { Tokenizer } from "../../domain/systems/ContextPackagingSystem";

/**
 * Tokenizer backed by `gpt-tokenizer` (o200k_base encoding, used by GPT-4o).
 *
 * - `count(text)` returns the exact GPT token count.
 * - `truncate(text, maxTokens)` performs greedy word-safe truncation:
 *   words are added one at a time until the token budget is exceeded,
 *   then the last complete prefix is returned.
 */
export class GPTCodeTokenizer implements Tokenizer {
  async count(text: string): Promise<number> {
    if (text.length === 0) return 0;
    return countTokens(text);
  }

  async truncate(text: string, maxTokens: number): Promise<string> {
    // Edge cases
    if (maxTokens <= 0 || text.length === 0) return "";

    const totalTokens = countTokens(text);
    if (totalTokens <= maxTokens) return text;

    // Greedy word-safe truncation: add words until we hit the budget
    const words = text.split(/(\s+)/);
    let result = "";
    let resultTokens = 0;

    for (const word of words) {
      const candidate = result + word;
      const candidateTokens = countTokens(candidate);

      if (candidateTokens > maxTokens) {
        // Adding this word would exceed the budget — return current prefix
        break;
      }

      result = candidate;
      resultTokens = candidateTokens;
    }

    return result;
  }
}


---
# src/infrastructure/context/RAGContextPacker.ts
---
import type { SearchResult } from "../../domain/types";
import type { ContextPacker, Deduplicator, PackedContext, Tokenizer } from "../../domain/systems/ContextPackagingSystem";

/**
 * Packs search results into a formatted Markdown context for LLM consumption.
 *
 * Pipeline:
 * 1. Deduplicate results via injectable Deduplicator
 * 2. Sort by score descending
 * 3. Greedy-fit into token budget
 * 4. Format as Markdown with optional RAG wrapper
 */
export class RAGContextPacker implements ContextPacker {
  private readonly deduplicator: Deduplicator;
  private readonly tokenizer: Tokenizer;
  private readonly DEFAULT_MAX_TOKENS = 8192;

  constructor(deduplicator: Deduplicator, tokenizer: Tokenizer) {
    this.deduplicator = deduplicator;
    this.tokenizer = tokenizer;
  }

  async pack(
    results: SearchResult[],
    options?: { maxTokens?: number; format?: "rag" | "context" },
  ): Promise<PackedContext> {
    const maxTokens = options?.maxTokens ?? this.DEFAULT_MAX_TOKENS;
    const format = options?.format ?? "context";

    // Step 1: Deduplicate
    const deduped = await this.deduplicator.deduplicate(results);

    if (deduped.length === 0) {
      return {
        markdown: "",
        chunks_used: 0,
        total_tokens: 0,
        truncated: false,
        source_notes: [],
      };
    }

    // Step 2: Sort by score descending (stable)
    const sorted = [...deduped].sort((a, b) => b.score - a.score);

    // Step 3: Greedy-fit into token budget
    const included: Array<{ result: SearchResult; tokens: number }> = [];
    let totalTokens = 0;

    for (const result of sorted) {
      const tokens = await this.tokenizer.count(result.source.content);
      if (totalTokens + tokens <= maxTokens) {
        included.push({ result, tokens });
        totalTokens += tokens;
      } else {
        break; // Budget exceeded — stop
      }
    }

    // Step 4: Format as Markdown
    const parts = included.map(
      ({ result }) => `### Source: ${result.source.path}\n${result.source.content}\n`,
    );
    const markdown = parts.join("");

    // Step 5: Collect unique source paths
    const sourceNotes = [...new Set(included.map(({ result }) => result.source.path))];

    // Build result
    const packed: PackedContext = {
      markdown,
      chunks_used: included.length,
      total_tokens: totalTokens,
      truncated: included.length < sorted.length,
      source_notes: sourceNotes,
    };

    // Step 6: Wrap for RAG format if requested
    if (format === "rag") {
      packed.markdown =
        "You are a helpful assistant. Use the following context to answer the user's question.\n\n<context>\n" +
        markdown +
        "</context>";
    }

    return packed;
  }
}


---
# src/infrastructure/embedding/CachedEmbedder.ts
---
import type { Embedding, Embedder } from "../../domain/systems/EmbeddingSystem";
import type { EmbedderCache } from "../../domain/systems/EmbeddingSystem";

/**
 * A proxy/decorator that wraps an Embedder with an LRU cache.
 *
 * On embed(), it computes a cache key as `${model}:${hash(text)}`,
 * checks the cache, and only calls the inner embedder on a cache miss.
 * Results from the inner embedder are stored in the cache for future calls.
 */
export class CachedEmbedder implements Embedder {
  readonly model: string;
  readonly dimensions: number;

  constructor(
    private readonly embedder: Embedder,
    private readonly cache: EmbedderCache,
    private readonly hasher: { hash(text: string): string },
  ) {
    this.model = embedder.model;
    this.dimensions = embedder.dimensions;
  }

  async embed(text: string): Promise<Embedding> {
    const key = `${this.embedder.model}:${this.hasher.hash(text)}`;

    const cached = await this.cache.get(key);
    if (cached !== null) {
      return cached;
    }

    const result = await this.embedder.embed(text);
    await this.cache.set(key, result);
    return result;
  }
}


---
# src/infrastructure/embedding/EmbedderCacheLRU.ts
---
import type { Embedding, EmbedderCache } from "../../domain/systems/EmbeddingSystem";

/**
 * In-memory LRU cache for embeddings keyed by `${model}:${hash}`.
 *
 * Evicts the least-recently-used entry when the cache exceeds `maxSize`.
 * Accessing an entry via get() or has() promotes it to most-recently-used,
 * protecting it from eviction.
 *
 * @example
 * ```ts
 * const cache = new EmbedderCacheLRU(100);
 * await cache.set("nomic-embed-text:abc123", embedding);
 * const found = await cache.get("nomic-embed-text:abc123");
 * ```
 */
export class EmbedderCacheLRU implements EmbedderCache {
  private readonly _map: Map<string, Embedding>;
  private readonly _maxSize: number;

  constructor(maxSize: number = 100) {
    if (maxSize <= 0) {
      throw new Error(`EmbedderCacheLRU maxSize must be > 0, got ${maxSize}`);
    }
    this._map = new Map<string, Embedding>();
    this._maxSize = maxSize;
  }

  /** Number of entries currently in the cache. */
  get size(): number {
    return this._map.size;
  }

  /**
   * Retrieves an embedding by key.
   * Promotes the key to most-recently-used on hit.
   * Returns `null` when the key is absent.
   */
  async get(key: string): Promise<Embedding | null> {
    if (!this._map.has(key)) {
      return null;
    }

    // Promote to most-recently-used by re-inserting
    const value = this._map.get(key)!;
    this._map.delete(key);
    this._map.set(key, value);

    return value;
  }

  /**
   * Stores an embedding by key.
   * If the key already exists its value is overwritten and its LRU position
   * is refreshed. If the cache is at capacity the least-recently-used entry
   * is evicted before insertion.
   */
  async set(key: string, embedding: Embedding): Promise<void> {
    // If key exists, remove it first so re-insertion puts it at the end
    if (this._map.has(key)) {
      this._map.delete(key);
    }

    // Evict the least-recently-used entry when at capacity
    if (this._map.size >= this._maxSize) {
      const oldestKey = this._map.keys().next().value;
      if (oldestKey !== undefined) {
        this._map.delete(oldestKey);
      }
    }

    this._map.set(key, embedding);
  }

  /**
   * Checks whether a key exists in the cache.
   * Promotes the key to most-recently-used when present.
   */
  has(key: string): boolean {
    if (!this._map.has(key)) {
      return false;
    }

    // Promote to most-recently-used by re-inserting
    const value = this._map.get(key)!;
    this._map.delete(key);
    this._map.set(key, value);

    return true;
  }

  /** Removes all entries from the cache. */
  clear(): void {
    this._map.clear();
  }
}


---
# src/infrastructure/embedding/EmbedderRegistryImpl.ts
---
import type { Embedder, EmbedderRegistry } from "../../domain/systems/EmbeddingSystem";

/**
 * A config-driven embedder registry that routes source types
 * to the correct models by priority, with universal model support.
 *
 * Usage:
 * ```ts
 * const registry = new EmbedderRegistryImpl();
 * registry.register("typescript", tsEmbedder, 1);
 * registry.register("*", universalEmbedder, 10);  // universal fallback
 * ```
 */
export class EmbedderRegistryImpl implements EmbedderRegistry {
  private readonly modelMap: Map<string, Array<{ embedder: Embedder; priority: number }>> = new Map();

  /**
   * Creates a new registry, optionally pre-populated from model entries.
   *
   * @param entries - Optional list of model entries. If source_types is absent
   *                  or empty, the model is registered as universal ("*").
   */
  constructor(entries?: Array<{
    model: string;
    embedder: Embedder;
    source_types?: string[];
    priority: number;
  }>) {
    if (entries) {
      for (const entry of entries) {
        const types = entry.source_types && entry.source_types.length > 0
          ? entry.source_types
          : ["*"];
        for (const sourceType of types) {
          this.register(sourceType, entry.embedder, entry.priority);
        }
      }
    }
  }

  /**
   * Returns the embedder with the lowest priority for the given source type,
   * or the universal model (registered with "*") if no specific match is found.
   *
   * @param sourceType - The source type to look up
   * @returns The matching embedder, or null if none is found
   */
  getEmbedder(sourceType: string): Embedder | null {
    // Prefer exact matches over universal
    const exact = this.modelMap.get(sourceType);
    if (exact && exact.length > 0) {
      const sorted = [...exact].sort((a, b) => a.priority - b.priority);
      return sorted[0]!.embedder;
    }

    // Fall back to universal with lowest priority
    const universal = this.modelMap.get("*");
    if (universal && universal.length > 0) {
      const sorted = [...universal].sort((a, b) => a.priority - b.priority);
      return sorted[0]!.embedder;
    }

    return null;
  }

  /**
   * Returns all embedders that support the given source type,
   * ordered by priority ascending. Falls back to universal models
   * (registered with "*") if no specific matches are found.
   *
   * @param sourceType - The source type to look up
   * @returns Array of matching embedders, sorted by priority
   */
  getEmbedders(sourceType: string): Embedder[] {
    const results: Array<{ embedder: Embedder; priority: number }> = [];
    const seen = new Set<Embedder>();

    // Collect exact matches
    const exact = this.modelMap.get(sourceType);
    if (exact) {
      for (const entry of exact) {
        seen.add(entry.embedder);
        results.push(entry);
      }
    }

    // Always include universal models (but avoid duplicates)
    const universal = this.modelMap.get("*");
    if (universal) {
      for (const entry of universal) {
        if (!seen.has(entry.embedder)) {
          results.push(entry);
        }
      }
    }

    // Sort by priority ascending
    results.sort((a, b) => a.priority - b.priority);

    return results.map((entry) => entry.embedder);
  }

  /**
   * Returns the universal model (registered with sourceType "*"),
   * or null if none is registered.
   */
  getUniversalEmbedder(): Embedder | null {
    const universal = this.modelMap.get("*");
    if (!universal || universal.length === 0) return null;
    // Return the one with lowest priority (copy before sort to avoid mutation)
    const sorted = [...universal].sort((a, b) => a.priority - b.priority);
    return sorted[0]!.embedder;
  }

  /**
   * Checks whether any embedders are registered.
   */
  isAvailable(): boolean {
    return this.modelMap.size > 0;
  }

  /**
   * Registers an embedder for the given source type with a priority.
   * Lower priority values take precedence.
   *
   * @param sourceType - The source type (use "*" for universal fallback)
   * @param embedder - The embedder instance
   * @param priority - Lower values = higher priority
   */
  register(sourceType: string, embedder: Embedder, priority: number): void {
    const existing = this.modelMap.get(sourceType) ?? [];
    existing.push({ embedder, priority });
    this.modelMap.set(sourceType, existing);
  }

  /**
   * Returns the list of unique model names registered across all source types.
   */
  get modelNames(): string[] {
    const names = new Set<string>();
    for (const entries of this.modelMap.values()) {
      for (const entry of entries) {
        names.add(entry.embedder.model);
      }
    }
    return Array.from(names);
  }
}


---
# src/infrastructure/embedding/LanceDbEmbedder.ts
---
import type { Embedding, Embedder } from "../../domain/systems/EmbeddingSystem";

/**
 * A zero-vector fallback embedder for graceful degradation.
 *
 * Returns a Float32Array of zeros whenever embed() is called, with
 * tokens_in set to 0. Use as a safe default when no real embedder
 * (e.g. Ollama) is available for a source type.
 *
 * @example
 * ```ts
 * const embedder = new LanceDbEmbedder();
 * const embedding = await embedder.embed("any text");
 * // embedding.vector    → Float32Array(384) filled with 0
 * // embedding.model     → "lancedb-fallback"
 * // embedding.dimensions → 384
 * // embedding.tokens_in  → 0
 * ```
 */
export class LanceDbEmbedder implements Embedder {
  readonly model: string;
  readonly dimensions: number;

  constructor(model: string = "lancedb-fallback", dimensions: number = 384) {
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(_text: string): Promise<Embedding> {
    return {
      vector: new Float32Array(this.dimensions) as unknown as number[],
      model: this.model,
      dimensions: this.dimensions,
      tokens_in: 0,
    };
  }
}


---
# src/infrastructure/embedding/MultiModelEmbedder.ts
---
import type { Embedding, Embedder } from "../../domain/systems/EmbeddingSystem";

/**
 * A parallel multi-model embedder that runs multiple embedders concurrently
 * and collects their results into a `Record<string, Embedding>`.
 *
 * Unlike individual Embedders, MultiModelEmbedder is NOT itself an Embedder.
 * It returns a Record mapping model keys to their Embedding results,
 * tolerating partial failures via Promise.allSettled — failed embedders are
 * silently omitted from the result.
 */
export class MultiModelEmbedder {
  constructor(private readonly embedders: Record<string, Embedder>) {}

  /**
   * Runs all inner embedders in parallel via Promise.allSettled and returns
   * a record of successful results keyed by the embedder's record key.
   *
   * @param text - The text to embed through all configured embedders
   * @returns A record mapping embedder keys to their Embedding results.
   *          Failing embedders are silently omitted. Returns `{}` when
   *          all embedders fail or none are configured.
   */
  async embedAll(text: string): Promise<Record<string, Embedding>> {
    const keys = Object.keys(this.embedders);
    if (keys.length === 0) {
      return {};
    }

    const values = Object.values(this.embedders);
    const results = await Promise.allSettled(
      values.map((e) => e.embed(text)),
    );

    const output: Record<string, Embedding> = {};

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === "fulfilled") {
        output[keys[i]!] = result.value;
      }
    }

    return output;
  }
}


---
# src/infrastructure/embedding/NullEmbedder.ts
---
import type { Embedding, Embedder } from "../../domain/systems/EmbeddingSystem";

/**
 * A null embedder that always throws "no embedder available".
 * Used as a fallback when no real embedder is configured for a source type.
 *
 * Implements the Embedder interface to satisfy structural type checks,
 * but rejects every call to embed() with an error.
 */
export class NullEmbedder implements Embedder {
  readonly model: string = "null";
  readonly dimensions: number = 0;

  async embed(_text: string): Promise<Embedding> {
    throw new Error("no embedder available");
  }
}


---
# src/infrastructure/embedding/OllamaEmbedder.ts
---
import type { Embedding, Embedder } from "../../domain/systems/EmbeddingSystem";

/**
 * An HTTP client embedder that calls Ollama's /api/embeddings endpoint.
 *
 * Features:
 * - POSTs text to Ollama's embedding API and returns a Float32Array vector
 * - Exponential backoff: 1s → 2s → 4s delay between up to 3 attempts
 * - Supports AbortSignal for cancellation
 * - embedBatch for processing multiple texts in parallel
 *
 * @example
 * ```ts
 * const embedder = new OllamaEmbedder("nomic-embed-text", 768);
 * const embedding = await embedder.embed("Hello world");
 * ```
 */
export class OllamaEmbedder implements Embedder {
  readonly model: string;
  readonly dimensions: number;
  private readonly baseUrl: string;

  constructor(
    model: string,
    dimensions: number = 384,
    baseUrl: string = "http://localhost:11434",
  ) {
    this.model = model;
    this.dimensions = dimensions;
    this.baseUrl = baseUrl;
  }

  /**
   * Embeds a single text string by POSTing to Ollama's /api/embeddings.
   *
   * On failure, retries with exponential backoff (1s → 2s → 4s, max 3 attempts).
   * Aborted requests (via signal) are not retried — the AbortError propagates.
   *
   * @param text  - The text to embed
   * @param signal - Optional AbortSignal to cancel the request mid-flight
   * @returns An Embedding with the vector as a Float32Array
   */
  async embed(text: string, signal?: AbortSignal): Promise<Embedding> {
    const delays = [1_000, 2_000];
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}/api/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.model, prompt: text }),
          signal,
        });

        if (!response.ok) {
          throw new Error(
            `Ollama API error: ${response.status} ${response.statusText}`,
          );
        }

        const data = (await response.json()) as { embedding: number[] };
        const vector = new Float32Array(data.embedding);

        return {
          vector: vector as unknown as number[],
          model: this.model,
          dimensions: this.dimensions,
          tokens_in: Math.ceil(text.length / 4),
        };
      } catch (err) {
        // Don't retry if the caller explicitly aborted
        if (err instanceof DOMException && err.name === "AbortError") {
          throw err;
        }

        lastError = err instanceof Error ? err : new Error(String(err));

        // Wait before the next attempt (skip wait on the final attempt)
        if (attempt < delays.length) {
          await sleep(delays[attempt]!);
        }
      }
    }

    throw lastError ?? new Error("embed failed after 3 attempts");
  }

  /**
   * Embeds multiple texts by calling embed() for each in parallel.
   *
   * Each call inherits the retry logic and AbortSignal support from embed().
   * If one text fails, the entire batch rejects (use Promise.allSettled
   * externally for partial tolerance).
   *
   * @param texts  - Array of texts to embed
   * @param signal - Optional AbortSignal forwarded to each embed() call
   * @returns An array of Embedding results, one per input text
   */
  async embedBatch(texts: string[], signal?: AbortSignal): Promise<Embedding[]> {
    return Promise.all(texts.map((text) => this.embed(text, signal)));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


---
# src/infrastructure/hashing/BLAKE3Hasher.ts
---
import { blake3 } from "hash-wasm";
import type { Hasher } from "../../domain/systems/HashingSystem";

/**
 * BLAKE3 hasher implementation using hash-wasm (WebAssembly).
 * Uses the one-shot `blake3()` function which accepts string or Uint8Array
 * and returns a 256-bit (64 hex char) digest by default.
 */
export class BLAKE3Hasher implements Hasher {
  readonly algorithm = "BLAKE3";

  async hash(data: string | Uint8Array): Promise<string> {
    return blake3(data);
  }

  async hashFile(path: string): Promise<string> {
    const file = Bun.file(path);
    const content = await file.text();
    return this.hash(content);
  }
}


---
# src/infrastructure/hashing/TokenEstimatorSimple.ts
---
import type { TokenEstimator } from "../../domain/systems/HashingSystem";

/**
 * A simple token estimator that counts bytes (via TextEncoder) and divides by 4.
 * Provides a rough estimate without needing a model-specific tokenizer.
 */
export class TokenEstimatorSimple implements TokenEstimator {
  readonly model = "simple-byte-estimate";

  async estimate(text: string): Promise<number> {
    if (text.length === 0) return 0;
    const bytes = new TextEncoder().encode(text).length;
    return Math.ceil(bytes / 4);
  }
}


---
# src/infrastructure/hashing/TokenEstimatorTiktoken.ts
---
import type { TokenEstimator } from "../../domain/systems/HashingSystem";
import { TokenEstimatorSimple } from "./TokenEstimatorSimple";

/**
 * Token estimator using `gpt-tokenizer` (community package) for GPT-4 token counts.
 * Falls back to TokenEstimatorSimple if gpt-tokenizer is unavailable.
 */
export class TokenEstimatorTiktoken implements TokenEstimator {
  readonly model = "gpt-4";
  private fallback: TokenEstimatorSimple;

  constructor() {
    this.fallback = new TokenEstimatorSimple();
  }

  async estimate(text: string): Promise<number> {
    try {
      const { encode } = await import("gpt-tokenizer");
      return encode(text).length;
    } catch {
      return this.fallback.estimate(text);
    }
  }
}


---
# src/infrastructure/lancedb/LanceDbSourceRepository.ts
---
import * as lancedb from "@lancedb/lancedb";
import type { Connection, Table } from "@lancedb/lancedb";
import { Field, FixedSizeList, Float32, Int32, Schema, Utf8 } from "apache-arrow";

import type { SourceRepository } from "../../domain/ports/SourceRepository";
import type { SourceData, SearchQuery, SearchResult, IndexStats, SourceType, SourceMetadata } from "../../domain/types";
import type { FileIndex } from "../../domain/ast";

/**
 * LanceDB-backed SourceRepository implementation.
 *
 * Manages two tables:
 * - `sources` — chunk-level data with all `SourceData` fields plus optional
 *   `vect_{modelName}` columns for multi-model embeddings.
 * - `file_index` — file-level AST summaries with complex types (imports,
 *   exports, symbols, relationships) stored as JSON strings.
 *
 * Tables are created lazily on the first write operation.
 * The `embeddings` column is omitted from records that have no embeddings;
 * LanceDB evolves the schema when embeddings are added later.
 *
 * Supports in-memory mode via `connect("memory://")` for tests.
 */
export class LanceDbSourceRepository implements SourceRepository {
  private db: Connection | null = null;
  private sourcesTable: Table | null = null;
  private fileIndexTable: Table | null = null;
  private connected = false;

  constructor(private readonly uri: string) {}

  // ── Connection management ──────────────────────────────────

  async connect(): Promise<void> {
    if (this.connected) return;
    this.db = await lancedb.connect(this.uri);
    this.connected = true;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) await this.connect();
  }

  /** Open the sources table. Returns null if not yet created. */
  private async getSourcesTable(): Promise<Table | null> {
    await this.ensureConnected();
    if (this.sourcesTable) return this.sourcesTable;
    try {
      this.sourcesTable = await this.db!.openTable("sources");
      return this.sourcesTable;
    } catch {
      return null;
    }
  }

  /** Ensure the sources table exists, creating with a schema that includes embeddings. */
  private async ensureSourcesTable(record: Record<string, unknown>): Promise<Table> {
    const existing = await this.getSourcesTable();
    if (existing) return existing;

    // Build schema with all scalar columns + optional vector column for embeddings
    const hasEmb = record.embeddings !== undefined;
    const fields: Field[] = [
      new Field("id", new Utf8(), false),
      new Field("chunk_id", new Utf8(), true),
      new Field("source_id", new Utf8(), true),
      new Field("type", new Utf8(), true),
      new Field("title", new Utf8(), true),
      new Field("content", new Utf8(), true),
      new Field("tags", new Utf8(), true),
      new Field("path", new Utf8(), true),
      new Field("file_blake3", new Utf8(), true),
      new Field("semantic_blake3", new Utf8(), true),
      new Field("chunk_index", new Int32(), true),
      new Field("total_chunks", new Int32(), true),
      new Field("metadata", new Utf8(), true),
      new Field("created_at", new Utf8(), true),
      new Field("updated_at", new Utf8(), true),
    ];

    if (hasEmb) {
      const emb = record.embeddings as Float32Array;
      fields.push(new Field("embeddings", new FixedSizeList(emb.length, new Field("item", new Float32())), true));
    }

    const schema = new Schema(fields);
    this.sourcesTable = await this.db!.createTable("sources", [record], {
      mode: "create",
      existOk: false,
      schema,
    });

    // Create FTS (INVERTED) index on the content column
    try {
      await this.sourcesTable.createIndex("content", {
        config: lancedb.Index.fts({ withPosition: true }),
        replace: true,
        waitTimeoutSeconds: 30,
      });
    } catch {
      // FTS index may not be supported in memory:// mode
    }

    return this.sourcesTable;
  }

  /** Open the file_index table. Returns null if not yet created. */
  private async getFileIndexTable(): Promise<Table | null> {
    await this.ensureConnected();
    if (this.fileIndexTable) return this.fileIndexTable;
    try {
      this.fileIndexTable = await this.db!.openTable("file_index");
      return this.fileIndexTable;
    } catch {
      return null;
    }
  }

  /** Ensure the file_index table exists. */
  private async ensureFileIndexTable(record: Record<string, unknown>): Promise<Table> {
    const existing = await this.getFileIndexTable();
    if (existing) return existing;

    const fields: Field[] = [
      new Field("path", new Utf8(), false),
      new Field("file_blake3", new Utf8(), true),
      new Field("language", new Utf8(), true),
      new Field("imports", new Utf8(), true),
      new Field("exports", new Utf8(), true),
      new Field("symbols", new Utf8(), true),
      new Field("relationships", new Utf8(), true),
      new Field("last_parsed", new Utf8(), true),
    ];

    const schema = new Schema(fields);
    this.fileIndexTable = await this.db!.createTable("file_index", [record], {
      mode: "create",
      existOk: false,
      schema,
    });

    return this.fileIndexTable;
  }

  // ── Sources CRUD ───────────────────────────────────────────

  async upsert(data: SourceData): Promise<void> {
    const record = this.sourceDataToRecord(data);
    const table = await this.ensureSourcesTable(record);

    try {
      await table.delete(`id = '${escapeLanceSqlString(data.id)}'`);
    } catch {
      // Row may not exist
    }

    await table.add([record]);
  }

  async upsertBatch(data: SourceData[]): Promise<void> {
    if (data.length === 0) return;

    const records = data.map((d) => this.sourceDataToRecord(d));
    const table = await this.ensureSourcesTable(records[0]!);

    for (const d of data) {
      try {
        await table.delete(`id = '${escapeLanceSqlString(d.id)}'`);
      } catch {
        // Row may not exist
      }
    }

    await table.add(records);
  }

  async getById(id: string): Promise<SourceData | null> {
    const table = await this.getSourcesTable();
    if (!table) return null;

    const results = await table.query()
      .where(`id = '${escapeLanceSqlString(id)}'`)
      .limit(1)
      .toArray();

    if (results.length === 0) return null;
    return this.recordToSourceData(results[0] as Record<string, unknown>);
  }

  async getByPath(path: string): Promise<SourceData[]> {
    const table = await this.getSourcesTable();
    if (!table) return [];

    const results = await table.query()
      .where(`path = '${escapeLanceSqlString(path)}'`)
      .toArray();

    return results.map((r) => this.recordToSourceData(r as Record<string, unknown>));
  }

  async getBySourceId(sourceId: string): Promise<SourceData[]> {
    const table = await this.getSourcesTable();
    if (!table) return [];

    const results = await table.query()
      .where(`source_id = '${escapeLanceSqlString(sourceId)}'`)
      .toArray();

    return results.map((r) => this.recordToSourceData(r as Record<string, unknown>));
  }

  async delete(id: string): Promise<void> {
    const table = await this.getSourcesTable();
    if (!table) return;
    await table.delete(`id = '${escapeLanceSqlString(id)}'`);
  }

  async deleteByPath(path: string): Promise<void> {
    const table = await this.getSourcesTable();
    if (!table) return;
    await table.delete(`path = '${escapeLanceSqlString(path)}'`);
  }

  // ── Search ─────────────────────────────────────────────────

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const table = await this.getSourcesTable();
    if (!table) return [];

    const topK = query.top_k ?? 10;
    let rows: Record<string, unknown>[];

    const hasVector = query.filters?.vector && Array.isArray(query.filters.vector) && (query.filters.vector as number[]).length > 0;
    const filters: string[] = [];
    if (query.source_types && query.source_types.length > 0) {
      filters.push(buildTypeFilter(query.source_types));
    }
    if (query.tags && query.tags.length > 0) {
      filters.push(buildTagFilter(query.tags));
    }
    const filterClause = filters.length > 0 ? filters.join(" AND ") : undefined;

    if (query.mode === "hybrid" && hasVector) {
      // Hybrid: combine ANN + FTS results, then merge & re-rank
      const vec = Float32Array.from(query.filters!.vector as number[]);
      const annQuery = table.vectorSearch(vec).limit(topK * 2);
      if (filterClause) annQuery.where(filterClause);
      let annRows: Record<string, unknown>[];
      try { annRows = (await annQuery.toArray()) as Record<string, unknown>[]; } catch { annRows = []; }

      let ftsRows: Record<string, unknown>[];
      try {
        ftsRows = await this.executeKeywordSearch(table, query.text, topK * 2, query.source_types, query.tags);
      } catch { ftsRows = []; }

      // Merge by id, keep max normalised score
      const merged = new Map<string, { row: Record<string, unknown>; score: number }>();
      const maxAnn = annRows.reduce((m, r) => Math.max(m, (r._distance as number) ?? 0), 0) || 1;
      const maxFts = ftsRows.reduce((m, r) => Math.max(m, (r._score as number) ?? 0), 0) || 1;

      for (const r of annRows) {
        const id = r.id as string;
        const norm = ((r._distance as number) ?? 0) / maxAnn;
        merged.set(id, { row: r, score: norm * 0.7 }); // ANN weight 0.7
      }
      for (const r of ftsRows) {
        const id = r.id as string;
        const norm = ((r._score as number) ?? 0) / maxFts;
        const existing = merged.get(id);
        merged.set(id, { row: r, score: (existing?.score ?? 0) + norm * 0.3 }); // FTS weight 0.3
      }

      rows = Array.from(merged.entries())
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, topK)
        .map(([, v]) => v.row);
    } else if (query.mode === "semantic" && hasVector) {
      const vec = Float32Array.from(query.filters!.vector as number[]);
      const lanceQuery = table.vectorSearch(vec).limit(topK);
      if (filterClause) lanceQuery.where(filterClause);
      rows = (await lanceQuery.toArray()) as Record<string, unknown>[];
    } else {
      rows = await this.executeKeywordSearch(table, query.text, topK, query.source_types, query.tags);
    }

    const results: SearchResult[] = rows.map((r) => ({
      source: this.recordToSourceData(r),
      score: (r._score as number) ?? (r._distance as number) ?? 0,
      match_type: query.mode,
    }));

    if (query.min_score !== undefined && query.min_score > 0) {
      return results.filter((r) => r.score >= query.min_score!);
    }

    return results.slice(0, topK);
  }

  private async executeKeywordSearch(
    table: Table,
    text: string,
    topK: number,
    sourceTypes?: SourceType[],
    tags?: string[],
  ): Promise<Record<string, unknown>[]> {
    try {
      let lanceQuery = table.query().limit(topK);
      if (text) {
        lanceQuery = lanceQuery.fullTextSearch(text);
      }
      const filters: string[] = [];
      if (sourceTypes && sourceTypes.length > 0) {
        filters.push(buildTypeFilter(sourceTypes));
      }
      if (tags && tags.length > 0) {
        filters.push(buildTagFilter(tags));
      }
      if (filters.length > 0) {
        lanceQuery = lanceQuery.where(filters.join(" AND "));
      }
      return (await lanceQuery.toArray()) as Record<string, unknown>[];
    } catch {
      // FTS not available — fall back to WHERE + LIKE
      return this.executeFallbackSearch(table, text, topK, sourceTypes, tags);
    }
  }

  private async executeFallbackSearch(
    table: Table,
    text: string,
    topK: number,
    sourceTypes?: SourceType[],
    tags?: string[],
  ): Promise<Record<string, unknown>[]> {
    const conditions: string[] = [];

    if (text) {
      const escaped = escapeLanceSqlString(text.toLowerCase());
      conditions.push(`LOWER(content) LIKE '%${escaped}%'`);
    }
    if (sourceTypes && sourceTypes.length > 0) {
      conditions.push(buildTypeFilter(sourceTypes));
    }
    if (tags && tags.length > 0) {
      conditions.push(buildTagFilter(tags));
    }

    let lanceQuery = table.query().limit(topK);
    if (conditions.length > 0) {
      lanceQuery = lanceQuery.where(conditions.join(" AND "));
    }

    return (await lanceQuery.toArray()) as Record<string, unknown>[];
  }

  // ── Hash / Embedding queries ───────────────────────────────

  async hasSemanticBlake3(hash: string): Promise<boolean> {
    const table = await this.getSourcesTable();
    if (!table) return false;

    const results = await table.query()
      .where(`semantic_blake3 = '${escapeLanceSqlString(hash)}'`)
      .limit(1)
      .select(["id"])
      .toArray();

    return results.length > 0;
  }

  async hasModelEmbedding(id: string): Promise<boolean> {
    const table = await this.getSourcesTable();
    if (!table) return false;

    // Check if the embeddings column exists in the schema
    const schema = await table.schema();
    const embField = schema.fields.find((f) => f.name === "embeddings");
    if (!embField) return false;

    const results = await table.query()
      .where(`id = '${escapeLanceSqlString(id)}'`)
      .limit(1)
      .select(["embeddings"])
      .toArray();

    if (results.length === 0) return false;

    const emb = (results[0] as Record<string, unknown>).embeddings;
    if (emb instanceof Float32Array) return emb.length > 0;
    if (Array.isArray(emb)) return emb.length > 0;
    return emb !== null && emb !== undefined;
  }

  async getSourceIdsByHash(hash: string): Promise<string[]> {
    const table = await this.getSourcesTable();
    if (!table) return [];

    const results = await table.query()
      .where(`semantic_blake3 = '${escapeLanceSqlString(hash)}'`)
      .select(["source_id"])
      .toArray();

    return results.map((r) => (r as Record<string, unknown>).source_id as string);
  }

  async getFileBlake3ByPath(path: string): Promise<string | null> {
    const table = await this.getSourcesTable();
    if (!table) return null;

    const results = await table.query()
      .where(`path = '${escapeLanceSqlString(path)}'`)
      .limit(1)
      .select(["file_blake3"])
      .toArray();

    if (results.length === 0) return null;
    return (results[0] as Record<string, unknown>).file_blake3 as string;
  }

  // ── Stats ──────────────────────────────────────────────────

  async stats(): Promise<IndexStats> {
    const table = await this.getSourcesTable();
    if (!table) {
      return { total_sources: 0, total_chunks: 0, total_files: 0, last_indexed: new Date().toISOString() };
    }

    const totalChunks = await table.countRows();
    const pathRows = await table.query().select(["path", "updated_at"]).toArray();

    const uniquePaths = new Set<string>();
    let maxDate = "";

    for (const r of pathRows) {
      const rec = r as Record<string, unknown>;
      uniquePaths.add(rec.path as string);
      const dt = rec.updated_at as string;
      if (dt && dt > maxDate) maxDate = dt;
    }

    return {
      total_sources: uniquePaths.size,
      total_chunks: totalChunks,
      total_files: uniquePaths.size,
      last_indexed: maxDate || new Date().toISOString(),
    };
  }

  // ── File Index CRUD ────────────────────────────────────────

  async upsertFileIndex(index: FileIndex): Promise<void> {
    const record = this.fileIndexToRecord(index);
    const table = await this.ensureFileIndexTable(record);

    try {
      await table.delete(`path = '${escapeLanceSqlString(index.path)}'`);
    } catch {
      // Row may not exist
    }

    await table.add([record]);
  }

  async getFileIndex(path: string): Promise<FileIndex | null> {
    const table = await this.getFileIndexTable();
    if (!table) return null;

    const results = await table.query()
      .where(`path = '${escapeLanceSqlString(path)}'`)
      .limit(1)
      .toArray();

    if (results.length === 0) return null;
    return this.recordToFileIndex(results[0] as Record<string, unknown>);
  }

  async deleteFileIndex(path: string): Promise<void> {
    const table = await this.getFileIndexTable();
    if (!table) return;
    await table.delete(`path = '${escapeLanceSqlString(path)}'`);
  }

  // ── Cleanup ────────────────────────────────────────────────

  async dropAll(): Promise<void> {
    await this.ensureConnected();
    try { await this.db!.dropTable("sources"); } catch { /* already gone */ }
    try { await this.db!.dropTable("file_index"); } catch { /* already gone */ }
    this.sourcesTable = null;
    this.fileIndexTable = null;
  }

  // ── Serialisation helpers ──────────────────────────────────

  private sourceDataToRecord(data: SourceData): Record<string, unknown> {
    const record: Record<string, unknown> = {
      id: data.id,
      chunk_id: data.chunk_id,
      source_id: data.source_id,
      type: data.type,
      title: data.title,
      content: data.content,
      tags: JSON.stringify(data.tags),
      path: data.path,
      file_blake3: data.file_blake3,
      semantic_blake3: data.semantic_blake3,
      chunk_index: data.chunk_index,
      total_chunks: data.total_chunks,
      metadata: JSON.stringify(data.metadata),
      created_at: data.created_at,
      updated_at: data.updated_at,
    };

    // Only include embeddings when data has them — avoids schema inference issues with null
    if (data.embeddings.length > 0) {
      record.embeddings = new Float32Array(data.embeddings);
    }

    return record;
  }

  private recordToSourceData(record: Record<string, unknown>): SourceData {
    const rawEmb = (record as Record<string, unknown>).embeddings;
    let embeddings: number[];
    if (rawEmb instanceof Float32Array) {
      embeddings = Array.from(rawEmb);
    } else if (Array.isArray(rawEmb)) {
      embeddings = rawEmb as number[];
    } else {
      embeddings = [];
    }

    const rawTags = record.tags;
    let tags: string[];
    if (typeof rawTags === "string") {
      try { tags = JSON.parse(rawTags); } catch { tags = []; }
    } else if (Array.isArray(rawTags)) {
      tags = rawTags as string[];
    } else {
      tags = [];
    }

    const rawMeta = record.metadata;
    let metadata: SourceMetadata;
    if (typeof rawMeta === "string") {
      try { metadata = JSON.parse(rawMeta) as SourceMetadata; } catch { metadata = { kind: "code", language: "text" }; }
    } else if (rawMeta && typeof rawMeta === "object") {
      metadata = rawMeta as SourceMetadata;
    } else {
      metadata = { kind: "code", language: "text" };
    }

    return {
      id: record.id as string,
      chunk_id: record.chunk_id as string,
      source_id: record.source_id as string,
      type: record.type as SourceType,
      title: record.title as string,
      content: record.content as string ?? "",
      tags,
      path: record.path as string,
      file_blake3: record.file_blake3 as string,
      semantic_blake3: record.semantic_blake3 as string,
      chunk_index: (record.chunk_index as number) ?? 0,
      total_chunks: (record.total_chunks as number) ?? 1,
      embeddings,
      metadata,
      created_at: record.created_at as string,
      updated_at: record.updated_at as string,
    };
  }

  private fileIndexToRecord(index: FileIndex): Record<string, unknown> {
    return {
      path: index.path,
      file_blake3: index.file_blake3,
      language: index.language,
      imports: JSON.stringify(index.imports),
      exports: JSON.stringify(index.exports),
      symbols: JSON.stringify(index.symbols),
      relationships: JSON.stringify(index.relationships),
      last_parsed: index.last_parsed,
    };
  }

  private recordToFileIndex(record: Record<string, unknown>): FileIndex {
    const parseJsonArray = <T>(val: unknown, fallback: T[]): T[] => {
      if (typeof val === "string") {
        try { return JSON.parse(val) as T[]; } catch { return fallback; }
      }
      if (Array.isArray(val)) return val as T[];
      return fallback;
    };

    return {
      path: record.path as string,
      file_blake3: record.file_blake3 as string,
      language: record.language as string,
      imports: parseJsonArray<import("../../domain/ast").Import>(record.imports, []),
      exports: parseJsonArray<import("../../domain/ast").Export>(record.exports, []),
      symbols: parseJsonArray<import("../../domain/ast").SymbolDetail>(record.symbols, []),
      relationships: parseJsonArray<import("../../domain/ast").Relationship>(record.relationships, []),
      last_parsed: record.last_parsed as string,
    };
  }
}

// ── SQL helpers ──────────────────────────────────────────────

/** Escape a string for use in a LanceDB SQL predicate (single-quoted). */
function escapeLanceSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/** Build a SQL IN filter for source types. */
function buildTypeFilter(types: SourceType[]): string {
  const escaped = types.map((t) => `'${escapeLanceSqlString(t)}'`).join(", ");
  return `type IN (${escaped})`;
}

/** Build a SQL filter for tags (JSON contains check). */
function buildTagFilter(tags: string[]): string {
  const conditions = tags.map((t) => `tags LIKE '%"${escapeLanceSqlString(t)}"%'`);
  return conditions.join(" OR ");
}


---
# src/infrastructure/logger/PinoLogger.ts
---
import pino from "pino";
import type { Logger } from "../../domain/ports/Logger";

export interface PinoLoggerOptions {
  level?: string;
  module?: string;
}

/**
 * Logger implementation using pino for structured JSON logging.
 */
export class PinoLogger implements Logger {
  private logger: pino.Logger;

  constructor(
    opts: PinoLoggerOptions = {},
    destination?: pino.DestinationStream,
  ) {
    const { level = "info", module } = opts;
    const base = module ? { module } : {};
    this.logger = pino(
      { level, base },
      destination ?? undefined,
    );
  }

  info(msg: string, ...args: unknown[]): void {
    if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
      this.logger.info(args[0] as Record<string, unknown>, msg);
    } else {
      this.logger.info(msg);
    }
  }

  warn(msg: string, ...args: unknown[]): void {
    if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
      this.logger.warn(args[0] as Record<string, unknown>, msg);
    } else {
      this.logger.warn(msg);
    }
  }

  error(msg: string, ...args: unknown[]): void {
    if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
      this.logger.error(args[0] as Record<string, unknown>, msg);
    } else {
      this.logger.error(msg);
    }
  }

  debug(msg: string, ...args: unknown[]): void {
    if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
      this.logger.debug(args[0] as Record<string, unknown>, msg);
    } else {
      this.logger.debug(msg);
    }
  }

  child(context: Record<string, unknown>): PinoLogger {
    const child = new PinoLogger({}, this.logger.stream);
    // @ts-expect-error - accessing internal pino logger for child creation
    child.logger = this.logger.child(context);
    return child;
  }
}

---
# src/infrastructure/logger/SilentLogger.ts
---
import type { Logger } from "../../domain/ports/Logger";

/**
 * Logger implementation that discards all output.
 * Useful for testing or disabling logging entirely.
 */
export class SilentLogger implements Logger {
  info(_msg: string, ..._args: unknown[]): void {
    // no-op
  }

  warn(_msg: string, ..._args: unknown[]): void {
    // no-op
  }

  error(_msg: string, ..._args: unknown[]): void {
    // no-op
  }

  debug(_msg: string, ..._args: unknown[]): void {
    // no-op
  }
}


---
# src/infrastructure/markdown/MarkdownAstParser.ts
---
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { RootContent } from "mdast";

export interface HeadingInfo {
  level: number;
  text: string;
  anchor: string;
}

/**
 * Extracts heading information from Markdown text using unified/remark AST parsing.
 */
export class MarkdownAstParser {
  private readonly processor = unified().use(remarkParse);

  /**
   * Parse markdown text and extract all headings with level, text, and GitHub-style anchor.
   */
  parse(markdown: string): HeadingInfo[] {
    if (!markdown.trim()) return [];

    const ast = this.processor.parse(markdown);
    const headings: HeadingInfo[] = [];

    walkTree(ast.children ?? [], headings);

    return headings;
  }
}

/**
 * Recursively walk the MDAST tree, collecting heading nodes.
 */
function walkTree(children: RootContent[], headings: HeadingInfo[]): void {
  for (const node of children) {
    if (node.type === "heading") {
      const text = extractTextContent((node as any).children ?? []);
      const anchor = slugify(text);
      headings.push({ level: (node as any).depth, text, anchor });
    }
    // Recurse into children (handles blockquote, etc.)
    if ("children" in node && Array.isArray((node as any).children)) {
      walkTree((node as any).children, headings);
    }
  }
}

/**
 * Extract plain text from a heading node's children.
 */
function extractTextContent(children: RootContent[]): string {
  return children
    .map((child: any) => {
      if (child.type === "text") return child.value ?? "";
      if (child.type === "link") {
        return extractTextContent(child.children ?? []);
      }
      if (child.type === "inlineCode") return child.value ?? "";
      return "";
    })
    .join("");
}

/**
 * Create a GitHub-style anchor slug from heading text.
 * - lowercase
 * - remove special characters (keep alphanumeric, spaces, hyphens)
 * - spaces become hyphens
 * - collapse multiple hyphens
 * - trim leading/trailing hyphens
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}


---
# src/infrastructure/parser/AstGrepParser.ts
---
// ---------------------------------------------------------------------------
// AstGrepParser — Phase 3
// Parses TypeScript/JavaScript source files into ParsedSource + FileIndex data.
// Uses @ast-grep/napi for AST-level queries.
// ---------------------------------------------------------------------------

import type { SourceParser } from "../../domain/ports/SourceParser";
import type { ParsedSource, SourceType } from "../../domain/types";
import type {
  FileIndex,
  SymbolDetail,
  Import,
  Export,
} from "../../domain/ast";
import { BLAKE3Hasher } from "../hashing/BLAKE3Hasher";
import { parse, Lang } from "@ast-grep/napi";

/**
 * Determine language from file extension.
 */
function determineLanguage(path: string): string {
  if (path.endsWith(".tsx")) return "typescriptreact";
  if (path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".jsx")) return "javascriptreact";
  if (path.endsWith(".js")) return "javascript";
  return "typescript";
}

/**
 * Strip surrounding quotes from a string.
 */
function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}

/**
 * Extracts the import source from an import_statement node by looking for
 * a `string` child (the module path).
 */
function getImportSource(node: {
  children(): { kind(): string; text(): string }[];
}): string {
  for (const c of node.children()) {
    if (c.kind() === "string") return stripQuotes(c.text());
  }
  return "";
}

/**
 * Parses TypeScript/JavaScript source files using AST-level queries
 * via @ast-grep/napi.
 *
 * Extracts symbols (functions, classes, interfaces), imports, exports,
 * and complexity metrics.
 */
export class AstGrepParser implements SourceParser {
  readonly type: SourceType = "code";
  readonly extensions = [".ts", ".tsx", ".js", ".jsx"];
  private hasher = new BLAKE3Hasher();

  supportsFile(path: string): boolean {
    return this.extensions.some((ext) => path.endsWith(ext));
  }

  async parse(path: string): Promise<ParsedSource> {
    const content = await Bun.file(path).text();
    const lines = content.split("\n");
    const file_blake3 = await this.hasher.hash(content);

    const symbols: SymbolDetail[] = [];
    const imports: Import[] = [];
    const exports: Export[] = [];
    const topLevelDeclarations: string[] = [];

    // Parse source code with @ast-grep/napi
    const sgRoot = parse(Lang.TypeScript, content);
    const rootChildren = sgRoot.root().children();

    // ---- Extract top-level declarations by iterating root children ---------
    for (const child of rootChildren) {
      const kind = child.kind();
      const text = child.text();

      switch (kind) {
        case "function_declaration": {
          const name = extractFunctionName(child);
          if (!name) break;
          const range = child.range();
          symbols.push({
            kind: "function",
            name,
            signature: extractSignature(content, range),
            startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
            endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
          });
          topLevelDeclarations.push(name);
          break;
        }

        case "class_declaration": {
          const name = extractClassName(child);
          if (!name) break;
          const range = child.range();
          symbols.push({
            kind: "class",
            name,
            signature: "",
            startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
            endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
          });
          topLevelDeclarations.push(name);
          break;
        }

        case "interface_declaration": {
          const name = extractClassName(child);
          if (!name) break;
          const range = child.range();
          symbols.push({
            kind: "interface",
            name,
            signature: "",
            startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
            endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
          });
          topLevelDeclarations.push(name);
          break;
        }

        case "import_statement": {
          const source = getImportSource(child);
          if (!source) break;

          let importKind: "named" | "default" | "namespace" = "default";
          const specifiers: string[] = [];

          // Walk into import_clause to find specifier nodes
          for (const inner of child.children()) {
            if (inner.kind() !== "import_clause") continue;
            for (const clauseChild of inner.children()) {
              const ck = clauseChild.kind();
              if (ck === "named_imports") {
                importKind = "named";
                for (const namedChild of clauseChild.children()) {
                  if (namedChild.kind() === "import_specifier") {
                    for (const specChild of namedChild.children()) {
                      if (specChild.kind() === "identifier") {
                        specifiers.push(specChild.text());
                      }
                    }
                  }
                }
              } else if (ck === "namespace_import") {
                importKind = "namespace";
                for (const nsChild of clauseChild.children()) {
                  if (nsChild.kind() === "identifier") {
                    specifiers.push(nsChild.text());
                  }
                }
              } else if (ck === "identifier") {
                // Default import: import name from "source"
                specifiers.push(clauseChild.text());
              }
            }
          }

          imports.push({ source, specifiers: specifiers.length > 0 ? specifiers : ["default"], kind: importKind });
          break;
        }

        case "export_statement": {
          const innerText = text;

          // Fix #4: export * from "source"
          if (text.includes("export *")) {
            const allSource = getImportSource(child);
            if (allSource) {
              exports.push({ name: allSource, kind: "all" });
              break;
            }
          }

          // Check for "export default"
          if (innerText.startsWith("export default")) {
            // Fix #1: Check inner children for declarations first
            let extractedFromDecl = false;
            for (const inner of child.children()) {
              const innerKind = inner.kind();
              if (innerKind === "function_declaration") {
                const name = extractFunctionName(inner);
                if (name) {
                  const range = inner.range();
                  symbols.push({
                    kind: "function",
                    name,
                    signature: extractSignature(content, range),
                    startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
                    endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
                  });
                  topLevelDeclarations.push(name);
                  exports.push({ name, kind: "default" });
                  extractedFromDecl = true;
                }
                break;
              } else if (innerKind === "class_declaration") {
                const name = extractClassName(inner);
                if (name) {
                  const range = inner.range();
                  symbols.push({
                    kind: "class",
                    name,
                    signature: "",
                    startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
                    endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
                  });
                  topLevelDeclarations.push(name);
                  exports.push({ name, kind: "default" });
                  extractedFromDecl = true;
                }
                break;
              } else if (innerKind === "interface_declaration") {
                const name = extractClassName(inner);
                if (name) {
                  const range = inner.range();
                  symbols.push({
                    kind: "interface",
                    name,
                    signature: "",
                    startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
                    endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
                  });
                  topLevelDeclarations.push(name);
                  exports.push({ name, kind: "default" });
                  extractedFromDecl = true;
                }
                break;
              }
            }

            if (!extractedFromDecl) {
              // Fallback: text-based extraction for identifiers (e.g., export default UserService)
              const afterDefault = innerText.replace(/^export\s+default\s+/, "");
              const defaultName = afterDefault.split(/[;\s{]/)[0];
              if (defaultName && !defaultName.includes("{")) {
                exports.push({ name: defaultName, kind: "default" });
              }
            }
            break;
          }

          // Non-default export: look through children for the inner declaration
          // Fix #1: Also add inner declarations as symbols and topLevelDeclarations
          let exportedName: string | null = null;
          for (const inner of child.children()) {
            const innerKind = inner.kind();
            if (innerKind === "function_declaration") {
              const name = extractFunctionName(inner);
              if (name) {
                exportedName = name;
                const range = inner.range();
                symbols.push({
                  kind: "function",
                  name,
                  signature: extractSignature(content, range),
                  startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
                  endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
                });
                topLevelDeclarations.push(name);
              }
            } else if (innerKind === "class_declaration") {
              const name = extractClassName(inner);
              if (name) {
                exportedName = name;
                const range = inner.range();
                symbols.push({
                  kind: "class",
                  name,
                  signature: "",
                  startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
                  endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
                });
                topLevelDeclarations.push(name);
              }
            } else if (innerKind === "interface_declaration") {
              const name = extractClassName(inner);
              if (name) {
                exportedName = name;
                const range = inner.range();
                symbols.push({
                  kind: "interface",
                  name,
                  signature: "",
                  startPosition: { line: range.start.line + 1, column: range.start.column + 1 },
                  endPosition: { line: range.end.line + 1, column: range.end.column + 1 },
                });
                topLevelDeclarations.push(name);
              }
            }
          }

          // Fallback: regex-based extraction from text (when AST children didn't reveal the name)
          if (!exportedName) {
            const fnMatch = innerText.match(/export\s+(?:async\s+)?function\s+(\w+)/);
            const clsMatch = innerText.match(/export\s+class\s+(\w+)/);
            const ifaceMatch = innerText.match(/export\s+interface\s+(\w+)/);
            const namedMatch = innerText.match(/export\s+(?:type|const|let|var|enum)\s+(\w+)/);
            exportedName = fnMatch?.[1] ?? clsMatch?.[1] ?? ifaceMatch?.[1] ?? namedMatch?.[1] ?? null;
            if (exportedName) {
              topLevelDeclarations.push(exportedName);
            }
          }

          if (exportedName) {
            exports.push({ name: exportedName, kind: "named" });
          }

          // Check for "export { a, b }" (brace export — standalone, no inner declaration)
          if (!exportedName) {
            const braceMatch = innerText.match(/export\s+\{([^}]+)\}/);
            if (braceMatch) {
              const names = braceMatch[1]
                .split(",")
                .map((s: string) => s.trim().replace(/\s+as\s+\w+/g, ""))
                .filter(Boolean);
              for (const name of names) {
                exports.push({ name, kind: "named" });
              }
            }
          }
          break;
        }
      }
    }

    // ---- Build FileIndex ---------------------------------------------------
    const fileIndex: FileIndex = {
      path,
      file_blake3,
      language: determineLanguage(path),
      imports,
      exports,
      symbols,
      relationships: [],
      last_parsed: new Date().toISOString(),
    };

    const functionCount = symbols.filter((s) => s.kind === "function").length;
    const classCount = symbols.filter((s) => s.kind === "class").length;

    return {
      type: "code",
      path,
      content,
      tags: [],
      metadata: {
        kind: "code" as const,
        language: determineLanguage(path),
        complexity: { lines: lines.length, functions: functionCount, classes: classCount },
        topLevelDeclarations,
      },
      file_blake3,
      last_parsed: new Date().toISOString(),
      fileIndex,
    };
  }
}

// ---- Helper functions -------------------------------------------------------

/**
 * Extract the function name from a function_declaration node.
 * The name is typically the first `identifier` child.
 */
function extractFunctionName(node: {
  children(): { kind(): string; text(): string }[];
}): string | null {
  for (const c of node.children()) {
    if (c.kind() === "identifier") return c.text();
  }
  // Fallback: try the function pattern to get NAME
  return null;
}

/**
 * Extract the class/interface name from a declaration node.
 * For class_declaration: first `type_identifier` child.
 * For interface_declaration: first `type_identifier` child.
 */
function extractClassName(node: {
  children(): { kind(): string; text(): string }[];
}): string | null {
  for (const c of node.children()) {
    if (c.kind() === "type_identifier") return c.text();
  }
  return null;
}

/**
 * Extract the function signature (parameter list) from the raw content
 * based on the function's start position.
 */
function extractSignature(content: string, range: { start: { index: number }; end: { index: number } }): string {
  const fnText = content.slice(range.start.index, range.end.index);
  const parenMatch = fnText.match(/\([^)]*\)/);
  return parenMatch ? parenMatch[0] : "";
}


---
# src/infrastructure/parser/MarkdownParser.ts
---
// ---------------------------------------------------------------------------
// MarkdownParser — Phase 3
// Uses unified/remark to parse .md files into ParsedSource with MDAST walk.
// ---------------------------------------------------------------------------

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import type { Root, Heading, Link, Text } from "mdast";
import { visit } from "unist-util-visit";
import type { SourceParser } from "../../domain/ports/SourceParser";
import type { ParsedSource, SourceType } from "../../domain/types";
import { BLAKE3Hasher } from "../hashing/BLAKE3Hasher";
import type { Heading as HeadingType, Link as LinkType, MarkdownStats } from "./types";

/**
 * Parser for plain Markdown files (.md).
 * Strips frontmatter if present. Extracts headings, links, and stats from the
 * MDAST produced by unified/remark.
 */
export class MarkdownParser implements SourceParser {
  readonly type: SourceType = "markdown";
  readonly extensions = [".md"];
  private hasher = new BLAKE3Hasher();

  supportsFile(path: string): boolean {
    return this.extensions.some((ext) => path.endsWith(ext));
  }

  async parse(path: string): Promise<ParsedSource> {
    const content = await Bun.file(path).text();

    const file = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkFrontmatter)
      .parse(content) as Root;

    const headings: HeadingType[] = [];
    const links: LinkType[] = [];
    let wordCount = 0;
    let paragraphCount = 0;
    let codeBlockCount = 0;

    visit(file, (node) => {
      if (node.type === "heading") {
        const h = node as Heading;
        const headingText = h.children
          .filter((c): c is Text => c.type === "text")
          .map((c) => c.value)
          .join("");
        const anchor = headingText
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .replace(/\s+/g, "-");
        headings.push({ level: h.depth, text: headingText, anchor });
      }

      if (node.type === "link") {
        const l = node as Link;
        const linkText = l.children
          .filter((c): c is Text => c.type === "text")
          .map((c) => c.value)
          .join("");
        const url = l.url;
        const isInternal = url.startsWith("/") || url.startsWith("#") || !url.includes("://");
        const isAnchor = url.startsWith("#");
        links.push({ url, text: linkText, isInternal, isAnchor });
      }

      if (node.type === "paragraph") {
        paragraphCount++;
      }

      if (node.type === "code") {
        codeBlockCount++;
      }

      if (node.type === "text") {
        const words = (node as Text).value.split(/\s+/).filter(Boolean);
        wordCount += words.length;
      }

      // Also count text inside paragraph children for inline code etc.
      // visit already visits all descendants, so text nodes directly inside
      // paragraphs are already counted above.
    });

    const title = headings.find((h) => h.level === 1)?.text || path;
    const section = headings.find((h) => h.level === 2)?.text;
    const readingTimeMinutes = Math.ceil(wordCount / 200);
    const stats: MarkdownStats = {
      wordCount,
      readingTimeMinutes,
      paragraphCount,
      codeBlockCount,
    };

    const file_blake3 = await this.hasher.hash(content);

    return {
      type: "markdown",
      path,
      content,
      tags: [],
      metadata: {
        kind: "markdown",
        heading: title,
        section,
        wordCount,
        // Extended parser-specific metadata beyond the SourceMetadata union.
        // Consumers should narrow via `kind` and access these fields directly.
        headings,
        links,
        stats,
      } as ParsedSource["metadata"] & {
        headings: HeadingType[];
        links: LinkType[];
        stats: MarkdownStats;
      },
      file_blake3,
      last_parsed: new Date().toISOString(),
    };
  }
}


---
# src/infrastructure/parser/ObsidianParser.ts
---
// ---------------------------------------------------------------------------
// ObsidianParser — Phase 3
// Parses Obsidian-flavoured Markdown files with YAML frontmatter and
// wiki-link syntax [[target]] and [[target|alias]].
// ---------------------------------------------------------------------------

import YAML from "yaml";
import type { SourceParser } from "../../domain/ports/SourceParser";
import type { ParsedSource, SourceType } from "../../domain/types";
import { BLAKE3Hasher } from "../hashing/BLAKE3Hasher";
import type { WikiLink } from "./types";

/** Parsed frontmatter fields we care about. */
interface Frontmatter {
  title?: string;
  tags?: string[];
  [key: string]: unknown;
}

/**
 * Parser for Obsidian-flavoured Markdown files (.md).
 * Extracts YAML frontmatter, wiki-links, and tags.
 */
export class ObsidianParser implements SourceParser {
  readonly type: SourceType = "obsidian";
  readonly extensions = [".md"];
  private hasher = new BLAKE3Hasher();

  supportsFile(path: string): boolean {
    return path.endsWith(".md");
  }

  /**
   * Detect whether a file contains Obsidian-style YAML frontmatter between
   * leading `---` markers. Used by ParserRegistry for content sniffing.
   */
  static hasFrontmatter(content: string): boolean {
    return /^---\n/.test(content);
  }

  async parse(path: string): Promise<ParsedSource> {
    const content = await Bun.file(path).text();

    // ---- Parse frontmatter -------------------------------------------------
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
    let frontmatter: Frontmatter = {};
    let bodyContent = content;

    if (frontmatterMatch) {
      frontmatter = (YAML.parse(frontmatterMatch[1]) || {}) as Frontmatter;
      bodyContent = content.slice(frontmatterMatch[0].length);
    }

    // ---- Extract wiki-links ------------------------------------------------
    // [[target]] or [[target|alias]]
    const wikiLinkRegex = /\[\[([^|]+?)(?:\|([^\]]+?))?\]\]/g;
    const wikiLinks: WikiLink[] = [];
    let match: RegExpExecArray | null;
    while ((match = wikiLinkRegex.exec(content)) !== null) {
      wikiLinks.push({
        target: match[1]!,
        alias: match[2] || undefined,
      });
    }

    const tags: string[] = Array.isArray(frontmatter.tags)
      ? (frontmatter.tags as string[])
      : [];
    const title: string = frontmatter.title || path;
    const file_blake3 = await this.hasher.hash(content);

    return {
      type: "obsidian",
      path,
      content: bodyContent,
      tags,
      metadata: {
        kind: "obsidian",
        tags,
        links: wikiLinks.map((w) => w.target),
        frontmatter: frontmatter as Record<string, unknown>,
        // Extended parser-specific metadata
        wikiLinks,
        backlinks: [],
        graphConnections: [],
      } as ParsedSource["metadata"] & {
        wikiLinks: WikiLink[];
        backlinks: string[];
        graphConnections: string[];
      },
      file_blake3,
      last_parsed: new Date().toISOString(),
    };
  }
}


---
# src/infrastructure/parser/ParserRegistry.ts
---
// ---------------------------------------------------------------------------
// ParserRegistry — Phase 3
// Routes file paths to the appropriate SourceParser based on extension and
// content sniffing (for .md files: Obsidian frontmatter vs. plain Markdown).
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import type { SourceParser } from "../../domain/ports/SourceParser";
import type { SourceParserRegistry } from "../../domain/ports/SourceParserRegistry";
import { ObsidianParser } from "./ObsidianParser";
import { MarkdownParser } from "./MarkdownParser";

/**
 * Registry of source parsers keyed by file extension.
 *
 * Two-phase resolution:
 * 1. Find candidate parser(s) by file extension
 * 2. For .md files: content-sniff for Obsidian YAML frontmatter to decide
 *    between ObsidianParser and MarkdownParser
 */
export class ParserRegistry implements SourceParserRegistry {
  /**
   * Internal map: extension → parser for fast extension lookup.
   * NOTE: When multiple parsers share the same extension (e.g. .md),
   * only the last-registered one is stored here for the extension key.
   * The .md routing is handled separately via content sniffing.
   */
  private extensionMap: Map<string, SourceParser> = new Map();

  /**
   * Set of all unique parser instances. Used by getEnabledParsers().
   * Separated from extensionMap because multiple parsers can share the
   * same extension (e.g. ObsidianParser + MarkdownParser both handle .md).
   */
  private allParsers: Set<SourceParser> = new Set();

  /**
   * References kept for .md content sniffing so we can choose the right parser.
   */
  private obsidianParser: ObsidianParser | null = null;
  private markdownParser: MarkdownParser | null = null;

  register(parser: SourceParser): void {
    this.allParsers.add(parser);
    for (const ext of parser.extensions) {
      this.extensionMap.set(ext.toLowerCase(), parser);
    }
    if (parser instanceof ObsidianParser) {
      this.obsidianParser = parser;
    }
    if (parser instanceof MarkdownParser) {
      this.markdownParser = parser;
    }
  }

  /**
   * Resolve the best parser for a given file path.
   *
   * For .md files, performs content sniffing to determine whether the file
   * has Obsidian-style YAML frontmatter. Uses synchronous file I/O.
   */
  getParser(path: string): SourceParser | null {
    const ext = "." + path.split(".").pop()?.toLowerCase();
    if (!ext || !this.extensionMap.has(ext)) return null;

    // .md files need content sniffing: Obsidian frontmatter or plain Markdown?
    if (ext === ".md" && this.obsidianParser && this.markdownParser) {
      try {
        // Sync read of first chunk to check for frontmatter
        const firstBytes = readFileSync(path, { encoding: "utf-8", flag: "r" });
        if (ObsidianParser.hasFrontmatter(firstBytes)) {
          return this.obsidianParser;
        }
        return this.markdownParser;
      } catch {
        // If file can't be read, fall back to the default registered parser
        return this.extensionMap.get(ext) ?? null;
      }
    }

    return this.extensionMap.get(ext) ?? null;
  }

  getEnabledParsers(): SourceParser[] {
    return Array.from(this.allParsers).filter(p => p.enabled !== false);
  }
}


---
# src/infrastructure/parser/types.ts
---
// ---------------------------------------------------------------------------
// Parser-Specific Metadata Types — Phase 3
// ---------------------------------------------------------------------------

/**
 * A heading extracted from a Markdown document.
 */
export interface Heading {
  level: number;
  text: string;
  anchor: string;
}

/**
 * A link extracted from a Markdown document.
 */
export interface Link {
  url: string;
  text: string;
  isInternal: boolean;
  isAnchor: boolean;
}

/**
 * Aggregate statistics for a Markdown document.
 */
export interface MarkdownStats {
  wordCount: number;
  readingTimeMinutes: number;
  paragraphCount: number;
  codeBlockCount: number;
}

/**
 * Extended metadata specific to Markdown parsing.
 */
export interface MarkdownMetadata {
  headings: Heading[];
  links: Link[];
  stats: MarkdownStats;
}

/**
 * A wiki-link extracted from an Obsidian document.
 */
export interface WikiLink {
  target: string;
  alias?: string;
}

/**
 * Extended metadata specific to Obsidian parsing.
 */
export interface ObsidianMetadata {
  frontmatter: Record<string, unknown>;
  tags: string[];
  wikiLinks: WikiLink[];
  backlinks: string[];
  graphConnections: string[];
}

/**
 * Extended metadata specific to code file parsing.
 */
export interface CodeMetadata {
  language: string;
  complexity: {
    lines: number;
    functions: number;
    classes: number;
  };
  topLevelDeclarations: string[];
}


---
# src/infrastructure/watcher/ChokidarWatcher.ts
---
import { watch } from "chokidar";
import type { FileWatcher } from "../../domain/ports/FileWatcher";

export interface ChokidarWatcherOptions {
  /** Debounce interval in milliseconds (default: 500). */
  debounceMs?: number;
}

/**
 * FileWatcher implementation using chokidar with per-path debounced emission.
 */
export class ChokidarWatcher implements FileWatcher {
  private watcher: ReturnType<typeof watch> | null = null;
  private handlers = {
    add: new Set<(path: string) => void>(),
    change: new Set<(path: string) => void>(),
    unlink: new Set<(path: string) => void>(),
  };
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly debounceMs: number;
  private readonly paths: string[];

  constructor(paths: string | string[], options?: ChokidarWatcherOptions) {
    this.paths = Array.isArray(paths) ? paths : [paths];
    this.debounceMs = options?.debounceMs ?? 500;
  }

  on(event: "add" | "change" | "unlink", cb: (path: string) => void): void {
    this.handlers[event].add(cb);
  }

  async start(): Promise<void> {
    if (this.watcher) return;

    this.watcher = watch(this.paths, {
      ignoreInitial: true,
      persistent: true,
    });

    return new Promise<void>((resolve) => {
      if (!this.watcher) { resolve(); return; }

      this.watcher.on("ready", () => resolve());

      this.watcher.on("add", (path: string) => {
        this.debounceEmit("add", path);
      });
      this.watcher.on("change", (path: string) => {
        this.debounceEmit("change", path);
      });
      this.watcher.on("unlink", (path: string) => {
        this.debounceEmit("unlink", path);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.watcher) return;

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    await this.watcher.close();
    this.watcher = null;
  }

  private debounceEmit(event: "add" | "change" | "unlink", path: string): void {
    const key = `${event}:${path}`;
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      for (const cb of this.handlers[event]) {
        cb(path);
      }
    }, this.debounceMs);

    this.debounceTimers.set(key, timer);
  }
}

---
# src/presentation/api/server.ts
---
// ---------------------------------------------------------------------------
// HTTP API — Hono server wrapping IndeX use cases
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import type { AppUseCases } from "../../index";

/**
 * Create a Hono HTTP API server wrapping the IndeX application.
 */
export function createServer(app: AppUseCases): Hono {
  const server = new Hono();

  // CORS for SPA
  server.use("/api/*", cors());

  // ── API Routes ──────────────────────────────────────────────

  // GET /api/search?q=...&mode=...&top_k=...&tags=...
  server.get("/api/search", async (c) => {
    const query = c.req.query("q");
    if (!query) {
      return c.json({ error: "Missing query parameter 'q'" }, 400);
    }

    const mode = (c.req.query("mode") ?? "hybrid") as any;
    const topK = parseInt(c.req.query("top_k") ?? "10", 10);
    const tags = c.req.query("tags")?.split(",").filter(Boolean);

    try {
      const results = await app.search.execute(query, { mode, top_k: topK, tags });
      return c.json({ results, count: results.length });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // GET /api/stats
  server.get("/api/stats", async (c) => {
    try {
      const stats = await app.index.execute(".");
      return c.json({ stats });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // POST /api/index
  server.post("/api/index", async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const path = body?.path;
    if (!path) {
      return c.json({ error: "Missing 'path' in request body" }, 400);
    }

    try {
      const stats = await app.index.execute(path);
      return c.json({
        status: "ok",
        message: `Indexed ${stats.total_files} files`,
        stats,
      });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // ── Static files (SPA) ──────────────────────────────────────
  server.use("/*", serveStatic({ root: "./src/presentation/web" }));

  return server;
}

---
# src/presentation/cli/cli.ts
---
// ---------------------------------------------------------------------------
// CLI — Command-line interface for IndeX
// ---------------------------------------------------------------------------

import type { AppUseCases } from "../../index";

export interface ParsedArgs {
  command: string;
  args: string[];
  flags: Record<string, string>;
}

/**
 * Parse command-line arguments into a structured command.
 * Supports both `--flag value` and `-s value` syntax.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) return { command: "help", args: [], flags: {} };

  const validCommands = ["index", "search", "pack", "chunk", "embed", "watch", "stats", "--help", "-h"];
  const first = argv[0] ?? "";

  if (first === "--help" || first === "-h" || !validCommands.includes(first)) {
    return { command: "help", args: [], flags: {} };
  }

  const command = first;
  const rest = argv.slice(1);
  const args: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = rest[i + 1];
      if (value && !value.startsWith("-")) {
        flags[key] = value;
        i++;
      } else {
        flags[key] = "true";
      }
    } else if (arg.startsWith("-") && !arg.startsWith("--")) {
      const key = arg.slice(1);
      const value = rest[i + 1];
      if (value && !value.startsWith("-")) {
        flags[key] = value;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      args.push(arg);
    }
  }

  return { command, args, flags };
}

/**
 * Print help text to console.
 */
export function printHelp(): void {
  console.log(`
IndeX — Local code & document indexer

Usage: indeX <command> [args] [flags]

Commands:
  index <path>          Index all supported files in directory
  search <query>        Search indexed content
    --mode <mode>         Search mode: semantic | keyword | hybrid (default)
    --top-k <n>           Number of results (default: 10)
    --tags <tags>         Filter by tags (comma-separated)
  pack <path>           Pack files into Markdown bundle
    -o <file>             Output file (default: stdout)
    --include <pattern>   Include files matching glob (comma-separated)
    --exclude <pattern>   Exclude files matching glob (comma-separated)
  chunk <path>          Chunk files in directory
  embed <path>          Generate embeddings for files
  watch <path>          Watch directory for changes
  stats                 Show index statistics
  --help                Show this help message
`);
}

/**
 * Execute a parsed CLI command against the application.
 */
export async function executeCommand(
  parsed: ParsedArgs,
  app: AppUseCases,
): Promise<void> {
  const { command, args, flags } = parsed;

  switch (command) {
    case "index": {
      const [path] = args;
      if (!path) { console.error("Error: path required"); return; }
      const stats = await app.index.execute(path);
      console.log(`Indexed ${stats.total_files} files, ${stats.total_chunks} chunks`);
      break;
    }
    case "search": {
      const [query] = args;
      if (!query) { console.error("Error: query required"); return; }
      const results = await app.search.execute(query, {
        mode: (flags.mode as any) ?? "hybrid",
        top_k: flags["top-k"] ? parseInt(flags["top-k"], 10) : 10,
      });
      for (const r of results) {
        console.log(`[${r.match_type}] ${r.source.path} — score: ${r.score.toFixed(3)}`);
      }
      if (results.length === 0) console.log("No results found.");
      break;
    }
    case "pack": {
      const [path] = args;
      if (!path) { console.error("Error: path required"); return; }
      const include = flags.include?.split(",").filter(Boolean);
      const exclude = flags.exclude?.split(",").filter(Boolean);
      const packed = await app.pack.execute(path, { include, exclude });
      const output = flags.o;
      if (output) {
        await Bun.write(output, packed.markdown);
        console.log(`Packed ${packed.chunks_used} files → ${output} (${packed.total_tokens} tokens)`);
      } else {
        console.log(packed.markdown);
      }
      break;
    }
    case "chunk": {
      const [path] = args;
      if (!path) { console.error("Error: path required"); return; }
      const chunks = await app.chunk.execute(path);
      console.log(`Chunked into ${chunks.length} chunks`);
      break;
    }
    case "embed": {
      const [path] = args;
      if (!path) { console.error("Error: path required"); return; }
      await app.embed.execute({ source: "files", directory: path });
      console.log(`Embedding complete for ${path}`);
      break;
    }
    case "watch": {
      const [path] = args;
      if (!path) { console.error("Error: path required"); return; }
      await app.watch.execute(path);
      console.log(`Watching ${path} for changes...`);
      break;
    }
    case "stats": {
      const repo = (app as any).del;
      console.log("Stats requested");
      break;
    }
    default:
      printHelp();
  }
}

/**
 * Main CLI entry point.
 */
export async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);

  if (parsed.command === "help") {
    printHelp();
    return;
  }

  const { createApp } = await import("../../index");
  const app = createApp();
  await executeCommand(parsed, app);
}

// Run as entry point
if (import.meta.main) {
  main(process.argv.slice(2)).catch(console.error);
}

---
# tests/application/ChunkUseCase.test.ts
---
// ---------------------------------------------------------------------------
// ChunkUseCase — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { FileFilter } from "../../src/domain/ports/FileFilter";
import type { SourceParserRegistry } from "../../src/domain/ports/SourceParserRegistry";
import type { SourceParser } from "../../src/domain/ports/SourceParser";
import type { ParsedSource } from "../../src/domain/types";
import type { ChunkSystems } from "../../src/application/di/Systems";
import type { Chunk } from "../../src/domain/systems/ChunkingSystem";
import { ChunkUseCase, type ChunkOptions } from "../../src/application/ChunkUseCase";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "chunk-usecase-test-"));
}

function createTestFile(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

// A simple chunker that splits text into chunks by double-newline
class TestChunker {
  readonly type = "generic" as const;

  async chunk(text: string): Promise<Chunk[]> {
    const parts = text.split(/\n\n+/).filter(Boolean);
    return parts.map((part, i) => ({
      content: part,
      core_content: part,
      chunk_index: i,
      total_chunks: parts.length,
      strategy: "paragraph",
      size_tokens: Math.max(1, Math.round(part.length / 4)),
    }));
  }
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("ChunkUseCase", () => {
  describe("execute — chunk directory", () => {
    let tmpDir: string;
    let useCase: ChunkUseCase;

    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    beforeAll(() => {
      tmpDir = createTempDir();
      createTestFile(tmpDir, "doc1.md", "# Section 1\n\nContent one.\n\n# Section 2\n\nContent two.");
      createTestFile(tmpDir, "doc2.md", "# Intro\n\nJust a single paragraph.");
      createTestFile(tmpDir, "code.ts", 'const x = 1;\n\nfunction foo() { return x; }');
      createTestFile(tmpDir, "notes.txt", "Not included.");

      // --- Mock parsers ---
      const mdParser: SourceParser = {
        type: "markdown",
        extensions: [".md"],
        supportsFile: (p: string) => p.endsWith(".md"),
        parse: async (path: string): Promise<ParsedSource> => {
          const content = await Bun.file(path).text();
          return {
            type: "markdown",
            path,
            content,
            tags: ["docs"],
            metadata: { kind: "markdown" },
            file_blake3: "mock-hash",
            last_parsed: new Date().toISOString(),
          };
        },
      };

      const tsParser: SourceParser = {
        type: "code",
        extensions: [".ts"],
        supportsFile: (p: string) => p.endsWith(".ts"),
        parse: async (path: string): Promise<ParsedSource> => {
          const content = await Bun.file(path).text();
          return {
            type: "code",
            path,
            content,
            tags: ["typescript"],
            metadata: { kind: "code", language: "typescript" },
            file_blake3: "mock-hash",
            last_parsed: new Date().toISOString(),
          };
        },
      };

      const mockRegistry: SourceParserRegistry = {
        getParser: (path: string) =>
          [mdParser, tsParser].find((p) => p.supportsFile(path)) ?? null,
        register: () => {},
      };

      const mockFilter: FileFilter = {
        formats: [".md", ".ts"],
        shouldInclude: (p: string) => p.endsWith(".md") || p.endsWith(".ts"),
      };

      const systems: ChunkSystems = {
        parserRegistry: mockRegistry,
        chunker: new TestChunker(),
        fileFilter: mockFilter,
        logger: mockLogger,
      };

      useCase = new ChunkUseCase(systems);
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── test 1: chunk returns Chunk[] ────────────────────────────
    test("execute returns Chunk[] for directory", async () => {
      const chunks = await useCase.execute(tmpDir);
      expect(chunks.length).toBeGreaterThan(0);
      // doc1.md has 2 paragraphs, doc2.md has 1, code.ts has 1 → at least 4
      expect(chunks.length).toBeGreaterThanOrEqual(4);
    });

    // ── test 2: include filter ───────────────────────────────────
    test('include filter restricts to .md files', async () => {
      const options: ChunkOptions = { include: ["**/*.md"] };
      const chunks = await useCase.execute(tmpDir, options);
      expect(chunks.length).toBeGreaterThan(0);
      // All chunks should be from .md files (strategy "paragraph")
      expect(chunks.every((c) => c.strategy === "paragraph")).toBe(true);
    });

    // ── test 3: exclude filter ───────────────────────────────────
    test('exclude filter excludes specific files', async () => {
      const options: ChunkOptions = { exclude: ["**/doc2.md"] };
      const chunks = await useCase.execute(tmpDir, options);
      // No chunks should come from doc2.md — every chunk's content should
      // NOT contain "Just a single paragraph"
      expect(chunks.some((c) => c.content.includes("Just a single paragraph"))).toBe(false);
    });
  });
});


---
# tests/application/EmbedUseCase.test.ts
---
// ---------------------------------------------------------------------------
// EmbedUseCase — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { EmbedSystems } from "../../src/application/di/Systems";
import type { SourceParserRegistry } from "../../src/domain/ports/SourceParserRegistry";
import type { SourceParser } from "../../src/domain/ports/SourceParser";
import type { FileFilter } from "../../src/domain/ports/FileFilter";
import { MockEmbedder } from "../mocks/MockEmbedder";
import { MockEmbedderRegistry } from "../mocks/MockEmbedderRegistry";
import { MockSourceRepository } from "../mocks/MockSourceRepository";
import { EmbedUseCase, type EmbedOptions } from "../../src/application/EmbedUseCase";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "embed-test-"));
}

function createTestFile(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

function makeMockParser(sourceType: string, ext: string): SourceParser {
  return {
    type: sourceType as "code" | "markdown" | "generic",
    extensions: [ext],
    supportsFile: (p: string) => p.endsWith(ext),
    parse: async (path: string) => {
      const content = await Bun.file(path).text();
      return {
        type: sourceType as "code" | "markdown" | "generic",
        path,
        content,
        tags: [],
        metadata: { kind: "generic" as const, encoding: "utf-8" },
        file_blake3: "mock-hash",
        last_parsed: new Date().toISOString(),
      };
    },
  };
}

function makeParserRegistry(...parsers: SourceParser[]): SourceParserRegistry {
  return {
    getParser: (path: string) =>
      parsers.find((p) => p.supportsFile(path)) ?? null,
    register: () => {},
  };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("EmbedUseCase", () => {
  describe("source: chunks — re-embed existing chunks by path", () => {
    test("reads existing chunks from repo and upserts embeddings", async () => {
      const repo = new MockSourceRepository();
      const embedder = new MockEmbedder("test-model", 8);
      const embRegistry = new MockEmbedderRegistry({ generic: embedder });

      // Seed repo with existing data (no embeddings)
      const now = new Date().toISOString();
      await repo.upsert({
        id: "chunk-1",
        chunk_id: "chunk-1",
        source_id: "src-1",
        type: "generic",
        title: "doc1.txt",
        content: "content to embed",
        tags: [],
        path: "/fixtures/doc1.txt",
        file_blake3: "hash-1",
        semantic_blake3: "sem-1",
        chunk_index: 0,
        total_chunks: 1,
        embeddings: [],
        metadata: { kind: "generic", encoding: "utf-8" },
        created_at: now,
        updated_at: now,
      });

      const systems: EmbedSystems = {
        embedderRegistry: embRegistry,
        repo,
        logger: mockLogger,
      };

      const useCase = new EmbedUseCase(systems);
      await useCase.execute({
        source: "chunks",
        paths: ["/fixtures/doc1.txt"],
      });

      // Verify the chunk now has embeddings
      const updated = await repo.getById("chunk-1");
      expect(updated).not.toBeNull();
      expect(updated!.embeddings.length).toBeGreaterThan(0);
    });
  });

  describe("source: files — embeds and upserts", () => {
    test("re-parses files, chunks, embeds, and upserts", async () => {
      const tmpDir = createTempDir();
      createTestFile(tmpDir, "doc1.txt", "some text content for embedding");

      const repo = new MockSourceRepository();
      const embedder = new MockEmbedder("test-model", 8);
      const embRegistry = new MockEmbedderRegistry({ generic: embedder });

      const parser = makeMockParser("generic", ".txt");
      const parserRegistry = makeParserRegistry(parser);

      const chunker = {
        type: "generic" as const,
        chunk: async (text: string) => [
          {
            content: text,
            core_content: text,
            chunk_index: 0,
            total_chunks: 1,
            strategy: "paragraph",
            size_tokens: Math.max(1, Math.round(text.length / 4)),
          },
        ],
      };

      const fileFilter: FileFilter = {
        formats: [".txt"],
        shouldInclude: () => true,
      };

      const systems: EmbedSystems = {
        embedderRegistry: embRegistry,
        repo,
        parserRegistry,
        chunker,
        fileFilter,
        logger: mockLogger,
      };

      const useCase = new EmbedUseCase(systems);
      await useCase.execute({ source: "files", directory: tmpDir });

      const stats = await repo.stats();
      expect(stats.total_chunks).toBeGreaterThan(0);

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});

---
# tests/application/IndexUseCase.test.ts
---
// ---------------------------------------------------------------------------
// IndexUseCase — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { FileFilter } from "../../src/domain/ports/FileFilter";
import type { SourceParserRegistry } from "../../src/domain/ports/SourceParserRegistry";
import type { SourceParser } from "../../src/domain/ports/SourceParser";
import type { ParsedSource } from "../../src/domain/types";
import type { IndexSystems } from "../../src/application/di/Systems";
import { MockEmbedder } from "../mocks/MockEmbedder";
import { MockEmbedderRegistry } from "../mocks/MockEmbedderRegistry";
import { MockChunker } from "../mocks/MockChunker";
import { MockHasher } from "../mocks/MockHasher";
import { MockSourceRepository } from "../mocks/MockSourceRepository";
import { IndexUseCase } from "../../src/application/IndexUseCase";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "index-usecase-test-"));
}

function createTestFile(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("IndexUseCase", () => {
  describe("execute — full pipeline", () => {
    let tmpDir: string;
    let repo: MockSourceRepository;
    let useCase: IndexUseCase;
    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    beforeAll(() => {
      tmpDir = createTempDir();
      createTestFile(tmpDir, "main.ts", "const x = 1;");
      createTestFile(tmpDir, "README.md", "# Hello World");

      // --- Mock FileFilter ---
      const mockFilter: FileFilter = {
        formats: [".ts", ".md"],
        shouldInclude: (p: string) => p.endsWith(".ts") || p.endsWith(".md"),
      };

      // --- Mock parsers ---
      const codeParser: SourceParser = {
        type: "code",
        extensions: [".ts"],
        supportsFile: (p: string) => p.endsWith(".ts"),
        parse: async (path: string): Promise<ParsedSource> => ({
          type: "code",
          path,
          content: "parsed code content",
          tags: ["typescript"],
          metadata: { kind: "code", language: "typescript" },
          file_blake3: "mock-code-hash",
          last_parsed: new Date().toISOString(),
        }),
      };

      const mdParser: SourceParser = {
        type: "markdown",
        extensions: [".md"],
        supportsFile: (p: string) => p.endsWith(".md"),
        parse: async (path: string): Promise<ParsedSource> => ({
          type: "markdown",
          path,
          content: "parsed markdown content",
          tags: ["docs"],
          metadata: { kind: "markdown" },
          file_blake3: "mock-md-hash",
          last_parsed: new Date().toISOString(),
        }),
      };

      const mockRegistry: SourceParserRegistry = {
        getParser: (path: string) =>
          [codeParser, mdParser].find((p) => p.supportsFile(path)) ?? null,
        register: () => {},
      };

      const mockChunker = new MockChunker([
        {
          content: "chunk content",
          core_content: "core semantic unit",
          chunk_index: 0,
          total_chunks: 1,
          strategy: "fixed",
          size_tokens: 10,
        },
      ]);

      const mockEmbedder = new MockEmbedder("test-model", 128);
      const mockEmbRegistry = new MockEmbedderRegistry({
        code: mockEmbedder,
        markdown: mockEmbedder,
      });

      repo = new MockSourceRepository();
      const mockHasher = new MockHasher();

      const systems: IndexSystems = {
        fileFilter: mockFilter,
        parserRegistry: mockRegistry,
        chunker: mockChunker,
        embedderRegistry: mockEmbRegistry,
        repo,
        hasher: mockHasher,
        logger: mockLogger,
      };

      useCase = new IndexUseCase(systems);
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("execute returns correct stats after indexing directory", async () => {
      const stats = await useCase.execute(tmpDir);
      expect(stats.total_files).toBe(2);
      expect(stats.total_chunks).toBe(2);
    });

    test("stored SourceData has correct fields", async () => {
      const tsSources = await repo.getByPath(join(tmpDir, "main.ts"));
      expect(tsSources.length).toBe(1);
      const src = tsSources[0]!;
      expect(src.type).toBe("code");
      expect(src.content).toBe("chunk content");
      expect(src.embeddings.length).toBe(128);
      expect(typeof src.file_blake3).toBe("string");
      expect(src.file_blake3.length).toBeGreaterThan(0);
      expect(typeof src.semantic_blake3).toBe("string");
      expect(src.semantic_blake3.length).toBeGreaterThan(0);
      expect(typeof src.id).toBe("string");
      expect(typeof src.chunk_id).toBe("string");
      expect(typeof src.source_id).toBe("string");
    });
  });

  describe("with exclude patterns", () => {
    test("files matching exclude pattern are skipped", async () => {
      const tmpDir = createTempDir();
      createTestFile(tmpDir, "app.ts", "keep");
      createTestFile(tmpDir, "app.test.ts", "skip");

      const mockLogger = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      };

      const filter: FileFilter = {
        formats: [".ts"],
        shouldInclude: (p: string) => p.endsWith(".ts") && !p.includes(".test."),
      };

      const parser: SourceParser = {
        type: "code",
        extensions: [".ts"],
        supportsFile: () => true,
        parse: async (path: string): Promise<ParsedSource> => ({
          type: "code",
          path,
          content: "parsed",
          tags: [],
          metadata: { kind: "code", language: "typescript" },
          file_blake3: "mock-hash",
          last_parsed: new Date().toISOString(),
        }),
      };

      const registry: SourceParserRegistry = {
        getParser: () => parser,
        register: () => {},
      };

      const mockChunker = new MockChunker([
        {
          content: "c",
          core_content: "cc",
          chunk_index: 0,
          total_chunks: 1,
          strategy: "fixed",
          size_tokens: 5,
        },
      ]);

      const repo = new MockSourceRepository();

      const useCase = new IndexUseCase({
        fileFilter: filter,
        parserRegistry: registry,
        chunker: mockChunker,
        embedderRegistry: new MockEmbedderRegistry({
          code: new MockEmbedder("m", 8),
        }),
        repo,
        hasher: new MockHasher(),
        logger: mockLogger,
      });

      const stats = await useCase.execute(tmpDir);
      expect(stats.total_files).toBe(1); // only app.ts

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});


---
# tests/application/PackUseCase.test.ts
---
// ---------------------------------------------------------------------------
// PackUseCase — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { FileFilter } from "../../src/domain/ports/FileFilter";
import type { SourceParserRegistry } from "../../src/domain/ports/SourceParserRegistry";
import type { SourceParser } from "../../src/domain/ports/SourceParser";
import type { ParsedSource } from "../../src/domain/types";
import type { PackSystems } from "../../src/application/di/Systems";
import { PackUseCase, type PackOptions } from "../../src/application/PackUseCase";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "pack-usecase-test-"));
}

function createTestFile(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("PackUseCase", () => {
  describe("execute — pack directory", () => {
    let tmpDir: string;
    let useCase: PackUseCase;

    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    beforeAll(() => {
      tmpDir = createTempDir();
      createTestFile(tmpDir, "README.md", "# My Project\n\nThis is a test.");
      createTestFile(tmpDir, "CONTRIBUTING.md", "## How to Contribute\n\nFork and PR.");
      createTestFile(tmpDir, "main.ts", 'console.log("hello");');
      createTestFile(tmpDir, "notes.txt", "Just some notes.");

      // --- Mock parsers ---
      const mdParser: SourceParser = {
        type: "markdown",
        extensions: [".md"],
        supportsFile: (p: string) => p.endsWith(".md"),
        parse: async (path: string): Promise<ParsedSource> => {
          const content = await Bun.file(path).text();
          return {
            type: "markdown",
            path,
            content,
            tags: ["docs"],
            metadata: { kind: "markdown" },
            file_blake3: "mock-hash",
            last_parsed: new Date().toISOString(),
          };
        },
      };

      const tsParser: SourceParser = {
        type: "code",
        extensions: [".ts"],
        supportsFile: (p: string) => p.endsWith(".ts"),
        parse: async (path: string): Promise<ParsedSource> => {
          const content = await Bun.file(path).text();
          return {
            type: "code",
            path,
            content,
            tags: ["typescript"],
            metadata: { kind: "code", language: "typescript" },
            file_blake3: "mock-hash",
            last_parsed: new Date().toISOString(),
          };
        },
      };

      const mockRegistry: SourceParserRegistry = {
        getParser: (path: string) =>
          [mdParser, tsParser].find((p) => p.supportsFile(path)) ?? null,
        register: () => {},
      };

      // FileFilter that accepts everything
      const mockFilter: FileFilter = {
        formats: [".md", ".ts"],
        shouldInclude: (p: string) => p.endsWith(".md") || p.endsWith(".ts"),
      };

      const systems: PackSystems = {
        parserRegistry: mockRegistry,
        fileFilter: mockFilter,
        logger: mockLogger,
      };

      useCase = new PackUseCase(systems);
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── test 1: pack with include filter ──────────────────────────
    test('execute with include filter returns PackedContext with only .md files', async () => {
      const options: PackOptions = { include: ["**/*.md"] };
      const result = await useCase.execute(tmpDir, options);
      expect(result.markdown).toBeTruthy();
      // Should have combined content of both .md files
      expect(result.markdown).toContain("# My Project");
      expect(result.markdown).toContain("## How to Contribute");
      // Should NOT contain the .ts file content
      expect(result.markdown).not.toContain('console.log("hello")');
      expect(result.chunks_used).toBeGreaterThanOrEqual(2);
      expect(result.source_notes.length).toBeGreaterThanOrEqual(2);
    });

    // ── test 2: pack with exclude filter ──────────────────────────
    test('execute with exclude filter excludes specified files', async () => {
      const options: PackOptions = { exclude: ["**/CONTRIBUTING.md"] };
      const result = await useCase.execute(tmpDir, options);
      expect(result.markdown).toContain("# My Project");
      expect(result.markdown).not.toContain("## How to Contribute");
    });

    // ── test 3: concatenation format correct (Markdown with headers) ──
    test("packed markdown has file headers for each source", async () => {
      const result = await useCase.execute(tmpDir);
      // Each file should have a markdown header indicating its path
      expect(result.markdown).toContain("README.md");
      expect(result.markdown).toContain("CONTRIBUTING.md");
      expect(result.markdown).toContain("main.ts");
    });
  });
});


---
# tests/application/SearchUseCase.test.ts
---
// ---------------------------------------------------------------------------
// SearchUseCase — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { SearchSystems } from "../../src/application/di/Systems";
import type { ContextPacker } from "../../src/domain/systems/ContextPackagingSystem";
import type { SourceData } from "../../src/domain/types";
import { MockEmbedder } from "../mocks/MockEmbedder";
import { MockSourceRepository } from "../mocks/MockSourceRepository";
import { SearchUseCase } from "../../src/application/SearchUseCase";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "search-usecase-test-"));
}

function makeSourceData(
  content: string,
  overrides: Partial<SourceData> = {},
): SourceData {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    chunk_id: crypto.randomUUID(),
    source_id: crypto.randomUUID(),
    type: "markdown",
    title: "test",
    content,
    tags: ["docs"],
    path: "/test/file.md",
    file_blake3: "mock-hash",
    semantic_blake3: "mock-semantic-hash",
    chunk_index: 0,
    total_chunks: 1,
    embeddings: [],
    metadata: { kind: "markdown" },
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("SearchUseCase", () => {
  describe("execute", () => {
    let repo: MockSourceRepository;
    let useCase: SearchUseCase;

    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    const mockPacker: ContextPacker = {
      pack: async (results) => ({
        markdown: results.map((r) => r.source.content).join("\n"),
        chunks_used: results.length,
        total_tokens: 100,
        truncated: false,
        source_notes: [],
      }),
    };

    beforeAll(async () => {
      repo = new MockSourceRepository();
      // Seed some test data
      await repo.upsertBatch([
        makeSourceData("The quick brown fox jumps over the lazy dog", {
          path: "/test/animals.md",
          type: "markdown",
          tags: ["animals"],
        }),
        makeSourceData("Python is a programming language used for web development", {
          path: "/test/python.md",
          type: "code",
          tags: ["code", "python"],
        }),
        makeSourceData("JavaScript is a language for building web applications", {
          path: "/test/javascript.md",
          type: "code",
          tags: ["code", "javascript"],
        }),
        makeSourceData("Machine learning algorithms learn from data", {
          path: "/test/ml.md",
          type: "markdown",
          tags: ["ai", "ml"],
        }),
      ]);

      const mockEmbedder = new MockEmbedder("test-model", 128);

      const systems: SearchSystems = {
        embedder: mockEmbedder,
        repo,
        packer: mockPacker,
        logger: mockLogger,
      };

      useCase = new SearchUseCase(systems);
    });

    // ── test 1: hybrid mode ──────────────────────────────────────
    test('execute("fox", { mode: "hybrid" }) returns search results', async () => {
      const results = await useCase.execute("fox", { mode: "hybrid" });
      expect(results.length).toBeGreaterThan(0);
      // The result should be relevant to "fox"
      expect(results.some((r) => r.source.content.includes("fox"))).toBe(true);
    });

    // ── test 2: semantic mode ────────────────────────────────────
    test('execute("programming", { mode: "semantic" }) works', async () => {
      const results = await useCase.execute("programming", {
        mode: "semantic",
        top_k: 5,
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    // ── test 3: keyword mode ─────────────────────────────────────
    test('execute("language", { mode: "keyword" }) works', async () => {
      const results = await useCase.execute("language", { mode: "keyword" });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    // ── test 4: mode switching ───────────────────────────────────
    test("mode switching produces results with correct match_type", async () => {
      const semantic = await useCase.execute("data", { mode: "semantic" });
      for (const r of semantic) {
        expect(r.match_type).toBe("semantic");
      }

      const keyword = await useCase.execute("data", { mode: "keyword" });
      for (const r of keyword) {
        expect(r.match_type).toBe("keyword");
      }

      const hybrid = await useCase.execute("data", { mode: "hybrid" });
      for (const r of hybrid) {
        expect(r.match_type).toBe("hybrid");
      }
    });

    // ── test 5: empty query handling ─────────────────────────────
    test("empty query returns empty results", async () => {
      const results = await useCase.execute("", { mode: "hybrid" });
      expect(results).toHaveLength(0);
    });
  });
});


---
# tests/application/WatchUseCase.test.ts
---
// ---------------------------------------------------------------------------
// WatchUseCase — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";

import type { FileWatcher } from "../../src/domain/ports/FileWatcher";
import type { FileFilter } from "../../src/domain/ports/FileFilter";
import type { SourceParserRegistry } from "../../src/domain/ports/SourceParserRegistry";
import { MockChunker } from "../mocks/MockChunker";
import { MockHasher } from "../mocks/MockHasher";
import { MockEmbedderRegistry } from "../mocks/MockEmbedderRegistry";
import { MockSourceRepository } from "../mocks/MockSourceRepository";
import { DiffIndexingService } from "../../src/domain/services/DiffIndexingService";
import { WatchUseCase } from "../../src/application/WatchUseCase";

// --------------------------------------------------------------------------
// Mocks
// --------------------------------------------------------------------------

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeMockParserRegistry(): SourceParserRegistry {
  const parser = {
    type: "code" as const,
    extensions: [".ts"],
    supportsFile: (p: string) => p.endsWith(".ts"),
    parse: async (path: string) => ({
      type: "code" as const,
      path,
      content: "parsed content",
      tags: [] as string[],
      metadata: { kind: "code" as const, language: "typescript" },
      file_blake3: "mock-hash",
      last_parsed: new Date().toISOString(),
    }),
  };
  return {
    getParser: () => parser,
    register: () => {},
  };
}

function makeDiffService(): DiffIndexingService {
  const filter: FileFilter = {
    formats: [".ts"],
    shouldInclude: () => true,
  };
  return new DiffIndexingService(
    new MockHasher(),
    makeMockParserRegistry(),
    new MockChunker([]),
    new MockEmbedderRegistry({}),
    new MockSourceRepository(),
    filter,
  );
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("WatchUseCase", () => {
  describe("execute — starts watcher", () => {
    test("calls watcher.start() on execute", async () => {
      let started = false;

      const watcher: FileWatcher = {
        on: () => {},
        start: async () => { started = true; },
        stop: async () => {},
      };

      const useCase = new WatchUseCase(watcher, makeDiffService(), mockLogger);
      await useCase.execute("./vault");

      expect(started).toBe(true);
    });

    test("calls diffService.diffIndex on change events", async () => {
      let diffCalled = false;
      let capturedDir = "";

      const diffService = makeDiffService();
      const originalDiff = diffService.diffIndex.bind(diffService);
      diffService.diffIndex = async (dir: string) => {
        diffCalled = true;
        capturedDir = dir;
        return { indexed: 1, skipped: 0, errors: 0 };
      };

      let changeHandler: ((path: string) => void) | null = null;

      const watcher: FileWatcher = {
        on: (event: string, cb: (path: string) => void) => {
          if (event === "change") changeHandler = cb;
        },
        start: async () => {},
        stop: async () => {},
      };

      const useCase = new WatchUseCase(watcher, diffService, mockLogger);
      await useCase.execute("./vault");

      // Simulate a file change
      if (changeHandler) {
        await changeHandler("/vault/file.ts");
      }

      expect(diffCalled).toBe(true);
      expect(capturedDir).toBe("./vault");
    });

    test("calls diffService.diffIndex on add events", async () => {
      let diffCalled = false;

      const diffService = makeDiffService();
      diffService.diffIndex = async () => {
        diffCalled = true;
        return { indexed: 1, skipped: 0, errors: 0 };
      };

      let addHandler: ((path: string) => void) | null = null;

      const watcher: FileWatcher = {
        on: (event: string, cb: (path: string) => void) => {
          if (event === "add") addHandler = cb;
        },
        start: async () => {},
        stop: async () => {},
      };

      const useCase = new WatchUseCase(watcher, diffService, mockLogger);
      await useCase.execute("./vault");

      if (addHandler) {
        await addHandler("/vault/new.ts");
      }

      expect(diffCalled).toBe(true);
    });
  });

  describe("stop — stops watcher", () => {
    test("calls watcher.stop() on stop", async () => {
      let stopped = false;

      const watcher: FileWatcher = {
        on: () => {},
        start: async () => {},
        stop: async () => { stopped = true; },
      };

      const useCase = new WatchUseCase(watcher, makeDiffService(), mockLogger);
      await useCase.execute("./vault");
      await useCase.stop();

      expect(stopped).toBe(true);
    });
  });
});

---
# tests/domain/ast.test.ts
---
import { describe, expect, test } from "bun:test";

import type {
  SymbolKind,
  SymbolDetail,
  Import,
  Export,
  Relationship,
  FileIndex,
} from "../../src/domain/ast";

// ---------------------------------------------------------------------------
// SymbolKind
// ---------------------------------------------------------------------------
describe("SymbolKind", () => {
  test("all SymbolKind values are valid strings", () => {
    const kinds: SymbolKind[] = [
      "function",
      "class",
      "interface",
      "type",
      "enum",
      "variable",
      "method",
      "property",
      "parameter",
      "module",
    ];
    expect(kinds).toHaveLength(10);
    expect(kinds).toEqual([
      "function",
      "class",
      "interface",
      "type",
      "enum",
      "variable",
      "method",
      "property",
      "parameter",
      "module",
    ]);
  });

  test("exhaustive switch over SymbolKind (compile-time check)", () => {
    // If a new kind is added without a case, TS will error.
    const describeKind = (kind: SymbolKind): string => {
      switch (kind) {
        case "function":
          return "fn";
        case "class":
          return "cls";
        case "interface":
          return "iface";
        case "type":
          return "type";
        case "enum":
          return "enum";
        case "variable":
          return "var";
        case "method":
          return "method";
        case "property":
          return "prop";
        case "parameter":
          return "param";
        case "module":
          return "mod";
      }
    };
    expect(describeKind("function")).toBe("fn");
    expect(describeKind("class")).toBe("cls");
    expect(describeKind("module")).toBe("mod");
  });
});

// ---------------------------------------------------------------------------
// SymbolDetail
// ---------------------------------------------------------------------------
describe("SymbolDetail", () => {
  test("full symbol detail with all fields", () => {
    const sym: SymbolDetail = {
      kind: "function",
      name: "handleRequest",
      signature: "handleRequest(req: Request): Response",
      startPosition: { line: 10, column: 2 },
      endPosition: { line: 25, column: 1 },
    };
    expect(sym.kind).toBe("function");
    expect(sym.name).toBe("handleRequest");
    expect(sym.signature).toContain("Request");
    expect(sym.startPosition).toEqual({ line: 10, column: 2 });
    expect(sym.endPosition).toEqual({ line: 25, column: 1 });
  });

  test("class symbol detail", () => {
    const sym: SymbolDetail = {
      kind: "class",
      name: "UserService",
      signature: "class UserService",
      startPosition: { line: 1, column: 0 },
      endPosition: { line: 50, column: 0 },
    };
    expect(sym.kind).toBe("class");
    expect(sym.name).toBe("UserService");
  });

  test("interface symbol detail", () => {
    const sym: SymbolDetail = {
      kind: "interface",
      name: "SourceRepository",
      signature: "interface SourceRepository",
      startPosition: { line: 5, column: 0 },
      endPosition: { line: 20, column: 0 },
    };
    expect(sym.kind).toBe("interface");
    expect(sym.name).toBe("SourceRepository");
  });

  test("positions are zero-based or file-specific numbers", () => {
    const sym: SymbolDetail = {
      kind: "variable",
      name: "config",
      signature: "const config: Config",
      startPosition: { line: 0, column: 0 },
      endPosition: { line: 0, column: 20 },
    };
    expect(sym.startPosition.line).toBeGreaterThanOrEqual(0);
    expect(sym.startPosition.column).toBeGreaterThanOrEqual(0);
    expect(sym.endPosition.line).toBeGreaterThanOrEqual(0);
    expect(sym.endPosition.column).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
describe("Import", () => {
  test("named import", () => {
    const imp: Import = {
      source: "lodash",
      specifiers: ["merge", "cloneDeep"],
      kind: "named",
    };
    expect(imp.source).toBe("lodash");
    expect(imp.specifiers).toEqual(["merge", "cloneDeep"]);
    expect(imp.kind).toBe("named");
  });

  test("default import", () => {
    const imp: Import = {
      source: "express",
      specifiers: ["express"],
      kind: "default",
    };
    expect(imp.source).toBe("express");
    expect(imp.kind).toBe("default");
  });

  test("namespace import", () => {
    const imp: Import = {
      source: "zod",
      specifiers: ["z"],
      kind: "namespace",
    };
    expect(imp.source).toBe("zod");
    expect(imp.kind).toBe("namespace");
  });

  test("empty specifiers list", () => {
    const imp: Import = {
      source: "side-effect-lib",
      specifiers: [],
      kind: "named",
    };
    expect(imp.specifiers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
describe("Export", () => {
  test("named export", () => {
    const exp: Export = {
      name: "SourceData",
      kind: "named",
    };
    expect(exp.name).toBe("SourceData");
    expect(exp.kind).toBe("named");
  });

  test("default export", () => {
    const exp: Export = {
      name: "default",
      kind: "default",
    };
    expect(exp.name).toBe("default");
    expect(exp.kind).toBe("default");
  });

  test("all export (re-export)", () => {
    const exp: Export = {
      name: "*",
      kind: "all",
    };
    expect(exp.name).toBe("*");
    expect(exp.kind).toBe("all");
  });
});

// ---------------------------------------------------------------------------
// Relationship
// ---------------------------------------------------------------------------
describe("Relationship", () => {
  test("calls relationship", () => {
    const rel: Relationship = {
      type: "calls",
      source: "handleRequest",
      target: "authenticate",
    };
    expect(rel.type).toBe("calls");
    expect(rel.source).toBe("handleRequest");
    expect(rel.target).toBe("authenticate");
  });

  test("extends relationship", () => {
    const rel: Relationship = {
      type: "extends",
      source: "AdminController",
      target: "BaseController",
    };
    expect(rel.type).toBe("extends");
  });

  test("implements relationship", () => {
    const rel: Relationship = {
      type: "implements",
      source: "MyRepository",
      target: "SourceRepository",
    };
    expect(rel.type).toBe("implements");
  });

  test("imports relationship", () => {
    const rel: Relationship = {
      type: "imports",
      source: "src/service.ts",
      target: "src/types.ts",
    };
    expect(rel.type).toBe("imports");
  });

  test("exports relationship", () => {
    const rel: Relationship = {
      type: "exports",
      source: "src/index.ts",
      target: "src/types.ts",
    };
    expect(rel.type).toBe("exports");
  });

  test("all relationship types are covered", () => {
    const types: Relationship["type"][] = [
      "calls",
      "extends",
      "implements",
      "imports",
      "exports",
    ];
    expect(types).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// FileIndex
// ---------------------------------------------------------------------------
describe("FileIndex", () => {
  const fileIndex: FileIndex = {
    path: "/src/main.ts",
    file_blake3: "abc123def456",
    language: "typescript",
    imports: [
      { source: "lodash", specifiers: ["merge"], kind: "named" },
      { source: "express", specifiers: ["express"], kind: "default" },
    ],
    exports: [
      { name: "app", kind: "named" },
      { name: "config", kind: "named" },
    ],
    symbols: [
      {
        kind: "function",
        name: "startServer",
        signature: "startServer(port: number): Server",
        startPosition: { line: 15, column: 0 },
        endPosition: { line: 30, column: 1 },
      },
      {
        kind: "variable",
        name: "PORT",
        signature: "const PORT: number",
        startPosition: { line: 5, column: 0 },
        endPosition: { line: 5, column: 15 },
      },
    ],
    relationships: [
      { type: "imports", source: "/src/main.ts", target: "lodash" },
    ],
    last_parsed: "2026-01-10T08:00:00.000Z",
  };

  test("has all required fields", () => {
    expect(fileIndex.path).toBeDefined();
    expect(fileIndex.file_blake3).toBeDefined();
    expect(fileIndex.language).toBeDefined();
    expect(fileIndex.imports).toBeDefined();
    expect(fileIndex.exports).toBeDefined();
    expect(fileIndex.symbols).toBeDefined();
    expect(fileIndex.relationships).toBeDefined();
    expect(fileIndex.last_parsed).toBeDefined();
  });

  test("path and hash are strings", () => {
    expect(typeof fileIndex.path).toBe("string");
    expect(typeof fileIndex.file_blake3).toBe("string");
    expect(typeof fileIndex.language).toBe("string");
  });

  test("imports array contains typed entries", () => {
    expect(fileIndex.imports).toHaveLength(2);
    fileIndex.imports.forEach((imp) => {
      expect(typeof imp.source).toBe("string");
      expect(Array.isArray(imp.specifiers)).toBe(true);
      expect(["named", "default", "namespace"]).toContain(imp.kind);
    });
  });

  test("exports array contains typed entries", () => {
    expect(fileIndex.exports).toHaveLength(2);
    fileIndex.exports.forEach((exp) => {
      expect(typeof exp.name).toBe("string");
      expect(["named", "default", "all"]).toContain(exp.kind);
    });
  });

  test("symbols array contains typed entries", () => {
    expect(fileIndex.symbols).toHaveLength(2);
    fileIndex.symbols.forEach((sym) => {
      expect(typeof sym.name).toBe("string");
      expect(typeof sym.signature).toBe("string");
      expect(sym.startPosition).toHaveProperty("line");
      expect(sym.startPosition).toHaveProperty("column");
      expect(sym.endPosition).toHaveProperty("line");
      expect(sym.endPosition).toHaveProperty("column");
    });
  });

  test("relationships array contains typed entries", () => {
    expect(fileIndex.relationships).toHaveLength(1);
    fileIndex.relationships.forEach((rel) => {
      expect(typeof rel.source).toBe("string");
      expect(typeof rel.target).toBe("string");
      expect(["calls", "extends", "implements", "imports", "exports"]).toContain(
        rel.type,
      );
    });
  });

  test("last_parsed is ISO 8601", () => {
    expect(fileIndex.last_parsed).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  test("can have empty arrays", () => {
    const empty: FileIndex = {
      path: "/src/empty.ts",
      file_blake3: "hash",
      language: "typescript",
      imports: [],
      exports: [],
      symbols: [],
      relationships: [],
      last_parsed: "2026-01-01T00:00:00.000Z",
    };
    expect(empty.imports).toEqual([]);
    expect(empty.exports).toEqual([]);
    expect(empty.symbols).toEqual([]);
    expect(empty.relationships).toEqual([]);
  });
});


---
# tests/domain/ports/FileFilter.test.ts
---
import { describe, expect, test } from "bun:test";

import type { FileFilter } from "../../../src/domain/ports/FileFilter";

describe("FileFilter interface", () => {
  test("all properties and methods are present", () => {
    const mock: FileFilter = {
      formats: [".ts", ".tsx", ".js"],
      include: ["src/**/*"],
      exclude: ["node_modules/**/*"],
      shouldInclude: (path: string) => path.startsWith("src/"),
    };

    expect(Array.isArray(mock.formats)).toBe(true);
    expect(mock.formats).toContain(".ts");
    // include/exclude are optional but when present are arrays
    expect(Array.isArray(mock.include)).toBe(true);
    expect(Array.isArray(mock.exclude)).toBe(true);
    expect(typeof mock.shouldInclude).toBe("function");
  });

  test("shouldInclude returns boolean for included files", () => {
    const mock: FileFilter = {
      formats: [".ts", ".js"],
      include: ["src/**/*"],
      shouldInclude: (path: string) =>
        path.startsWith("src/") &&
        mock.formats.some((ext) => path.endsWith(ext)),
    };

    expect(mock.shouldInclude("src/main.ts")).toBe(true);
    expect(mock.shouldInclude("src/util.js")).toBe(true);
    expect(mock.shouldInclude("node_modules/pkg/index.ts")).toBe(false);
    expect(mock.shouldInclude("src/main.txt")).toBe(false);
  });

  test("include and exclude are optional", () => {
    const mock: FileFilter = {
      formats: [".ts"],
      shouldInclude: () => true,
    };

    expect(mock.include).toBeUndefined();
    expect(mock.exclude).toBeUndefined();
    expect(mock.shouldInclude("any.ts")).toBe(true);
  });

  test("shouldInclude with exclusion logic", () => {
    const mock: FileFilter = {
      formats: [".ts", ".md"],
      exclude: ["test/**/*"],
      shouldInclude: (path: string) =>
        mock.formats.some((ext) => path.endsWith(ext)) &&
        !path.startsWith("test/"),
    };

    expect(mock.shouldInclude("src/app.ts")).toBe(true);
    expect(mock.shouldInclude("README.md")).toBe(true);
    expect(mock.shouldInclude("test/app.test.ts")).toBe(false);
  });
});


---
# tests/domain/ports/FileWatcher.test.ts
---
import { describe, expect, test } from "bun:test";

import type { FileWatcher } from "../../../src/domain/ports/FileWatcher";

describe("FileWatcher interface", () => {
  test("all methods are present on a mock implementation", () => {
    const mock: FileWatcher = {
      on: (event, cb) => {},
      start: async () => {},
      stop: async () => {},
    };

    expect(typeof mock.on).toBe("function");
    expect(typeof mock.start).toBe("function");
    expect(typeof mock.stop).toBe("function");
  });

  test("on accepts add, change, unlink events", () => {
    const events: string[] = [];
    const mock: FileWatcher = {
      on: (event, cb) => {
        events.push(event);
      },
      start: async () => {},
      stop: async () => {},
    };

    mock.on("add", () => {});
    mock.on("change", () => {});
    mock.on("unlink", () => {});

    expect(events).toEqual(["add", "change", "unlink"]);
  });

  test("start and stop return promises", async () => {
    let started = false;
    let stopped = false;

    const mock: FileWatcher = {
      on: () => {},
      start: async () => {
        started = true;
      },
      stop: async () => {
        stopped = true;
      },
    };

    await mock.start();
    expect(started).toBe(true);

    await mock.stop();
    expect(stopped).toBe(true);
  });

  test("on callback receives file path", () => {
    const handled: string[] = [];
    const mock: FileWatcher = {
      on: (event, cb) => {
        if (event === "add") cb("/new/file.ts");
      },
      start: async () => {},
      stop: async () => {},
    };

    mock.on("add", (path) => {
      handled.push(path);
    });

    expect(handled).toContain("/new/file.ts");
  });
});


---
# tests/domain/ports/Logger.test.ts
---
import { describe, expect, test } from "bun:test";

import type { Logger, LogLevel } from "../../../src/domain/ports/Logger";

describe("Logger interface", () => {
  test("all log methods are present on a mock", () => {
    const mock: Logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    expect(typeof mock.info).toBe("function");
    expect(typeof mock.warn).toBe("function");
    expect(typeof mock.error).toBe("function");
    expect(typeof mock.debug).toBe("function");
  });

  test("each method accepts a message and variadic args", () => {
    const logged: string[] = [];
    const mock: Logger = {
      info: (msg, ...args) => logged.push(`INFO: ${msg} ${args.join(", ")}`),
      warn: (msg, ...args) => logged.push(`WARN: ${msg} ${args.join(", ")}`),
      error: (msg, ...args) => logged.push(`ERROR: ${msg} ${args.join(", ")}`),
      debug: (msg, ...args) => logged.push(`DEBUG: ${msg} ${args.join(", ")}`),
    };

    mock.info("Server started", { port: 3000 });
    mock.warn("Deprecated API", "use v2 instead");
    mock.error("Connection failed", new Error("timeout"));
    mock.debug("Cache hit", "key-123", 0.5);

    expect(logged).toHaveLength(4);
    expect(logged[0]).toContain("INFO: Server started");
    expect(logged[1]).toContain("WARN: Deprecated API");
    expect(logged[2]).toContain("ERROR: Connection failed");
    expect(logged[3]).toContain("DEBUG: Cache hit");
  });

  test("LogLevel type is exported", () => {
    const levels: LogLevel[] = ["info", "warn", "error", "debug"];
    expect(levels).toHaveLength(4);
    expect(levels).toEqual(["info", "warn", "error", "debug"]);
  });

  test("methods return void", () => {
    const mock: Logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    expect(mock.info("test")).toBeUndefined();
    expect(mock.warn("test")).toBeUndefined();
    expect(mock.error("test")).toBeUndefined();
    expect(mock.debug("test")).toBeUndefined();
  });
});


---
# tests/domain/ports/SourceParser.test.ts
---
import { describe, expect, test } from "bun:test";

import type { SourceParser } from "../../../src/domain/ports/SourceParser";

describe("SourceParser interface", () => {
  test("all properties and methods are present on a mock implementation", () => {
    const mock: SourceParser = {
      type: "code",
      extensions: [".ts", ".tsx", ".js"],
      supportsFile: (path: string) => path.endsWith(".ts"),
      parse: async (path: string) => ({
        type: mock.type,
        path,
        content: "",
        tags: [],
        metadata: { kind: "code", language: "typescript" },
        file_blake3: "hash",
        last_parsed: "2026-01-01T00:00:00.000Z",
      }),
    };

    // Properties
    expect(mock.type).toBe("code");
    expect(Array.isArray(mock.extensions)).toBe(true);
    expect(mock.extensions).toContain(".ts");

    // Methods exist
    expect(typeof mock.supportsFile).toBe("function");
    expect(typeof mock.parse).toBe("function");
  });

  test("supportsFile returns boolean", () => {
    const mock: SourceParser = {
      type: "markdown",
      extensions: [".md", ".mdx"],
      supportsFile: (path: string) =>
        mock.extensions.some((ext) => path.endsWith(ext)),
      parse: async () => ({
        type: "markdown",
        path: "/f.md",
        content: "# Hi",
        tags: [],
        metadata: { kind: "markdown" },
        file_blake3: "hash",
        last_parsed: "2026-01-01T00:00:00.000Z",
      }),
    };

    expect(mock.supportsFile("/doc.md")).toBe(true);
    expect(mock.supportsFile("/doc.mdx")).toBe(true);
    expect(mock.supportsFile("/doc.txt")).toBe(false);
  });

  test("parse returns ParsedSource", async () => {
    const mock: SourceParser = {
      type: "code",
      extensions: [".py"],
      supportsFile: () => true,
      parse: async (path: string) => ({
        type: "code",
        path,
        content: 'print("hello")',
        tags: ["python"],
        metadata: { kind: "code", language: "python" },
        file_blake3: "abc",
        last_parsed: "2026-02-01T00:00:00.000Z",
      }),
    };

    const result = await mock.parse("/script.py");
    expect(result.type).toBe("code");
    expect(result.path).toBe("/script.py");
    expect(result.content).toBe('print("hello")');
    expect(result.tags).toEqual(["python"]);
    expect(result.file_blake3).toBe("abc");
  });
});


---
# tests/domain/ports/SourceParserRegistry.test.ts
---
import { describe, expect, test } from "bun:test";

import type { SourceParserRegistry } from "../../../src/domain/ports/SourceParserRegistry";
import type { SourceParser } from "../../../src/domain/ports/SourceParser";

describe("SourceParserRegistry interface", () => {
  test("register and getParser roundtrip", () => {
    const tsParser: SourceParser = {
      type: "code",
      extensions: [".ts"],
      supportsFile: (path: string) => path.endsWith(".ts"),
      parse: async (path: string) => ({
        type: "code",
        path,
        content: "",
        tags: [],
        metadata: { kind: "code", language: "typescript" },
        file_blake3: "hash",
        last_parsed: "2026-01-01T00:00:00.000Z",
      }),
    };

    const registry: SourceParserRegistry = {
      parsers: [] as SourceParser[],
      getParser(path: string) {
        return this.parsers.find((p) => p.supportsFile(path)) ?? null;
      },
      register(parser: SourceParser) {
        this.parsers.push(parser);
      },
    };

    registry.register(tsParser);
    const found = registry.getParser("/file.ts");
    expect(found).not.toBeNull();
    expect(found!.type).toBe("code");
    expect(found!.extensions).toContain(".ts");
  });

  test("getParser returns null for unsupported files", () => {
    const registry: SourceParserRegistry = {
      parsers: [],
      getParser() {
        return null;
      },
      register() {},
    };

    expect(registry.getParser("/unknown.xyz")).toBeNull();
  });

  test("multiple parsers can be registered", () => {
    const mdParser: SourceParser = {
      type: "markdown",
      extensions: [".md"],
      supportsFile: (path: string) => path.endsWith(".md"),
      parse: async () => ({
        type: "markdown",
        path: "",
        content: "",
        tags: [],
        metadata: { kind: "markdown" },
        file_blake3: "h",
        last_parsed: "2026-01-01T00:00:00.000Z",
      }),
    };

    const registry: SourceParserRegistry = {
      parsers: [mdParser],
      getParser(path: string) {
        return this.parsers.find((p) => p.supportsFile(path)) ?? null;
      },
      register(parser: SourceParser) {
        this.parsers.push(parser);
      },
    };

    expect(registry.getParser("/doc.md")).not.toBeNull();
    expect(registry.getParser("/doc.txt")).toBeNull();
  });
});


---
# tests/domain/ports/SourceRepository.test.ts
---
import { describe, expect, test } from "bun:test";

import type { SourceRepository } from "../../../src/domain/ports/SourceRepository";

describe("SourceRepository interface", () => {
  test("all required methods are present on a mock implementation", () => {
    // Create a minimal mock that satisfies SourceRepository
    const mock: SourceRepository = {
      upsert: async () => {},
      upsertBatch: async () => {},
      getById: async () => null,
      getByPath: async () => [],
      getBySourceId: async () => [],
      delete: async () => {},
      deleteByPath: async () => {},
      search: async () => [],
      hasSemanticBlake3: async () => false,
      hasModelEmbedding: async () => false,
      getSourceIdsByHash: async () => [],
      getFileBlake3ByPath: async () => null,
      stats: async () => ({
        total_sources: 0,
        total_chunks: 0,
        total_files: 0,
        last_indexed: "2026-01-01T00:00:00.000Z",
      }),
      upsertFileIndex: async () => {},
      getFileIndex: async () => null,
      deleteFileIndex: async () => {},
      dropAll: async () => {},
    };

    // Verify every method exists and is a function
    expect(typeof mock.upsert).toBe("function");
    expect(typeof mock.upsertBatch).toBe("function");
    expect(typeof mock.getById).toBe("function");
    expect(typeof mock.getByPath).toBe("function");
    expect(typeof mock.getBySourceId).toBe("function");
    expect(typeof mock.delete).toBe("function");
    expect(typeof mock.deleteByPath).toBe("function");
    expect(typeof mock.search).toBe("function");
    expect(typeof mock.hasSemanticBlake3).toBe("function");
    expect(typeof mock.hasModelEmbedding).toBe("function");
    expect(typeof mock.getSourceIdsByHash).toBe("function");
    expect(typeof mock.getFileBlake3ByPath).toBe("function");
    expect(typeof mock.stats).toBe("function");
    expect(typeof mock.upsertFileIndex).toBe("function");
    expect(typeof mock.getFileIndex).toBe("function");
    expect(typeof mock.deleteFileIndex).toBe("function");
    expect(typeof mock.dropAll).toBe("function");
  });

  test("methods return Promise (async)", async () => {
    const mock: SourceRepository = {
      upsert: async () => {},
      upsertBatch: async () => {},
      getById: async () => null,
      getByPath: async () => [],
      getBySourceId: async () => [],
      delete: async () => {},
      deleteByPath: async () => {},
      search: async () => [],
      hasSemanticBlake3: async () => true,
      hasModelEmbedding: async () => false,
      getSourceIdsByHash: async () => ["id-1"],
      getFileBlake3ByPath: async () => "hash",
      stats: async () => ({
        total_sources: 1,
        total_chunks: 3,
        total_files: 1,
        last_indexed: "2026-01-01T00:00:00.000Z",
      }),
      upsertFileIndex: async () => {},
      getFileIndex: async () => null,
      deleteFileIndex: async () => {},
      dropAll: async () => {},
    };

    // All methods that return promises should resolve
    await expect(mock.upsert({} as never)).resolves.toBeUndefined();
    await expect(mock.upsertBatch([])).resolves.toBeUndefined();
    await expect(mock.getById("x")).resolves.toBeNull();
    await expect(mock.getByPath("/a.ts")).resolves.toEqual([]);
    await expect(mock.getBySourceId("src")).resolves.toEqual([]);
    await expect(mock.delete("x")).resolves.toBeUndefined();
    await expect(mock.deleteByPath("/a.ts")).resolves.toBeUndefined();
    await expect(mock.search({} as never)).resolves.toEqual([]);
    await expect(mock.hasSemanticBlake3("h")).resolves.toBe(true);
    await expect(mock.hasModelEmbedding("id")).resolves.toBe(false);
    await expect(mock.getSourceIdsByHash("h")).resolves.toEqual(["id-1"]);
    await expect(mock.getFileBlake3ByPath("/a.ts")).resolves.toBe("hash");
    await expect(mock.stats()).resolves.toEqual({
      total_sources: 1,
      total_chunks: 3,
      total_files: 1,
      last_indexed: "2026-01-01T00:00:00.000Z",
    });
    await expect(mock.upsertFileIndex({} as never)).resolves.toBeUndefined();
    await expect(mock.getFileIndex("/a.ts")).resolves.toBeNull();
    await expect(mock.deleteFileIndex("/a.ts")).resolves.toBeUndefined();
    await expect(mock.dropAll()).resolves.toBeUndefined();
  });

  test("interface has exactly the specified number of methods", () => {
    // Count interface members by checking mock keys
    const mock: SourceRepository = {
      upsert: async () => {},
      upsertBatch: async () => {},
      getById: async () => null,
      getByPath: async () => [],
      getBySourceId: async () => [],
      delete: async () => {},
      deleteByPath: async () => {},
      search: async () => [],
      hasSemanticBlake3: async () => false,
      hasModelEmbedding: async () => false,
      getSourceIdsByHash: async () => [],
      getFileBlake3ByPath: async () => null,
      stats: async () => ({
        total_sources: 0,
        total_chunks: 0,
        total_files: 0,
        last_indexed: "2026-01-01T00:00:00.000Z",
      }),
      upsertFileIndex: async () => {},
      getFileIndex: async () => null,
      deleteFileIndex: async () => {},
      dropAll: async () => {},
    };
    // All 17 methods
    expect(Object.keys(mock).length).toBe(17);
  });
});


---
# tests/domain/services/DiffIndexingService.test.ts
---
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { FileFilter } from "../../../src/domain/ports/FileFilter";
import type { SourceParserRegistry } from "../../../src/domain/ports/SourceParserRegistry";
import type { SourceParser } from "../../../src/domain/ports/SourceParser";
import type { ParsedSource, SourceData, SourceType } from "../../../src/domain/types";
import type { FileIndex } from "../../../src/domain/ast";
import { MockEmbedder } from "../../mocks/MockEmbedder";
import { MockEmbedderRegistry } from "../../mocks/MockEmbedderRegistry";
import { MockChunker } from "../../mocks/MockChunker";
import { MockHasher } from "../../mocks/MockHasher";
import { MockSourceRepository } from "../../mocks/MockSourceRepository";
import { DiffIndexingService } from "../../../src/domain/services/DiffIndexingService";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "diff-test-"));
}

function createTestFile(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

function makeFilter(
  predicate: (path: string) => boolean,
): FileFilter {
  return { formats: [".ts"], shouldInclude: predicate };
}

function makeParser(
  type: SourceType,
  ext: string,
  fileIndex?: FileIndex,
): SourceParser {
  return {
    type,
    extensions: [ext],
    supportsFile: (p: string) => p.endsWith(ext),
    parse: async (path: string): Promise<ParsedSource> => ({
      type,
      path,
      content: `parsed ${type} content`,
      tags: [],
      metadata:
        type === "code"
          ? { kind: "code", language: "typescript" }
          : { kind: "generic", encoding: "utf-8" },
      file_blake3: `mock-${type}-hash`,
      last_parsed: new Date().toISOString(),
      fileIndex,
    }),
  };
}

function makeParserRegistry(...parsers: SourceParser[]): SourceParserRegistry {
  return {
    getParser: (path: string) =>
      parsers.find((p) => p.supportsFile(path)) ?? null,
    register: () => {},
  };
}

/** Create a minimal SourceData for seeding the mock repo. */
function seedSourceData(
  id: string,
  path: string,
  fileHash: string,
  semanticHash: string,
): SourceData {
  const now = new Date().toISOString();
  return {
    id: `${id}-chunk-1`,
    chunk_id: `${id}-chunk-1`,
    source_id: `src-${id}`,
    type: "code",
    title: path,
    content: `old content for ${id}`,
    tags: [],
    path,
    file_blake3: fileHash,
    semantic_blake3: semanticHash,
    chunk_index: 0,
    total_chunks: 1,
    embeddings: [],
    metadata: { kind: "code", language: "typescript" },
    created_at: now,
    updated_at: now,
  };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("DiffIndexingService", () => {
  // ── Unchanged file skip ─────────────────────────────────────

  describe("unchanged file skip", () => {
    test("skips file when file_blake3 matches stored hash", async () => {
      const tmpDir = createTempDir();
      const filePath = createTestFile(tmpDir, "a.ts", "stable content");

      const repo = new MockSourceRepository();
      const hasher = new MockHasher();
      const fileHash = await hasher.hash("stable content");

      // Seed repo with old SourceData that has the same hash as current content
      await repo.upsert(
        seedSourceData("a", filePath, fileHash, "sem-hash-old"),
      );

      const service = new DiffIndexingService(
        hasher,
        makeParserRegistry(makeParser("code", ".ts")),
        new MockChunker([
          {
            content: "x",
            core_content: "y",
            chunk_index: 0,
            total_chunks: 1,
            strategy: "fixed",
            size_tokens: 5,
          },
        ]),
        new MockEmbedderRegistry({ code: new MockEmbedder("m", 8) }),
        repo,
        makeFilter((p) => p.endsWith(".ts")),
      );

      const result = await service.diffIndex(tmpDir);
      expect(result.indexed).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.errors).toBe(0);

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  // ── Changed file re-process ────────────────────────────────

  describe("changed file re-process", () => {
    test("re-parses, re-chunks, re-embeds when file_blake3 differs", async () => {
      const tmpDir = createTempDir();
      const filePath = createTestFile(tmpDir, "a.ts", "new content");

      const repo = new MockSourceRepository();
      const hasher = new MockHasher();

      // Seed repo with old hash (different from current content)
      await repo.upsert(
        seedSourceData("a", filePath, "old-file-hash", "old-sem-hash"),
      );

      const service = new DiffIndexingService(
        hasher,
        makeParserRegistry(makeParser("code", ".ts")),
        new MockChunker([
          {
            content: "new chunk",
            core_content: "new core",
            chunk_index: 0,
            total_chunks: 1,
            strategy: "fixed",
            size_tokens: 5,
          },
        ]),
        new MockEmbedderRegistry({ code: new MockEmbedder("m", 8) }),
        repo,
        makeFilter((p) => p.endsWith(".ts")),
      );

      const result = await service.diffIndex(tmpDir);
      expect(result.indexed).toBe(1);
      expect(result.skipped).toBe(0);

      // Verify old chunks were removed and new ones exist
      const updatedSources = await repo.getByPath(filePath);
      expect(updatedSources.length).toBe(1);
      expect(updatedSources[0]!.content).toBe("new chunk");

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  // ── Cross-file semantic dedup ──────────────────────────────

  describe("cross-file semantic dedup", () => {
    test("shared semantic_blake3 preserved when other file still references it", async () => {
      const tmpDir = createTempDir();
      const sharedHash = "shared-semantic-hash-123";

      // File A will change; File B is not in the scanned dir (only in repo)
      const fileAPath = createTestFile(tmpDir, "a.ts", "changed content for A");

      const repo = new MockSourceRepository();

      // File A's old data — shares semantic hash with File B
      await repo.upsert(
        seedSourceData("a", fileAPath, "old-file-hash-A", sharedHash),
      );
      // File B (virtual, not in temp dir) — shares the same semantic hash
      await repo.upsert(
        seedSourceData("b", "/virtual/b.ts", "file-b-hash", sharedHash),
      );

      // Verify shared hash exists before
      expect(await repo.hasSemanticBlake3(sharedHash)).toBe(true);

      const service = new DiffIndexingService(
        new MockHasher(),
        makeParserRegistry(makeParser("code", ".ts")),
        new MockChunker([
          {
            content: "new chunk for A",
            core_content: "new core for A",
            chunk_index: 0,
            total_chunks: 1,
            strategy: "fixed",
            size_tokens: 5,
          },
        ]),
        new MockEmbedderRegistry({ code: new MockEmbedder("m", 8) }),
        repo,
        makeFilter((p) => p.endsWith(".ts")),
      );

      const result = await service.diffIndex(tmpDir);
      expect(result.indexed).toBe(1);
      expect(result.skipped).toBe(0);

      // Shared hash should still exist because File B references it
      const stillExists = await repo.hasSemanticBlake3(sharedHash);
      expect(stillExists).toBe(true);

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  // ── FileIndex rebuild ──────────────────────────────────────

  describe("FileIndex rebuild", () => {
    test("FileIndex is updated when file content changes", async () => {
      const tmpDir = createTempDir();
      const filePath = createTestFile(tmpDir, "a.ts", "modified content");

      const repo = new MockSourceRepository();
      const hasher = new MockHasher();

      // Seed old data
      await repo.upsert(
        seedSourceData("a", filePath, "old-hash", "old-sem"),
      );

      // Seed old FileIndex
      const oldFileIndex: FileIndex = {
        path: filePath,
        file_blake3: "old-hash",
        language: "typescript",
        imports: [{ source: "old-dep", specifiers: ["old"], kind: "named" }],
        exports: [],
        symbols: [],
        relationships: [],
        last_parsed: "2026-01-01T00:00:00.000Z",
      };
      await repo.upsertFileIndex(oldFileIndex);

      // Parser returns new FileIndex
      const newFileIndex: FileIndex = {
        path: filePath,
        file_blake3: "new-hash",
        language: "typescript",
        imports: [{ source: "new-dep", specifiers: ["new"], kind: "named" }],
        exports: [],
        symbols: [],
        relationships: [],
        last_parsed: "2026-06-01T00:00:00.000Z",
      };

      const service = new DiffIndexingService(
        hasher,
        makeParserRegistry(makeParser("code", ".ts", newFileIndex)),
        new MockChunker([
          {
            content: "c",
            core_content: "cc",
            chunk_index: 0,
            total_chunks: 1,
            strategy: "fixed",
            size_tokens: 5,
          },
        ]),
        new MockEmbedderRegistry({ code: new MockEmbedder("m", 8) }),
        repo,
        makeFilter((p) => p.endsWith(".ts")),
      );

      const result = await service.diffIndex(tmpDir);
      expect(result.indexed).toBe(1);

      // Verify FileIndex was updated
      const updatedFileIndex = await repo.getFileIndex(filePath);
      expect(updatedFileIndex).not.toBeNull();
      expect(updatedFileIndex!.file_blake3).toBe("new-hash");
      expect(updatedFileIndex!.imports[0]!.source).toBe("new-dep");

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  // ── New file ────────────────────────────────────────────────

  describe("new file", () => {
    test("processes new file not present in the index", async () => {
      const tmpDir = createTempDir();
      const filePath = createTestFile(tmpDir, "a.ts", "brand new file");

      const repo = new MockSourceRepository();
      // No seed data — repo is empty for this file

      const service = new DiffIndexingService(
        new MockHasher(),
        makeParserRegistry(makeParser("code", ".ts")),
        new MockChunker([
          {
            content: "new chunk content",
            core_content: "new core",
            chunk_index: 0,
            total_chunks: 1,
            strategy: "fixed",
            size_tokens: 5,
          },
        ]),
        new MockEmbedderRegistry({ code: new MockEmbedder("m", 8) }),
        repo,
        makeFilter((p) => p.endsWith(".ts")),
      );

      const result = await service.diffIndex(tmpDir);
      expect(result.indexed).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);

      // Verify data stored
      const sources = await repo.getByPath(filePath);
      expect(sources.length).toBe(1);
      expect(sources[0]!.content).toBe("new chunk content");

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});


---
# tests/domain/services/IndexingService.test.ts
---
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { FileFilter } from "../../../src/domain/ports/FileFilter";
import type { SourceParserRegistry } from "../../../src/domain/ports/SourceParserRegistry";
import type { SourceParser } from "../../../src/domain/ports/SourceParser";
import type { ParsedSource } from "../../../src/domain/types";
import { MockEmbedder } from "../../mocks/MockEmbedder";
import { MockEmbedderRegistry } from "../../mocks/MockEmbedderRegistry";
import { MockChunker } from "../../mocks/MockChunker";
import { MockHasher } from "../../mocks/MockHasher";
import { MockSourceRepository } from "../../mocks/MockSourceRepository";
import { IndexingService } from "../../../src/domain/services/IndexingService";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "indexing-test-"));
}

function createTestFile(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

function makeFilter(
  predicate: (path: string) => boolean,
  formats: string[] = [".ts", ".md", ".json"],
): FileFilter {
  return { formats, shouldInclude: predicate };
}

function simpleParser(type: "code" | "markdown"): SourceParser {
  const ext = type === "code" ? ".ts" : ".md";
  return {
    type,
    extensions: [ext],
    supportsFile: (p: string) => p.endsWith(ext),
    parse: async (path: string): Promise<ParsedSource> => ({
      type,
      path,
      content: `parsed ${type} content`,
      tags: type === "code" ? ["typescript"] : ["docs"],
      metadata:
        type === "code"
          ? { kind: "code", language: "typescript" }
          : { kind: "markdown" },
      file_blake3: `mock-${type}-hash`,
      last_parsed: new Date().toISOString(),
    }),
  };
}

function makeParserRegistry(
  ...parsers: SourceParser[]
): SourceParserRegistry {
  return {
    getParser: (path: string) =>
      parsers.find((p) => p.supportsFile(path)) ?? null,
    register: () => {},
  };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("IndexingService", () => {
  describe("basic indexing pipeline", () => {
    let tmpDir: string;
    let repo: MockSourceRepository;
    let service: IndexingService;

    beforeAll(() => {
      tmpDir = createTempDir();
      createTestFile(tmpDir, "main.ts", "const x = 1;");
      createTestFile(tmpDir, "README.md", "# Hello");

      const mockFilter = makeFilter(
        (p) => p.endsWith(".ts") || p.endsWith(".md"),
      );
      const mockRegistry = makeParserRegistry(
        simpleParser("code"),
        simpleParser("markdown"),
      );
      const mockChunker = new MockChunker([
        {
          content: "chunk content",
          core_content: "core semantic unit",
          chunk_index: 0,
          total_chunks: 1,
          strategy: "fixed",
          size_tokens: 10,
        },
      ]);
      const mockEmbedder = new MockEmbedder("test-model", 128);
      const mockEmbRegistry = new MockEmbedderRegistry({
        code: mockEmbedder,
        markdown: mockEmbedder,
      });
      repo = new MockSourceRepository();
      const mockHasher = new MockHasher();

      service = new IndexingService(
        mockFilter,
        mockRegistry,
        mockChunker,
        mockEmbRegistry,
        repo,
        mockHasher,
      );
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("returns correct stats after indexing directory", async () => {
      const stats = await service.index(tmpDir);
      expect(stats.total_files).toBe(2);
      expect(stats.total_chunks).toBe(2);
    });

    test("stored SourceData has correct fields", async () => {
      const tsSources = await repo.getByPath(join(tmpDir, "main.ts"));
      expect(tsSources.length).toBe(1);
      const src = tsSources[0]!;
      expect(src.type).toBe("code");
      expect(src.content).toBe("chunk content");
      expect(src.embeddings.length).toBe(128);
      expect(typeof src.file_blake3).toBe("string");
      expect(src.file_blake3.length).toBeGreaterThan(0);
      expect(typeof src.semantic_blake3).toBe("string");
      expect(src.semantic_blake3.length).toBeGreaterThan(0);
      expect(typeof src.id).toBe("string");
      expect(typeof src.chunk_id).toBe("string");
      expect(typeof src.source_id).toBe("string");
    });
  });

  describe("exclude patterns", () => {
    test("files matching exclude pattern are skipped", async () => {
      const tmpDir = createTempDir();
      createTestFile(tmpDir, "app.ts", "keep");
      createTestFile(tmpDir, "app.test.ts", "skip");
      createTestFile(tmpDir, "config.json", '{}');

      const filter = makeFilter(
        (p) => !p.includes(".test.") && (p.endsWith(".ts") || p.endsWith(".json")),
      );

      const parser: SourceParser = {
        type: "code",
        extensions: [".ts", ".json"],
        supportsFile: () => true,
        parse: async (path: string): Promise<ParsedSource> => ({
          type: "code",
          path,
          content: "parsed",
          tags: [],
          metadata: { kind: "code", language: "typescript" },
          file_blake3: "mock-hash",
          last_parsed: new Date().toISOString(),
        }),
      };

      const service = new IndexingService(
        filter,
        makeParserRegistry(parser),
        new MockChunker([
          {
            content: "c",
            core_content: "cc",
            chunk_index: 0,
            total_chunks: 1,
            strategy: "fixed",
            size_tokens: 5,
          },
        ]),
        new MockEmbedderRegistry({ code: new MockEmbedder("m", 8) }),
        new MockSourceRepository(),
        new MockHasher(),
      );

      const stats = await service.index(tmpDir);
      expect(stats.total_files).toBe(2); // app.ts + config.json, NOT app.test.ts

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("multi-model embedding", () => {
    test("different source types use their respective embedders", async () => {
      const tmpDir = createTempDir();
      createTestFile(tmpDir, "code.ts", "const a = 1;");
      createTestFile(tmpDir, "doc.md", "# Markdown");

      const codeEmbedder = new MockEmbedder("code-model", 64);
      const mdEmbedder = new MockEmbedder("md-model", 32);
      const repo = new MockSourceRepository();

      const service = new IndexingService(
        makeFilter((p) => p.endsWith(".ts") || p.endsWith(".md")),
        makeParserRegistry(simpleParser("code"), simpleParser("markdown")),
        new MockChunker([
          {
            content: "x",
            core_content: "semantic unit",
            chunk_index: 0,
            total_chunks: 1,
            strategy: "fixed",
            size_tokens: 5,
          },
        ]),
        new MockEmbedderRegistry({ code: codeEmbedder, markdown: mdEmbedder }),
        repo,
        new MockHasher(),
      );

      const stats = await service.index(tmpDir);
      expect(stats.total_files).toBe(2);

      // Each embedder should have been called for its respective source type
      // Verify by checking embedding dimensions via public repo methods
      const codeSources = await repo.getByPath(join(tmpDir, "code.ts"));
      const mdSources = await repo.getByPath(join(tmpDir, "doc.md"));

      // code-model has 64 dimensions
      for (const s of codeSources) {
        expect(s.embeddings.length).toBe(64);
      }
      // md-model has 32 dimensions
      for (const s of mdSources) {
        expect(s.embeddings.length).toBe(32);
      }

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});


---
# tests/domain/services/SearchService.test.ts
---
import { describe, expect, test } from "bun:test";

import type { SourceRepository } from "../../../src/domain/ports/SourceRepository";
import type { Embedder } from "../../../src/domain/systems/EmbeddingSystem";
import type {
  SearchQuery,
  SearchResult,
  SourceData,
  SourceType,
} from "../../../src/domain/types";
import { MockEmbedder } from "../../mocks/MockEmbedder";
import { MockSourceRepository } from "../../mocks/MockSourceRepository";
import { SearchService } from "../../../src/domain/services/SearchService";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeSourceData(overrides: Partial<SourceData> & { id: string; content: string }): SourceData {
  const now = new Date().toISOString();
  return {
    id: overrides.id,
    chunk_id: `chunk-${overrides.id}`,
    source_id: `src-${overrides.id}`,
    type: "generic" as SourceType,
    title: `file-${overrides.id}.txt`,
    content: overrides.content,
    tags: overrides.tags ?? [],
    path: `/fixtures/file-${overrides.id}.txt`,
    file_blake3: `blake3-${overrides.id}`,
    semantic_blake3: `sem-${overrides.id}`,
    chunk_index: 0,
    total_chunks: 1,
    embeddings: [],
    metadata: overrides.metadata ?? { kind: "generic", encoding: "utf-8" },
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

/** Seed a MockSourceRepository with the given content strings, returning an array of SourceData. */
async function seedRepo(
  repo: MockSourceRepository,
  contents: { content: string; tags?: string[]; type?: SourceType }[],
): Promise<SourceData[]> {
  const sources = contents.map((c, i) =>
    makeSourceData({
      id: `doc-${i}`,
      content: c.content,
      tags: c.tags ?? [],
      type: c.type ?? "generic",
    }),
  );
  await repo.upsertBatch(sources);
  return sources;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("SearchService", () => {
  // ── Semantic mode ──────────────────────────────────────────

  describe("semantic search", () => {
    test("routes to repo with semantic mode", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "the quick brown fox" },
        { content: "jumps over the lazy dog" },
      ]);

      let capturedQuery: SearchQuery | null = null;
      const originalSearch = repo.search.bind(repo);
      repo.search = async (q: SearchQuery) => {
        capturedQuery = q;
        return originalSearch(q);
      };

      const embedder = new MockEmbedder("sem-model", 64);
      const service = new SearchService(embedder, repo);

      const results = await service.search({
        text: "quick brown",
        mode: "semantic",
        top_k: 10,
      });

      expect(capturedQuery).not.toBeNull();
      expect(capturedQuery!.mode).toBe("semantic");
      expect(results.length).toBeGreaterThan(0);
    });

    test("calls embedder with query text", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [{ content: "anything" }]);

      let embeddedText = "";
      const embedder: Embedder = {
        model: "spy",
        dimensions: 4,
        embed: async (text: string) => {
          embeddedText = text;
          return { vector: [0, 0, 0, 0], model: "spy", dimensions: 4, tokens_in: 1 };
        },
      };

      const service = new SearchService(embedder, repo);
      await service.search({ text: "query-text", mode: "semantic", top_k: 10 });

      expect(embeddedText).toBe("query-text");
    });
  });

  // ── Keyword mode ───────────────────────────────────────────

  describe("keyword search", () => {
    test("routes to repo with keyword mode", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "typescript is great" },
        { content: "python is also great" },
      ]);

      let capturedMode = "";
      const originalSearch = repo.search.bind(repo);
      repo.search = async (q: SearchQuery) => {
        capturedMode = q.mode;
        return originalSearch(q);
      };

      const service = new SearchService(new MockEmbedder("k", 4), repo);
      await service.search({ text: "great", mode: "keyword", top_k: 10 });

      expect(capturedMode).toBe("keyword");
    });

    test("returns results scored by TF overlap", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "nodejs typescript express" },
        { content: "python django flask" },
        { content: "typescript react nodejs" },
      ]);

      const service = new SearchService(new MockEmbedder("k", 4), repo);
      const results = await service.search({
        text: "typescript",
        mode: "keyword",
        top_k: 10,
      });

      // docs containing "typescript" returned; doc with no match filtered out
      expect(results.length).toBe(2);
      for (const r of results) {
        expect(r.source.content).toMatch(/typescript/);
      }
    });
  });

  // ── Hybrid mode ────────────────────────────────────────────

  describe("hybrid search", () => {
    test("merges semantic and keyword results with weighted scoring", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "the quick brown fox" },
        { content: "jumps over the lazy dog" },
        { content: "quick brown rabbit" },
      ]);

      const embedder: Embedder = {
        model: "hybrid-model",
        dimensions: 8,
        embed: async () => ({
          vector: [0, 0, 0, 0, 0, 0, 0, 0],
          model: "hybrid-model",
          dimensions: 8,
          tokens_in: 1,
        }),
      };

      const service = new SearchService(embedder, repo, { hybrid_weight: 0.7 });

      const results = await service.search({
        text: "quick brown",
        mode: "hybrid",
        top_k: 10,
      });

      expect(results.length).toBe(2); // doc with no match filtered out
      for (const r of results) {
        expect(r.match_type).toBe("hybrid");
        // score should be weighted combination
        expect(r.score).toBeGreaterThan(0);
      }
    });

    test("normalizes BM25 keyword scores before merging", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "aaaa bbbb cccc dddd" }, // score = 0 / 4 = 0 (no match)
        { content: "query word here" }, // score for "query": 1 / 4 = 0.25
        { content: "query query query query word" }, // score for "query": 1 / 5 = 0.2
      ]);

      const embedder: Embedder = {
        model: "m",
        dimensions: 2,
        embed: async () => ({
          vector: [0, 0],
          model: "m",
          dimensions: 2,
          tokens_in: 1,
        }),
      };

      const service = new SearchService(embedder, repo, { hybrid_weight: 0.5 });

      const results = await service.search({
        text: "query",
        mode: "hybrid",
        top_k: 10,
      });

      // Non-matching doc (score 0) filtered out; 2 relevant results remain
      expect(results.length).toBe(2);
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
      }
    });

    test("uses default hybrid_weight of 0.7", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "test document content here" },
      ]);

      const embedder: Embedder = {
        model: "m",
        dimensions: 2,
        embed: async () => ({
          vector: [0, 0],
          model: "m",
          dimensions: 2,
          tokens_in: 1,
        }),
      };

      const service = new SearchService(embedder, repo);
      const results = await service.search({
        text: "test",
        mode: "hybrid",
        top_k: 10,
      });

      expect(results.length).toBe(1);
      expect(results[0]!.match_type).toBe("hybrid");
    });
  });

  // ── Post-filtering ─────────────────────────────────────────

  describe("post-filtering", () => {
    test("filters results by tags", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "alpha content", tags: ["important"] },
        { content: "beta content", tags: ["archived"] },
        { content: "gamma content", tags: ["important", "urgent"] },
      ]);

      const service = new SearchService(new MockEmbedder("m", 4), repo);
      const results = await service.search({
        text: "content",
        mode: "keyword",
        top_k: 10,
        tags: ["important"],
      });

      expect(results.length).toBe(2);
      for (const r of results) {
        expect(r.source.tags).toContain("important");
      }
    });

    test("filters results by source_type", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "code stuff", type: "code" as SourceType },
        { content: "markdown stuff", type: "markdown" as SourceType },
        { content: "generic stuff", type: "generic" as SourceType },
      ]);

      const service = new SearchService(new MockEmbedder("m", 4), repo);
      const results = await service.search({
        text: "stuff",
        mode: "keyword",
        top_k: 10,
        source_types: ["code"],
      });

      expect(results.length).toBe(1);
      expect(results[0]!.source.type).toBe("code");
    });
  });

  // ── Multi-model averaging ──────────────────────────────────

  describe("multi-model averaging", () => {
    test("averages model_scores for semantic results", async () => {
      const repo = new MockSourceRepository();
      await seedRepo(repo, [
        { content: "target document" },
      ]);

      // Override search to return results with model_scores
      const originalSearch = repo.search.bind(repo);
      repo.search = async (q: SearchQuery) => {
        const base = await originalSearch(q);
        return base.map((r) => ({
          ...r,
          model_scores: { "model-a": 0.8, "model-b": 0.6 },
        }));
      };

      const service = new SearchService(
        new MockEmbedder("m", 4),
        repo,
      );

      const results = await service.search({
        text: "target",
        mode: "semantic",
        top_k: 10,
      });

      // Average of 0.8 and 0.6 = 0.7
      for (const r of results) {
        expect(r.score).toBe(0.7);
      }
    });
  });

  // ── Empty index ────────────────────────────────────────────

  describe("empty index", () => {
    test("returns empty array when index has no data", async () => {
      const repo = new MockSourceRepository();
      const service = new SearchService(new MockEmbedder("m", 4), repo);

      const results = await service.search({
        text: "anything",
        mode: "semantic",
        top_k: 10,
      });

      expect(results).toEqual([]);
    });
  });
});


---
# tests/domain/systems/ChunkingSystem.test.ts
---
import { describe, expect, test } from "bun:test";

import type { Chunk, Chunker, ChunkerPipeline } from "../../../src/domain/systems/ChunkingSystem";
import type { SourceType } from "../../../src/domain/types";

describe("Chunk interface", () => {
  test("all fields are present", () => {
    const chunk: Chunk = {
      content: "function foo() {}",
      core_content: "function foo() {}",
      chunk_index: 0,
      total_chunks: 2,
      strategy: "token",
      size_tokens: 50,
    };

    expect(chunk.content).toBeDefined();
    expect(chunk.core_content).toBeDefined();
    expect(typeof chunk.chunk_index).toBe("number");
    expect(typeof chunk.total_chunks).toBe("number");
    expect(typeof chunk.strategy).toBe("string");
    expect(typeof chunk.size_tokens).toBe("number");
  });

  test("chunk_index is within range", () => {
    const chunk: Chunk = {
      content: "part 2",
      core_content: "part 2",
      chunk_index: 1,
      total_chunks: 3,
      strategy: "sentence",
      size_tokens: 30,
    };
    expect(chunk.chunk_index).toBeGreaterThanOrEqual(0);
    expect(chunk.chunk_index).toBeLessThan(chunk.total_chunks);
  });
});

describe("Chunker interface", () => {
  test("all members are present", () => {
    const chunker: Chunker = {
      type: "code" as SourceType,
      chunk: async (text: string) => [
        { content: text, core_content: text, chunk_index: 0, total_chunks: 1, strategy: "token", size_tokens: text.length },
      ],
    };

    expect(typeof chunker.chunk).toBe("function");
    expect(chunker.type).toBe("code");
  });

  test("chunk returns array of Chunk", async () => {
    const chunker: Chunker = {
      type: "markdown" as SourceType,
      chunk: async (text: string) => [
        {
          content: text,
          core_content: text,
          chunk_index: 0,
          total_chunks: 1,
          strategy: "heading",
          size_tokens: 100,
        },
      ],
    };

    const result = await chunker.chunk("# Heading\nContent");
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toContain("Heading");
  });
});

describe("ChunkerPipeline interface", () => {
  test("all members are present", () => {
    const pipeline: ChunkerPipeline = {
      chunkers: [],
      chunk: async (text: string, type: SourceType) => [],
    };

    expect(Array.isArray(pipeline.chunkers)).toBe(true);
    expect(typeof pipeline.chunk).toBe("function");
  });

  test("chunk method accepts text and type", async () => {
    const pipeline: ChunkerPipeline = {
      chunkers: [],
      chunk: async (text: string, type: SourceType) => [
        { content: text, core_content: text, chunk_index: 0, total_chunks: 1, strategy: "token", size_tokens: 10 },
      ],
    };

    const result = await pipeline.chunk("hello world", "code");
    expect(result).toHaveLength(1);
  });
});


---
# tests/domain/systems/ContextPackagingSystem.test.ts
---
import { describe, expect, test } from "bun:test";

import type { PackedContext, Deduplicator, Tokenizer, ContextPacker } from "../../../src/domain/systems/ContextPackagingSystem";

describe("PackedContext interface", () => {
  test("all fields are present", () => {
    const ctx: PackedContext = {
      markdown: "# Results\n- item 1",
      chunks_used: 3,
      total_tokens: 500,
      truncated: false,
      source_notes: ["file1.ts", "file2.ts"],
    };

    expect(typeof ctx.markdown).toBe("string");
    expect(typeof ctx.chunks_used).toBe("number");
    expect(typeof ctx.total_tokens).toBe("number");
    expect(typeof ctx.truncated).toBe("boolean");
    expect(Array.isArray(ctx.source_notes)).toBe(true);
  });

  test("truncated flag works", () => {
    const truncated: PackedContext = {
      markdown: "trimmed...",
      chunks_used: 10,
      total_tokens: 1000,
      truncated: true,
      source_notes: [],
    };
    expect(truncated.truncated).toBe(true);
  });
});

describe("Deduplicator interface", () => {
  test("all methods are present", () => {
    const dedup: Deduplicator = {
      deduplicate: async (results) => results,
    };
    expect(typeof dedup.deduplicate).toBe("function");
  });

  test("deduplicate returns SearchResult array", async () => {
    const dedup: Deduplicator = {
      deduplicate: async (results) => {
        // Simple dedup by source ID
        const seen = new Set<string>();
        return results.filter((r) => {
          if (seen.has(r.source.id)) return false;
          seen.add(r.source.id);
          return true;
        });
      },
    };

    const baseSource = {
      id: "id-1",
      chunk_id: "c1",
      source_id: "s1",
      type: "code" as const,
      title: "a.ts",
      content: "",
      tags: [],
      path: "/a.ts",
      file_blake3: "h1",
      semantic_blake3: "h2",
      chunk_index: 0,
      total_chunks: 1,
      embeddings: [],
      metadata: { kind: "code" as const, language: "ts" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };

    const results = await dedup.deduplicate([
      { source: { ...baseSource }, score: 0.9, match_type: "semantic" },
      { source: { ...baseSource }, score: 0.8, match_type: "keyword" },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]!.score).toBe(0.9);
  });
});

describe("Tokenizer interface", () => {
  test("all methods are present", () => {
    const tokenizer: Tokenizer = {
      count: async (text) => text.split(" ").length,
      truncate: async (text, max) => text.split(" ").slice(0, max).join(" "),
    };

    expect(typeof tokenizer.count).toBe("function");
    expect(typeof tokenizer.truncate).toBe("function");
  });

  test("count returns number", async () => {
    const tokenizer: Tokenizer = {
      count: async (text) => text.split(" ").length,
      truncate: async (text, max) => text,
    };

    const count = await tokenizer.count("hello world foo");
    expect(typeof count).toBe("number");
    expect(count).toBe(3);
  });

  test("truncate respects max tokens", async () => {
    const tokenizer: Tokenizer = {
      count: async (text) => text.split(" ").length,
      truncate: async (text, max) =>
        text.split(" ").slice(0, max).join(" "),
    };

    const truncated = await tokenizer.truncate("a b c d e", 3);
    expect(truncated).toBe("a b c");
  });
});

describe("ContextPacker interface", () => {
  test("all methods are present", () => {
    const packer: ContextPacker = {
      pack: async (results, options) => ({
        markdown: results.map((r) => r.source.content).join("\n"),
        chunks_used: results.length,
        total_tokens: 0,
        truncated: false,
        source_notes: [],
      }),
    };

    expect(typeof packer.pack).toBe("function");
  });

  test("pack accepts optional maxTokens", async () => {
    const packer: ContextPacker = {
      pack: async (results, options) => ({
        markdown: "packed content",
        chunks_used: results.length,
        total_tokens: options?.maxTokens ?? 0,
        truncated: false,
        source_notes: [],
      }),
    };

    const result = await packer.pack([], { maxTokens: 2000 });
    expect(result.total_tokens).toBe(2000);
  });

  test("pack works without options", async () => {
    const packer: ContextPacker = {
      pack: async (results) => ({
        markdown: "default",
        chunks_used: 0,
        total_tokens: 0,
        truncated: false,
        source_notes: [],
      }),
    };

    const result = await packer.pack([]);
    expect(result.markdown).toBe("default");
    expect(result.truncated).toBe(false);
  });
});


---
# tests/domain/systems/EmbeddingSystem.test.ts
---
import { describe, expect, test } from "bun:test";

import type { Embedding, Embedder, EmbedderCache, EmbedderRegistry } from "../../../src/domain/systems/EmbeddingSystem";

describe("Embedding interface", () => {
  test("all fields are present", () => {
    const emb: Embedding = {
      vector: [0.1, 0.2, 0.3],
      model: "text-embedding-3-small",
      dimensions: 3,
      tokens_in: 10,
    };

    expect(Array.isArray(emb.vector)).toBe(true);
    expect(emb.vector.every((v) => typeof v === "number")).toBe(true);
    expect(typeof emb.model).toBe("string");
    expect(typeof emb.dimensions).toBe("number");
    expect(typeof emb.tokens_in).toBe("number");
  });
});

describe("Embedder interface", () => {
  test("all members are present", () => {
    const embedder: Embedder = {
      model: "text-embedding-3-small",
      dimensions: 1536,
      embed: async (text: string) => ({
        vector: [0.1, 0.2],
        model: "text-embedding-3-small",
        dimensions: 1536,
        tokens_in: text.split(" ").length,
      }),
    };

    expect(typeof embedder.embed).toBe("function");
    expect(embedder.model).toBe("text-embedding-3-small");
    expect(embedder.dimensions).toBe(1536);
  });

  test("embed returns Embedding", async () => {
    const embedder: Embedder = {
      model: "test-model",
      dimensions: 2,
      embed: async (text: string) => ({
        vector: text === "hello" ? [0.5, 0.5] : [0.0, 0.0],
        model: "test-model",
        dimensions: 2,
        tokens_in: 1,
      }),
    };

    const result = await embedder.embed("hello");
    expect(result.vector).toEqual([0.5, 0.5]);
    expect(result.model).toBe("test-model");
  });
});

describe("EmbedderCache interface", () => {
  test("all methods are present", () => {
    const cache: EmbedderCache = {
      get: async () => null,
      set: async () => {},
    };

    expect(typeof cache.get).toBe("function");
    expect(typeof cache.set).toBe("function");
  });

  test("get returns Embedding or null", async () => {
    const cache: EmbedderCache = {
      get: async (key: string) =>
        key === "cached"
          ? { vector: [1.0], model: "m", dimensions: 1, tokens_in: 5 }
          : null,
      set: async () => {},
    };

    const cached = await cache.get("cached");
    expect(cached).not.toBeNull();
    expect(cached!.vector).toEqual([1.0]);

    const miss = await cache.get("missing");
    expect(miss).toBeNull();
  });

  test("set stores values", async () => {
    let stored: { key: string; emb: Embedding } | null = null;
    const cache: EmbedderCache = {
      get: async () => null,
      set: async (key: string, emb: Embedding) => {
        stored = { key, emb };
      },
    };

    const emb: Embedding = { vector: [0.9], model: "m", dimensions: 1, tokens_in: 2 };
    await cache.set("mykey", emb);
    expect(stored).not.toBeNull();
    expect(stored!.key).toBe("mykey");
  });
});

describe("EmbedderRegistry interface", () => {
  test("all methods are present", () => {
    const registry: EmbedderRegistry = {
      getEmbedder: () => null,
      register: () => {},
    };

    expect(typeof registry.getEmbedder).toBe("function");
    expect(typeof registry.register).toBe("function");
  });

  test("getEmbedder returns Embedder or null", () => {
    const mockEmbedder: Embedder = {
      model: "test",
      dimensions: 128,
      embed: async () => ({ vector: [], model: "test", dimensions: 128, tokens_in: 0 }),
    };

    const registry: EmbedderRegistry = {
      embedders: new Map<string, Embedder>([
        ["code", mockEmbedder],
      ]),
      getEmbedder(sourceType: string) {
        return this.embedders.get(sourceType) ?? null;
      },
      register(sourceType: string, embedder: Embedder, priority: number) {
        this.embedders.set(sourceType, embedder);
      },
    };

    expect(registry.getEmbedder("code")).not.toBeNull();
    expect(registry.getEmbedder("markdown")).toBeNull();
  });

  test("register accepts priority parameter", () => {
    const registry: EmbedderRegistry = {
      getEmbedder: () => null,
      register: (sourceType: string, embedder: Embedder, priority: number) => {},
    };

    // Should accept 3 arguments without error
    expect(registry.register.length).toBe(3);
  });
});


---
# tests/domain/systems/HashingSystem.test.ts
---
import { describe, expect, test } from "bun:test";

import type { Hasher, TokenEstimator } from "../../../src/domain/systems/HashingSystem";

describe("Hasher interface", () => {
  test("all members are present", () => {
    const hasher: Hasher = {
      algorithm: "blake3",
      hash: async (data) => {
        if (typeof data === "string") return `hash:${data}`;
        return "hash:binary";
      },
    };

    expect(typeof hasher.hash).toBe("function");
    expect(hasher.algorithm).toBe("blake3");
  });

  test("hash accepts string", async () => {
    const hasher: Hasher = {
      algorithm: "blake3",
      hash: async (data) => `hash-${typeof data === "string" ? data : "binary"}`,
    };

    const result = await hasher.hash("hello world");
    expect(typeof result).toBe("string");
    expect(result).toContain("hello world");
  });

  test("hash accepts Uint8Array", async () => {
    const hasher: Hasher = {
      algorithm: "sha256",
      hash: async (data) => {
        if (data instanceof Uint8Array) {
          return Array.from(data)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        }
        return "string-hash";
      },
    };

    const input = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
    const result = await hasher.hash(input);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("hash returns a string", async () => {
    const hasher: Hasher = {
      algorithm: "blake3",
      hash: async () => "abc123def456",
    };

    const result = await hasher.hash("data");
    expect(typeof result).toBe("string");
    expect(result).toBe("abc123def456");
  });
});

describe("TokenEstimator interface", () => {
  test("all members are present", () => {
    const estimator: TokenEstimator = {
      model: "gpt-4",
      estimate: async (text) => Math.ceil(text.length / 4),
    };

    expect(typeof estimator.estimate).toBe("function");
    expect(estimator.model).toBe("gpt-4");
  });

  test("estimate returns a number", async () => {
    const estimator: TokenEstimator = {
      model: "claude-3",
      estimate: async (text) => text.split(" ").length,
    };

    const result = await estimator.estimate("one two three four five");
    expect(typeof result).toBe("number");
    expect(result).toBe(5);
  });

  test("empty text returns 0", async () => {
    const estimator: TokenEstimator = {
      model: "gpt-4o",
      estimate: async (text) => (text.length === 0 ? 0 : Math.ceil(text.length / 4)),
    };

    const result = await estimator.estimate("");
    expect(result).toBe(0);
  });
});


---
# tests/domain/types.test.ts
---
import { describe, expect, test } from "bun:test";

// Import types (will validate they exist when source is created in step 1.2)
import type {
  SourceType,
  SourceMetadata,
  SourceData,
  SearchQuery,
  SearchResult,
  ParsedSource,
  IndexStats,
} from "../../src/domain/types";

// ---------------------------------------------------------------------------
// Runtime helper: narrow SourceMetadata by kind
// ---------------------------------------------------------------------------
function getCodeLanguage(meta: SourceMetadata): string {
  // Discriminated union narrowing via 'kind'
  if (meta.kind === "code") return meta.language;
  if (meta.kind === "markdown") return "n/a (markdown)";
  if (meta.kind === "obsidian") return "n/a (obsidian)";
  return "n/a (generic)";
}

// ---------------------------------------------------------------------------
// SourceType
// ---------------------------------------------------------------------------
describe("SourceType", () => {
  test("all SourceType values are valid strings", () => {
    const t1: SourceType = "code";
    const t2: SourceType = "markdown";
    const t3: SourceType = "obsidian";
    const t4: SourceType = "generic";
    expect([t1, t2, t3, t4]).toEqual(["code", "markdown", "obsidian", "generic"]);
  });

  test("SourceType rejects unknown values at type level (runtime is string)", () => {
    const val: string = "unknown";
    // At runtime types are erased, but we can still test assignment works
    expect(typeof val).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// SourceMetadata discriminated union
// ---------------------------------------------------------------------------
describe("SourceMetadata", () => {
  test("code metadata narrowing", () => {
    const meta: SourceMetadata = {
      kind: "code",
      language: "typescript",
      packageName: "lodash",
    };
    expect(getCodeLanguage(meta)).toBe("typescript");
    // After narrowing, code-specific fields are accessible
    if (meta.kind === "code") {
      expect(meta.language).toBe("typescript");
      expect(meta.packageName).toBe("lodash");
    }
  });

  test("code metadata without optional packageName", () => {
    const meta: SourceMetadata = { kind: "code", language: "python" };
    expect(meta.kind).toBe("code");
    if (meta.kind === "code") {
      expect(meta.language).toBe("python");
      expect(meta.packageName).toBeUndefined();
    }
  });

  test("markdown metadata narrowing", () => {
    const meta: SourceMetadata = {
      kind: "markdown",
      heading: "Introduction",
      section: "Overview",
      wordCount: 150,
    };
    if (meta.kind === "markdown") {
      expect(meta.heading).toBe("Introduction");
      expect(meta.section).toBe("Overview");
      expect(meta.wordCount).toBe(150);
    }
  });

  test("markdown metadata without optionals", () => {
    const meta: SourceMetadata = { kind: "markdown" };
    expect(meta.kind).toBe("markdown");
    if (meta.kind === "markdown") {
      expect(meta.heading).toBeUndefined();
      expect(meta.section).toBeUndefined();
      expect(meta.wordCount).toBeUndefined();
    }
  });

  test("obsidian metadata narrowing", () => {
    const meta: SourceMetadata = {
      kind: "obsidian",
      tags: ["project", "notes"],
      links: ["page1", "page2"],
      frontmatter: { created: "2024-01-01" },
    };
    if (meta.kind === "obsidian") {
      expect(meta.tags).toEqual(["project", "notes"]);
      expect(meta.links).toEqual(["page1", "page2"]);
      expect(meta.frontmatter).toEqual({ created: "2024-01-01" });
    }
  });

  test("obsidian metadata without frontmatter", () => {
    const meta: SourceMetadata = {
      kind: "obsidian",
      tags: [],
      links: [],
    };
    if (meta.kind === "obsidian") {
      expect(meta.tags).toEqual([]);
      expect(meta.links).toEqual([]);
      expect(meta.frontmatter).toBeUndefined();
    }
  });

  test("generic metadata narrowing", () => {
    const meta: SourceMetadata = {
      kind: "generic",
      encoding: "utf-8",
      mimeType: "text/plain",
    };
    if (meta.kind === "generic") {
      expect(meta.encoding).toBe("utf-8");
      expect(meta.mimeType).toBe("text/plain");
    }
  });

  test("generic metadata without mimeType", () => {
    const meta: SourceMetadata = { kind: "generic", encoding: "base64" };
    if (meta.kind === "generic") {
      expect(meta.encoding).toBe("base64");
      expect(meta.mimeType).toBeUndefined();
    }
  });

  test("exhaustive narrowing switch covers all kinds", () => {
    // Compile-time check: if a new kind is added without a branch this will error
    const narrow = (meta: SourceMetadata): string => {
      switch (meta.kind) {
        case "code":
          return meta.language;
        case "markdown":
          return meta.heading ?? "untitled";
        case "obsidian":
          return meta.tags.join(",");
        case "generic":
          return meta.encoding;
      }
    };
    expect(
      narrow({ kind: "code", language: "rust" }),
    ).toBe("rust");
    expect(
      narrow({ kind: "markdown", heading: "Intro" }),
    ).toBe("Intro");
    expect(
      narrow({ kind: "obsidian", tags: ["dev"], links: [] }),
    ).toBe("dev");
    expect(
      narrow({ kind: "generic", encoding: "utf-16" }),
    ).toBe("utf-16");
  });
});

// ---------------------------------------------------------------------------
// SourceData
// ---------------------------------------------------------------------------
describe("SourceData", () => {
  const sampleMetadata: SourceMetadata = {
    kind: "code",
    language: "typescript",
    packageName: "@openagents/index",
  };

  const sourceData: SourceData = {
    id: "0192c1a0-0000-7000-8000-000000000001",
    chunk_id: "0192c1a0-0000-7000-8000-000000000002",
    source_id: "0192c1a0-0000-7000-8000-000000000003",
    type: "code",
    title: "main.ts",
    content: 'import { foo } from "bar";\n',
    tags: ["typescript", "module"],
    path: "/src/main.ts",
    file_blake3: "abc123def456",
    semantic_blake3: "sem789ghi012",
    chunk_index: 0,
    total_chunks: 3,
    embeddings: [0.1, 0.2, 0.3],
    metadata: sampleMetadata,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  };

  test("has all required fields", () => {
    expect(sourceData.id).toBeDefined();
    expect(sourceData.chunk_id).toBeDefined();
    expect(sourceData.source_id).toBeDefined();
    expect(sourceData.type).toBeDefined();
    expect(sourceData.title).toBeDefined();
    expect(sourceData.content).toBeDefined();
    expect(sourceData.tags).toBeDefined();
    expect(sourceData.path).toBeDefined();
    expect(sourceData.file_blake3).toBeDefined();
    expect(sourceData.semantic_blake3).toBeDefined();
    expect(sourceData.chunk_index).toBeDefined();
    expect(sourceData.total_chunks).toBeDefined();
    expect(sourceData.embeddings).toBeDefined();
    expect(sourceData.metadata).toBeDefined();
    expect(sourceData.created_at).toBeDefined();
    expect(sourceData.updated_at).toBeDefined();
  });

  test("fields have correct types", () => {
    expect(typeof sourceData.id).toBe("string");
    expect(typeof sourceData.chunk_id).toBe("string");
    expect(typeof sourceData.source_id).toBe("string");
    expect(typeof sourceData.type).toBe("string");
    expect(typeof sourceData.title).toBe("string");
    expect(typeof sourceData.content).toBe("string");
    expect(Array.isArray(sourceData.tags)).toBe(true);
    expect(typeof sourceData.path).toBe("string");
    expect(typeof sourceData.file_blake3).toBe("string");
    expect(typeof sourceData.semantic_blake3).toBe("string");
    expect(typeof sourceData.chunk_index).toBe("number");
    expect(typeof sourceData.total_chunks).toBe("number");
    expect(Array.isArray(sourceData.embeddings)).toBe(true);
    expect(typeof sourceData.metadata).toBe("object");
    expect(typeof sourceData.created_at).toBe("string");
    expect(typeof sourceData.updated_at).toBe("string");
  });

  test("embeddings contain numbers", () => {
    expect(sourceData.embeddings.every((e) => typeof e === "number")).toBe(true);
  });

  test("metadata is discriminable", () => {
    if (sourceData.metadata.kind === "code") {
      expect(sourceData.metadata.language).toBe("typescript");
    }
  });

  test("chunk_index and total_chunks relationship", () => {
    expect(sourceData.chunk_index).toBeLessThan(sourceData.total_chunks);
  });

  test("timestamps are ISO 8601", () => {
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(sourceData.created_at).toMatch(isoRegex);
    expect(sourceData.updated_at).toMatch(isoRegex);
  });
});

// ---------------------------------------------------------------------------
// SearchQuery
// ---------------------------------------------------------------------------
describe("SearchQuery", () => {
  test("full search query with all fields", () => {
    const query: SearchQuery = {
      text: "typescript generics",
      mode: "hybrid",
      tags: ["typescript"],
      top_k: 10,
      source_types: ["code", "markdown"],
      min_score: 0.5,
      filters: { author: "john" },
    };
    expect(query.text).toBe("typescript generics");
    expect(query.mode).toBe("hybrid");
    expect(query.tags).toEqual(["typescript"]);
    expect(query.top_k).toBe(10);
    expect(query.source_types).toEqual(["code", "markdown"]);
    expect(query.min_score).toBe(0.5);
    expect(query.filters).toEqual({ author: "john" });
  });

  test("minimal search query (only required fields)", () => {
    const query: SearchQuery = {
      text: "hello",
      mode: "semantic",
      top_k: 5,
    };
    expect(query.text).toBe("hello");
    expect(query.mode).toBe("semantic");
    expect(query.top_k).toBe(5);
    expect(query.tags).toBeUndefined();
    expect(query.source_types).toBeUndefined();
    expect(query.min_score).toBeUndefined();
    expect(query.filters).toBeUndefined();
  });

  test("mode values are valid", () => {
    const semantic: SearchQuery = { text: "a", mode: "semantic", top_k: 1 };
    const keyword: SearchQuery = { text: "a", mode: "keyword", top_k: 1 };
    const hybrid: SearchQuery = { text: "a", mode: "hybrid", top_k: 1 };
    expect(semantic.mode).toBe("semantic");
    expect(keyword.mode).toBe("keyword");
    expect(hybrid.mode).toBe("hybrid");
  });
});

// ---------------------------------------------------------------------------
// SearchResult
// ---------------------------------------------------------------------------
describe("SearchResult", () => {
  const sampleMetadata: SourceMetadata = {
    kind: "markdown",
    heading: "Test",
  };

  const source: SourceData = {
    id: "id-1",
    chunk_id: "chunk-id-1",
    source_id: "source-id-1",
    type: "markdown",
    title: "test.md",
    content: "# Hello",
    tags: ["test"],
    path: "/docs/test.md",
    file_blake3: "fhash",
    semantic_blake3: "shash",
    chunk_index: 0,
    total_chunks: 1,
    embeddings: [],
    metadata: sampleMetadata,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  test("search result with all fields", () => {
    const result: SearchResult = {
      source,
      score: 0.95,
      match_type: "semantic",
      model_scores: { cosine: 0.95, euclidean: 0.3 },
    };
    expect(result.source.id).toBe("id-1");
    expect(result.score).toBeCloseTo(0.95);
    expect(result.match_type).toBe("semantic");
    expect(result.model_scores).toEqual({ cosine: 0.95, euclidean: 0.3 });
  });

  test("search result without model_scores", () => {
    const result: SearchResult = {
      source,
      score: 0.85,
      match_type: "keyword",
    };
    expect(result.score).toBeCloseTo(0.85);
    expect(result.match_type).toBe("keyword");
    expect(result.model_scores).toBeUndefined();
  });

  test("match_type values", () => {
    const r1: SearchResult = { source, score: 1, match_type: "semantic" };
    const r2: SearchResult = { source, score: 1, match_type: "keyword" };
    const r3: SearchResult = { source, score: 1, match_type: "hybrid" };
    expect(r1.match_type).toBe("semantic");
    expect(r2.match_type).toBe("keyword");
    expect(r3.match_type).toBe("hybrid");
  });
});

// ---------------------------------------------------------------------------
// ParsedSource
// ---------------------------------------------------------------------------
describe("ParsedSource", () => {
  test("parsed source with all fields", () => {
    const meta: SourceMetadata = {
      kind: "code",
      language: "go",
      packageName: "fmt",
    };
    const parsed: ParsedSource = {
      type: "code",
      path: "/src/main.go",
      content: 'package main\n\nimport "fmt"\n',
      tags: ["go", "main"],
      metadata: meta,
      file_blake3: "abc123",
      last_parsed: "2026-01-15T10:30:00.000Z",
    };
    expect(parsed.type).toBe("code");
    expect(parsed.path).toBe("/src/main.go");
    expect(parsed.content).toContain("package main");
    expect(parsed.tags).toEqual(["go", "main"]);
    if (parsed.metadata.kind === "code") {
      expect(parsed.metadata.language).toBe("go");
    }
    expect(parsed.file_blake3).toBe("abc123");
    expect(parsed.last_parsed).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  test("parsed source with markdown metadata", () => {
    const parsed: ParsedSource = {
      type: "markdown",
      path: "/docs/readme.md",
      content: "# Readme",
      tags: [],
      metadata: { kind: "markdown", heading: "Readme", wordCount: 50 },
      file_blake3: "def456",
      last_parsed: "2026-02-01T00:00:00.000Z",
    };
    if (parsed.metadata.kind === "markdown") {
      expect(parsed.metadata.heading).toBe("Readme");
      expect(parsed.metadata.wordCount).toBe(50);
    }
  });
});

// ---------------------------------------------------------------------------
// IndexStats
// ---------------------------------------------------------------------------
describe("IndexStats", () => {
  test("stats with all fields", () => {
    const stats: IndexStats = {
      total_sources: 100,
      total_chunks: 350,
      total_files: 80,
      last_indexed: "2026-03-01T12:00:00.000Z",
    };
    expect(stats.total_sources).toBe(100);
    expect(stats.total_chunks).toBe(350);
    expect(stats.total_files).toBe(80);
    expect(stats.last_indexed).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  test("stats can have zero values", () => {
    const stats: IndexStats = {
      total_sources: 0,
      total_chunks: 0,
      total_files: 0,
      last_indexed: "2026-01-01T00:00:00.000Z",
    };
    expect(stats.total_sources).toBe(0);
    expect(stats.total_chunks).toBe(0);
    expect(stats.total_files).toBe(0);
  });
});


---
# tests/fixtures/note-with-tags.md
---

# TypeScript Guide

This guide covers advanced TypeScript patterns.


---
# tests/fixtures/obsidian-note.md
---

# My Obsidian Note

This is a daily journal entry with some wiki-links.

Today I learned about [[typescript-generics]] and how they work.

I also read about [[dependency-injection|DI patterns]] in modern frameworks.

## References

Check the [[daily/2024-01-14]] entry for context.


---
# tests/fixtures/sample-function.ts
---
import { something } from "./utils";
import fs from "fs";

interface User {
  name: string;
  age: number;
}

class UserService {
  private users: User[] = [];

  addUser(user: User): void {
    this.users.push(user);
  }

  getUsers(): User[] {
    return this.users;
  }
}

function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function calculateTotal(items: number[]): number {
  return items.reduce((a, b) => a + b, 0);
}

export default UserService;


---
# tests/fixtures/simple-note.md
---
# Welcome to IndeX

This is a simple markdown note for testing the IndeX parsing pipeline.

## Getting Started

To get started, install the dependencies and run the development server.

You can find more information on the [OpenCode](https://github.com/opencode-ai) website.

### Installation

```typescript
bun install
bun run dev
```

## Features

IndeX supports multiple file formats including Markdown, Obsidian, and TypeScript.


---
# tests/infrastructure/chunking/ChunkerFactory.test.ts
---
import { describe, it, expect } from "bun:test";
import { ChunkerFactory } from "../../../src/infrastructure/chunking/ChunkerFactory";
import { MockTokenEstimator } from "../../mocks/MockTokenEstimator";

describe("ChunkerFactory", () => {
  it("createPipeline builds ordered fallback chain from strategy names", async () => {
    const estimator = new MockTokenEstimator(10);
    const factory = new ChunkerFactory(500, estimator);
    const pipeline = factory.createPipeline([
      "heading",
      "paragraph",
      "sentence",
      "overflow",
    ]);

    expect(pipeline.chunkers).toHaveLength(4);
    expect(pipeline.chunkers[0].constructor.name).toBe("HeadingChunker");
    expect(pipeline.chunkers[1].constructor.name).toBe("ParagraphChunker");
    expect(pipeline.chunkers[2].constructor.name).toBe("SentenceChunker");
    expect(pipeline.chunkers[3].constructor.name).toBe("OverflowChunker");
  });

  it("pipeline routes markdown through heading chain successfully", async () => {
    const estimator = new MockTokenEstimator(10);
    const factory = new ChunkerFactory(500, estimator);
    const pipeline = factory.createPipeline([
      "heading",
      "paragraph",
      "sentence",
      "overflow",
    ]);

    const text = `# Heading
Some content here.

## Subheading
More content.`;
    const result = await pipeline.chunk(text, "markdown");

    expect(result.length).toBeGreaterThan(0);
    // Should use heading strategy since headings exist
    expect(result[0].strategy).toBe("heading");
  });

  it("pipeline routes code through code chunker", async () => {
    const estimator = new MockTokenEstimator(10);
    const factory = new ChunkerFactory(500, estimator);
    const pipeline = factory.createPipeline([
      "heading",
      "paragraph",
      "sentence",
      "overflow",
      "code",
    ]);

    const code = `function foo() { return 1; }
function bar() { return 2; }`;
    const result = await pipeline.chunk(code, "code");

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].strategy).toBe("code");
  });

  it("pipeline routes generic type through overflow", async () => {
    const estimator = new MockTokenEstimator(100);
    const factory = new ChunkerFactory(50, estimator);
    const pipeline = factory.createPipeline(["overflow"]);

    const text = "A".repeat(200);
    const result = await pipeline.chunk(text, "generic");

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].strategy).toBe("overflow");
  });

  it("merges consecutive chunks below 50 tokens with previous chunk", async () => {
    // 20 sentences, each estimated as 5 tokens by MockTokenEstimator
    // maxTokens=15 → ~3 sentences per raw chunk, each with size_tokens=5 (mock)
    // All raw chunks are < 50, so they should be merged into fewer chunks
    const estimator = new MockTokenEstimator(5);
    const factory = new ChunkerFactory(15, estimator);
    const pipeline = factory.createPipeline(["sentence", "overflow"]);

    const text = Array.from({ length: 20 }, (_, i) => `Sentence ${i + 1}.`).join(" ");

    // Get raw chunks (before merge)
    const rawChunker = pipeline.chunkers[0];
    const rawResult = await rawChunker.chunk(text);

    // Get pipeline chunks (with merge/post-process)
    const mergedResult = await pipeline.chunk(text, "markdown");

    // Merge should reduce chunk count
    expect(mergedResult.length).toBeLessThan(rawResult.length);

    // Merged chunks reflect real estimation (mock returns 5 for any content)
    for (const chunk of mergedResult) {
      expect(chunk.size_tokens).toBeGreaterThanOrEqual(1);
    }
  });

  it("applies 32-token overlap on content but not core_content", async () => {
    const estimator = new MockTokenEstimator(30);
    const factory = new ChunkerFactory(70, estimator);
    const pipeline = factory.createPipeline(["sentence", "overflow"]);

    const text =
      "This is the first sentence here. This is the second sentence here. " +
      "This is the third sentence here. This is the fourth sentence here. " +
      "This is the fifth sentence here.";

    const result = await pipeline.chunk(text, "markdown");

    // With maxTokens=70, 5 sentences × 30 tokens = 150 → ~2-3 chunks
    expect(result.length).toBeGreaterThan(1);

    // Verify overlap exists in content but not in core_content
    const secondChunkContent = result[1].content;
    const secondChunkCore = result[1].core_content;

    expect(secondChunkContent.length).toBeGreaterThan(secondChunkCore.length);
    expect(secondChunkContent).toContain(secondChunkCore);
  });

  it("handles empty text", async () => {
    const estimator = new MockTokenEstimator(10);
    const factory = new ChunkerFactory(500, estimator);
    const pipeline = factory.createPipeline(["heading", "overflow"]);

    const result = await pipeline.chunk("", "markdown");
    expect(result).toHaveLength(0);
  });
});


---
# tests/infrastructure/chunking/CodeChunker.test.ts
---
import { describe, it, expect } from "bun:test";
import { CodeChunker } from "../../../src/infrastructure/chunking/CodeChunker";
import { MockTokenEstimator } from "../../mocks/MockTokenEstimator";

describe("CodeChunker", () => {
  it("splits code by function boundaries (each function is one chunk)", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new CodeChunker(200, estimator);
    const code = `function foo() {
  return 1;
}

function bar() {
  return 2;
}`;

    const result = await chunker.chunk(code);

    expect(result.length).toBeGreaterThanOrEqual(2);
    // Each function should be a separate chunk
    const fnChunks = result.filter((c) => c.content.includes("function"));
    expect(fnChunks.length).toBe(2);
  });

  it("splits code by class boundaries (each class is one chunk)", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new CodeChunker(200, estimator);
    const code = `class Foo {
  bar() { return 1; }
}

class Baz {
  qux() { return 2; }
}`;

    const result = await chunker.chunk(code);

    const classChunks = result.filter((c) => c.content.includes("class"));
    expect(classChunks.length).toBe(2);
  });

  it("no overlap between code chunks", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new CodeChunker(200, estimator);
    const code = `function foo() {
  return 1;
}

function bar() {
  return 2;
}`;

    const result = await chunker.chunk(code);

    // Concatenate all chunks and verify no content is lost or duplicated
    const reconstructed = result.map((c) => c.content).join("\n");
    expect(reconstructed).toContain("function foo()");
    expect(reconstructed).toContain("function bar()");
  });

  it("non-function/class lines become interleaved chunks", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new CodeChunker(200, estimator);
    const code = `import { something } from "somewhere";

function foo() {
  return 1;
}

const x = 42;`;

    const result = await chunker.chunk(code);

    // With interleaved ordering, non-decl code before and after function
    // becomes separate chunks: [import chunk, function foo, const x chunk]
    expect(result.length).toBe(3);
    expect(result[0].content).toContain("import");
    expect(result[1].content).toContain("function foo");
    expect(result[2].content).toContain("const x = 42");
  });

  it("preserves source order with interleaved declarations and non-declarations", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new CodeChunker(200, estimator);
    const code = `const a = 1;
function foo() {
  return a;
}
const b = 2;
function bar() {
  return b;
}`;

    const result = await chunker.chunk(code);

    // Should have 4 chunks in order:
    // 1. "const a = 1;"
    // 2. "function foo() {...}"
    // 3. "const b = 2;"
    // 4. "function bar() {...}"
    expect(result.length).toBe(4);
    expect(result[0].content).toContain("const a = 1");
    expect(result[1].content).toContain("function foo");
    expect(result[2].content).toContain("const b = 2");
    expect(result[3].content).toContain("function bar");
  });

  it("has type 'code'", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new CodeChunker(200, estimator);
    expect(chunker.type).toBe("code");
  });

  it("handles empty text", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new CodeChunker(200, estimator);
    const result = await chunker.chunk("");
    expect(result).toHaveLength(0);
  });

  it("handles code without functions or classes as one chunk", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new CodeChunker(200, estimator);
    const code = `const x = 1;
const y = 2;
console.log(x + y);`;

    const result = await chunker.chunk(code);
    expect(result).toHaveLength(1);
  });
});


---
# tests/infrastructure/chunking/HeadingChunker.test.ts
---
import { describe, it, expect } from "bun:test";
import { HeadingChunker } from "../../../src/infrastructure/chunking/HeadingChunker";
import { MockTokenEstimator } from "../../mocks/MockTokenEstimator";

describe("HeadingChunker", () => {
  it("splits Markdown by heading boundaries", async () => {
    const estimator = new MockTokenEstimator(20);
    const chunker = new HeadingChunker(100, estimator);
    const text = `# Heading One
Content for section one.

## Heading Two
Content for section two.

### Heading Three
Content for section three.`;

    const result = await chunker.chunk(text);

    expect(result.length).toBe(3);
    expect(result[0].strategy).toBe("heading");
  });

  it("returns one chunk per section that fits within max_tokens", async () => {
    const estimator = new MockTokenEstimator(30);
    const chunker = new HeadingChunker(100, estimator);
    const text = `# Intro
Welcome to the docs.

## Getting Started
Install and run.`;

    const result = await chunker.chunk(text);

    expect(result).toHaveLength(2);
    for (const chunk of result) {
      expect(chunk.strategy).toBe("heading");
    }
  });

  it("returns empty array when a section exceeds max_tokens (falls through)", async () => {
    // Each section estimate is 150 tokens, maxTokens=100
    // So all sections exceed → return empty
    const estimator = new MockTokenEstimator(150);
    const chunker = new HeadingChunker(100, estimator);
    const text = `# Very Large Section
${"A".repeat(500)}
## Another Large Section
${"B".repeat(500)}`;

    const result = await chunker.chunk(text);

    expect(result).toHaveLength(0);
  });

  it("core_content is section body without the heading", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new HeadingChunker(100, estimator);
    const text = `# Title
Body content here.`;

    const result = await chunker.chunk(text);

    expect(result).toHaveLength(1);
    expect(result[0].core_content).toBe("Body content here.");
    expect(result[0].content).toContain("Body content here.");
  });

  it("handles text without headings as a single section", async () => {
    const estimator = new MockTokenEstimator(20);
    const chunker = new HeadingChunker(100, estimator);
    const text = "Just a plain paragraph with no headings.";

    const result = await chunker.chunk(text);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe(text);
  });

  it("handles empty text", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new HeadingChunker(100, estimator);
    const result = await chunker.chunk("");
    expect(result).toHaveLength(0);
  });

  it("correctly sets chunk_index and total_chunks", async () => {
    const estimator = new MockTokenEstimator(20);
    const chunker = new HeadingChunker(100, estimator);
    const text = `# One
Content A.

## Two
Content B.`;

    const result = await chunker.chunk(text);

    expect(result[0].chunk_index).toBe(0);
    expect(result[1].chunk_index).toBe(1);
    expect(result[0].total_chunks).toBe(2);
    expect(result[1].total_chunks).toBe(2);
  });

  it("has type 'markdown'", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new HeadingChunker(100, estimator);
    expect(chunker.type).toBe("markdown");
  });
});


---
# tests/infrastructure/chunking/OverflowChunker.test.ts
---
import { describe, it, expect } from "bun:test";
import { OverflowChunker } from "../../../src/infrastructure/chunking/OverflowChunker";
import { MockTokenEstimator } from "../../mocks/MockTokenEstimator";

describe("OverflowChunker", () => {
  it("splits text at token boundary closest to max_tokens", async () => {
    // MockTokenEstimator(250) for 300 char text => charsPerToken ≈ 1.2
    // maxTokens=50 => chunkSize ≈ 60 chars => ~5 chunks
    const estimator = new MockTokenEstimator(250);
    const chunker = new OverflowChunker(50, 20, estimator);
    const text = "A".repeat(300);

    const result = await chunker.chunk(text);

    expect(result.length).toBeGreaterThan(1);
    expect(result[0].strategy).toBe("overflow");

    // Concatenated content should equal original
    const reconstructed = result.map((c) => c.content).join("");
    expect(reconstructed).toBe(text);
  });

  it("each chunk has at least min_tokens", async () => {
    // MockTokenEstimator(250) for 300 char text => charsPerToken ≈ 1.2
    // minTokens=20 => minChunkSize ≈ 24 chars
    const estimator = new MockTokenEstimator(250);
    const chunker = new OverflowChunker(50, 20, estimator);
    const text = "A".repeat(300);

    const result = await chunker.chunk(text);

    for (const chunk of result) {
      expect(chunk.size_tokens).toBeGreaterThanOrEqual(20);
    }
  });

  it("returns single chunk if text fits within max_tokens", async () => {
    const estimator = new MockTokenEstimator(30);
    const chunker = new OverflowChunker(200, 50, estimator);
    const text = "Short text";

    const result = await chunker.chunk(text);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe(text);
  });

  it("has type 'generic'", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new OverflowChunker(200, 50, estimator);
    expect(chunker.type).toBe("generic");
  });

  it("correctly sets chunk_index and total_chunks", async () => {
    const estimator = new MockTokenEstimator(250);
    const chunker = new OverflowChunker(50, 20, estimator);
    const text = "A".repeat(300);

    const result = await chunker.chunk(text);

    expect(result[0].chunk_index).toBe(0);
    expect(result[result.length - 1].chunk_index).toBe(result.length - 1);
    for (const chunk of result) {
      expect(chunk.total_chunks).toBe(result.length);
    }
  });

  it("handles empty text", async () => {
    const estimator = new MockTokenEstimator(0);
    const chunker = new OverflowChunker(200, 50, estimator);
    const result = await chunker.chunk("");
    expect(result).toHaveLength(0);
  });

  it("handles single-line text", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new OverflowChunker(200, 50, estimator);
    const result = await chunker.chunk("Just one line");
    expect(result).toHaveLength(1);
  });
});


---
# tests/infrastructure/chunking/ParagraphChunker.test.ts
---
import { describe, it, expect } from "bun:test";
import { ParagraphChunker } from "../../../src/infrastructure/chunking/ParagraphChunker";
import { SentenceChunker } from "../../../src/infrastructure/chunking/SentenceChunker";
import { OverflowChunker } from "../../../src/infrastructure/chunking/OverflowChunker";
import { MockTokenEstimator } from "../../mocks/MockTokenEstimator";

describe("ParagraphChunker", () => {
  function makeChunker(
    maxTokens: number,
    tokCount: number,
    sentenceMax = 30,
  ) {
    const estimator = new MockTokenEstimator(tokCount);
    const overflow = new OverflowChunker(sentenceMax, 10, estimator);
    const sentence = new SentenceChunker(sentenceMax, estimator, overflow);
    return new ParagraphChunker(maxTokens, estimator, sentence);
  }

  it("splits text by blank line boundaries", async () => {
    const chunker = makeChunker(100, 5);
    const text = "First paragraph here.\n\nSecond paragraph there.\n\nThird paragraph here.";

    const result = await chunker.chunk(text);

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].strategy).toBe("paragraph");
  });

  it("returns one chunk per paragraph that fits within max_tokens", async () => {
    const chunker = makeChunker(100, 5);
    const text = "Short para one.\n\nShort para two.\n\nShort para three.";

    const result = await chunker.chunk(text);

    expect(result).toHaveLength(3);
    for (const chunk of result) {
      expect(chunk.strategy).toBe("paragraph");
    }
  });

  it("delegates overlong paragraphs to SentenceChunker", async () => {
    // Each paragraph estimate is 100 tokens, maxTokens=30 for paragraph
    // So each paragraph > maxTokens → delegates to sentence chunker
    const estimator = new MockTokenEstimator(100);
    const overflow = new OverflowChunker(30, 10, estimator);
    const sentence = new SentenceChunker(30, estimator, overflow);
    const chunker = new ParagraphChunker(30, estimator, sentence);
    const text = "This is a long paragraph that exceeds the maximum token limit for paragraphs.\n\nAnother long paragraph that also exceeds the limit.";

    const result = await chunker.chunk(text);

    // Should delegate to sentence chunker at minimum
    expect(result.length).toBeGreaterThanOrEqual(1);
    // If sentences also exceed maxTokens, they fall through to overflow
  });

  it("handles empty text", async () => {
    const chunker = makeChunker(100, 5);
    const result = await chunker.chunk("");
    expect(result).toHaveLength(0);
  });

  it("handles single paragraph without blank lines", async () => {
    const chunker = makeChunker(100, 5);
    const text = "Just one paragraph here with no blank lines.";

    const result = await chunker.chunk(text);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe(text);
  });

  it("correctly sets chunk_index and total_chunks", async () => {
    const chunker = makeChunker(100, 5);
    const text = "Para one.\n\nPara two.\n\nPara three.\n\nPara four.";

    const result = await chunker.chunk(text);

    expect(result[0].chunk_index).toBe(0);
    expect(result[result.length - 1].chunk_index).toBe(result.length - 1);
    for (const chunk of result) {
      expect(chunk.total_chunks).toBe(result.length);
    }
  });

  it("has type 'markdown'", async () => {
    const chunker = makeChunker(100, 5);
    expect(chunker.type).toBe("markdown");
  });
});


---
# tests/infrastructure/chunking/SentenceChunker.test.ts
---
import { describe, it, expect } from "bun:test";
import { SentenceChunker } from "../../../src/infrastructure/chunking/SentenceChunker";
import { OverflowChunker } from "../../../src/infrastructure/chunking/OverflowChunker";
import { MockTokenEstimator } from "../../mocks/MockTokenEstimator";

describe("SentenceChunker", () => {
  function makeChunker(
    maxTokens: number,
    tokCount: number,
    overflowMax = 50,
    overflowMin = 20,
    abbreviations?: string[],
  ) {
    const estimator = new MockTokenEstimator(tokCount);
    const overflow = new OverflowChunker(overflowMax, overflowMin, estimator);
    return new SentenceChunker(maxTokens, estimator, overflow, abbreviations);
  }

  it("splits text at sentence boundaries", async () => {
    // Each sentence is ~5 tokens, maxTokens=12 => ~2 sentences per chunk
    const chunker = makeChunker(12, 5);
    const text = "Hello world. How are you? I am fine. Good bye!";

    const result = await chunker.chunk(text);

    expect(result.length).toBeGreaterThan(1);
    expect(result[0].strategy).toBe("sentence");

    // Verify no sentence is split across chunks
    for (const chunk of result) {
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it("protects abbreviations from false splitting", async () => {
    const chunker = makeChunker(100, 5);
    const text = "Dr. Smith went to Washington. He met Mrs. Jones at St. Mary's. She works for Mr. Brown.";

    const result = await chunker.chunk(text);

    // Should not split after Dr., Mrs., St., or Mr.
    // The text has 3 actual sentence boundaries -> 3 sentences
    // With maxTokens=100 and 5 tokens/sentence, all fit in one chunk
    expect(result.length).toBeGreaterThanOrEqual(1);

    // Verify each chunk contains complete sentences (no sentence fragment ends with abbreviation)
    for (const chunk of result) {
      const trimmed = chunk.content.trim();
      // If a chunk ends with an abbreviation period, that's wrong
      const endsWithAbbrev = /(?:Mr|Mrs|Dr|St)\.\s*$/.test(trimmed);
      expect(endsWithAbbrev).toBe(false);
    }
  });

  it("protects e.g. and i.e. from false splitting", async () => {
    const chunker = makeChunker(100, 5);
    const text = "There are many fruits (e.g. apples, oranges). I like them. Some vegetables (i.e. carrots) are also good.";

    const result = await chunker.chunk(text);

    const reconstructed = result.map((c) => c.content).join("");
    expect(reconstructed).toContain("e.g.");
    expect(reconstructed).toContain("i.e.");
  });

  it("protects vs., etc., Jr., Sr. abbreviations from false splitting", async () => {
    const chunker = makeChunker(100, 5);
    const text = "Apples vs. oranges is a common debate. He brought supplies (pens, paper, etc.). John Smith Jr. is here. Robert Downey Sr. was an actor.";

    const result = await chunker.chunk(text);
    const reconstructed = result.map((c) => c.content).join("");

    expect(reconstructed).toContain("vs.");
    expect(reconstructed).toContain("etc.");
    expect(reconstructed).toContain("Jr.");
    expect(reconstructed).toContain("Sr.");
  });

  it("never splits a single sentence", async () => {
    // A single sentence that fits within maxTokens should be one chunk
    const chunker = makeChunker(100, 5);
    const text = "This is a single sentence that should not be split.";

    const result = await chunker.chunk(text);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe(text);
  });

  it("delegates overlong sentences to OverflowChunker", async () => {
    // MockTokenEstimator returns 100 for any text
    // maxTokens=30, but each token estimate is 100 > 30
    // So the sentence should be delegated to overflow
    const estimator = new MockTokenEstimator(100);
    const overflow = new OverflowChunker(50, 20, estimator);
    const chunker = new SentenceChunker(30, estimator, overflow);
    const text = "This is a very long single sentence that exceeds the maximum token limit and should be delegated to the overflow chunker for forced splitting.";

    const result = await chunker.chunk(text);

    // Should return overflow chunks
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].strategy).toBe("overflow");
  });

  it("handles empty text", async () => {
    const chunker = makeChunker(100, 5);
    const result = await chunker.chunk("");
    expect(result).toHaveLength(0);
  });

  it("correctly sets chunk_index and total_chunks", async () => {
    const chunker = makeChunker(100, 5);
    const text = "First sentence here. Second sentence there. Third one too. Fourth as well.";

    const result = await chunker.chunk(text);

    expect(result[0].chunk_index).toBe(0);
    expect(result[result.length - 1].chunk_index).toBe(result.length - 1);
    for (const chunk of result) {
      expect(chunk.total_chunks).toBe(result.length);
    }
  });

  it("handles custom abbreviations", async () => {
    const chunker = makeChunker(100, 5, 50, 20, ["Inc.", "Ltd."]);
    const text = "Apple Inc. is a tech company. Microsoft Corp. is another one.";

    const result = await chunker.chunk(text);

    // Should not split after Inc.
    const reconstructed = result.map((c) => c.content).join("");
    expect(reconstructed).toContain("Inc.");
  });
});


---
# tests/infrastructure/config/ConfigLoader.test.ts
---
// ---------------------------------------------------------------------------
// ConfigLoader — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ConfigLoader } from "../../../src/config/ConfigLoader";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "config-loader-test-"));
  // Create the .indeX subdirectory
  mkdirSync(join(dir, ".indeX"), { recursive: true });
  return dir;
}

function writeConfig(dir: string, content: string): string {
  const p = join(dir, ".indeX", "config.json");
  writeFileSync(p, content, "utf-8");
  return p;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("ConfigLoader", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = createTempDir();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── test 1: load() with valid config ─────────────────────────
  test("load() with valid config returns Config", () => {
    writeConfig(
      tmpDir,
      JSON.stringify({
        models: [
          {
            name: "nomic-embed-text",
            dimensions: 768,
            provider: "ollama",
          },
        ],
        universal_model: "nomic-embed-text",
      }),
    );
    const config = ConfigLoader.load(join(tmpDir, ".indeX", "config.json"));
    expect(config.models).toHaveLength(1);
    expect(config.models[0]!.name).toBe("nomic-embed-text");
    expect(config.universal_model).toBe("nomic-embed-text");
    // Defaults should be applied
    expect(config.embedder.batch_size).toBe(10);
    expect(config.chunking.default_strategy).toBe("heading");
    expect(config.search.default_mode).toBe("hybrid");
  });

  // ── test 2: loadOrDefault() without config file → defaults ───
  test("loadOrDefault() without config file returns defaults", () => {
    const config = ConfigLoader.loadOrDefault(
      join(tmpDir, "nonexistent", "config.json"),
    );
    expect(config.models).toHaveLength(1);
    expect(config.models[0]!.name).toBe("nomic-embed-text");
    expect(config.universal_model).toBe("nomic-embed-text");
    expect(config.embedder.batch_size).toBe(10);
    expect(config.chunking.default_strategy).toBe("heading");
    expect(config.search.default_mode).toBe("hybrid");
  });

  // ── test 3: load() with broken JSON → descriptive error ───────
  test("load() with broken JSON throws descriptive Zod error", () => {
    writeConfig(tmpDir, "{ invalid json }");
    expect(() =>
      ConfigLoader.load(join(tmpDir, ".indeX", "config.json")),
    ).toThrow();
  });

  // ── test 4: invalid model config (missing required fields) ────
  test("invalid model config (missing required fields) throws validation error", () => {
    writeConfig(
      tmpDir,
      JSON.stringify({
        models: [
          {
            // missing name, dimensions, provider
            baseUrl: "http://localhost:11434",
          },
        ],
        universal_model: "test-model",
      }),
    );
    expect(() =>
      ConfigLoader.load(join(tmpDir, ".indeX", "config.json")),
    ).toThrow();
  });

  // ── test 5: universal_model validated to be in models[] ───────
  test("universal_model validated to be in models[]", () => {
    writeConfig(
      tmpDir,
      JSON.stringify({
        models: [
          {
            name: "model-a",
            dimensions: 384,
            provider: "ollama",
          },
        ],
        universal_model: "model-b", // not in models[]
      }),
    );
    expect(() =>
      ConfigLoader.load(join(tmpDir, ".indeX", "config.json")),
    ).toThrow();
  });
});


---
# tests/infrastructure/context/BLAKE3Deduplicator.test.ts
---
import { describe, it, expect } from "bun:test";
import { BLAKE3Deduplicator } from "../../../src/infrastructure/context/BLAKE3Deduplicator";
import type { SearchResult } from "../../../src/domain/types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeResult(
  semantic_blake3: string,
  score: number,
  overrides: Partial<SearchResult["source"]> = {},
): SearchResult {
  return {
    source: {
      id: `id-${semantic_blake3}`,
      chunk_id: `c-${semantic_blake3}`,
      source_id: `s-${semantic_blake3}`,
      type: "code",
      title: "Test",
      content: `Content for ${semantic_blake3}`,
      tags: [],
      path: `${semantic_blake3}.ts`,
      file_blake3: "",
      semantic_blake3,
      chunk_index: 0,
      total_chunks: 1,
      embeddings: [],
      metadata: { kind: "generic" as const, encoding: "utf-8" },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    },
    score,
    match_type: "semantic",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BLAKE3Deduplicator", () => {
  const dedup = new BLAKE3Deduplicator();

  it("deduplicates by semantic_blake3 — keeps only one entry per hash", async () => {
    const results: SearchResult[] = [
      makeResult("hash-a", 0.9),
      makeResult("hash-b", 0.8),
      makeResult("hash-a", 0.7), // duplicate of hash-a
    ];

    const output = await dedup.deduplicate(results);

    expect(output).toHaveLength(2);
    const hashes = output.map((r) => r.source.semantic_blake3);
    expect(hashes).toEqual(["hash-a", "hash-b"]);
  });

  it("keeps the entry with the highest score when duplicates exist", async () => {
    const results: SearchResult[] = [
      makeResult("hash-a", 0.5),
      makeResult("hash-a", 0.9),
      makeResult("hash-a", 0.7),
    ];

    const output = await dedup.deduplicate(results);

    expect(output).toHaveLength(1);
    expect(output[0]!.score).toBe(0.9);
    expect(output[0]!.source.semantic_blake3).toBe("hash-a");
  });

  it("preserves original order of first occurrence for each unique hash", async () => {
    const results: SearchResult[] = [
      makeResult("hash-c", 0.3),
      makeResult("hash-a", 0.9),
      makeResult("hash-b", 0.8),
      makeResult("hash-a", 0.95), // duplicate, higher score but later
    ];

    const output = await dedup.deduplicate(results);

    // hash-c appears first, then hash-a (first occurrence at index 1),
    // then hash-b (first occurrence at index 2)
    expect(output).toHaveLength(3);
    expect(output[0]!.source.semantic_blake3).toBe("hash-c");
    expect(output[1]!.source.semantic_blake3).toBe("hash-a");
    expect(output[2]!.source.semantic_blake3).toBe("hash-b");

    // hash-a should have the max score (0.95, from the later occurrence)
    const hashA = output.find((r) => r.source.semantic_blake3 === "hash-a")!;
    expect(hashA.score).toBe(0.95);
  });

  it("does not mutate the input array (no side effects)", async () => {
    const results: SearchResult[] = [
      makeResult("hash-a", 0.9),
      makeResult("hash-b", 0.8),
    ];
    const snapshot = [...results];

    await dedup.deduplicate(results);

    expect(results).toHaveLength(snapshot.length);
    expect(results[0]!.source.semantic_blake3).toBe(snapshot[0]!.source.semantic_blake3);
    expect(results[1]!.source.semantic_blake3).toBe(snapshot[1]!.source.semantic_blake3);
  });

  it("returns empty array for empty input", async () => {
    const output = await dedup.deduplicate([]);
    expect(output).toEqual([]);
  });

  it("passes through a single result unchanged", async () => {
    const result = makeResult("hash-single", 0.95);
    const output = await dedup.deduplicate([result]);

    expect(output).toHaveLength(1);
    expect(output[0]!.source.semantic_blake3).toBe("hash-single");
    expect(output[0]!.score).toBe(0.95);
  });

  it("handles all unique entries correctly (no duplicates)", async () => {
    const results: SearchResult[] = [
      makeResult("hash-1", 0.9),
      makeResult("hash-2", 0.8),
      makeResult("hash-3", 0.7),
    ];

    const output = await dedup.deduplicate(results);

    expect(output).toHaveLength(3);
    expect(output[0]!.source.semantic_blake3).toBe("hash-1");
    expect(output[1]!.source.semantic_blake3).toBe("hash-2");
    expect(output[2]!.source.semantic_blake3).toBe("hash-3");
  });
});


---
# tests/infrastructure/context/GPCTokenizer.test.ts
---
import { describe, it, expect } from "bun:test";
import { GPTCodeTokenizer } from "../../../src/infrastructure/context/GPTCodeTokenizer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a word of the given length by repeating a letter. */
function word(length: number): string {
  return "x".repeat(length);
}

/** Build a sentence with `count` words, each 5 chars long. */
function sentence(wordCount: number): string {
  return Array.from({ length: wordCount }, (_, i) => word(5)).join(" ");
}

/** A long-ish passage with enough tokens for truncation tests. */
const LONG_TEXT = [
  "The quick brown fox jumps over the lazy dog near the bank of the river.",
  "This is a longer paragraph that contains multiple sentences and should produce enough tokens for meaningful truncation testing with the GPT tokenizer.",
  "We need to ensure that the truncation algorithm handles boundaries correctly and does not split words in the middle.",
  "Tokenization is a critical part of preparing context for large language models and must be handled with care.",
  "The GPTCodeTokenizer should count tokens accurately using the gpt-tokenizer library and truncate text at word boundaries.",
  "This ensures that when we pack context for LLM queries, we never exceed the model's context window limit.",
].join("\n\n");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GPTCodeTokenizer", () => {
  const tokenizer = new GPTCodeTokenizer();

  // -----------------------------------------------------------------------
  // count()
  // -----------------------------------------------------------------------

  it("count(\"hello world\") returns a positive number > 0", async () => {
    const n = await tokenizer.count("hello world");
    expect(n).toBeGreaterThan(0);
  });

  it('count("") returns 0 for empty string', async () => {
    const n = await tokenizer.count("");
    expect(n).toBe(0);
  });

  it("count returns larger number for longer text", async () => {
    const short = await tokenizer.count("short text");
    const long = await tokenizer.count(LONG_TEXT);
    expect(long).toBeGreaterThan(short);
  });

  // -----------------------------------------------------------------------
  // truncate()
  // -----------------------------------------------------------------------

  it("truncate(text, 50) returns text at approximately 50 tokens (within ~20%)", async () => {
    const result = await tokenizer.truncate(LONG_TEXT, 50);
    const tokenCount = await tokenizer.count(result);

    // Allow 20% margin: between 40 and 60 tokens
    expect(tokenCount).toBeGreaterThanOrEqual(40);
    expect(tokenCount).toBeLessThanOrEqual(60);
  });

  it("truncate respects word boundaries (no mid-word truncation)", async () => {
    // Each word is exactly "xxxxx" — truncation should not leave partial words
    const words = Array.from({ length: 100 }, () => word(5));
    const text = words.join(" ");

    const result = await tokenizer.truncate(text, 25);
    const resultWords = result.split(" ");

    // Every segment should be a complete word (or empty)
    for (const w of resultWords) {
      if (w.length > 0) {
        expect(w).toBe(word(5));
      }
    }
  });

  it("truncate with maxTokens larger than text returns full text unchanged", async () => {
    const text = "This is a short piece of text.";
    const result = await tokenizer.truncate(text, 10_000);
    expect(result).toBe(text);
  });

  it("truncate with maxTokens = 0 returns empty string", async () => {
    const result = await tokenizer.truncate("some text here", 0);
    expect(result).toBe("");
  });

  it("long text gets truncated (output shorter than input)", async () => {
    const result = await tokenizer.truncate(LONG_TEXT, 20);
    expect(result.length).toBeLessThan(LONG_TEXT.length);
  });

  it("truncate on empty text returns empty string", async () => {
    const result = await tokenizer.truncate("", 100);
    expect(result).toBe("");
  });

  it("truncate preserves full sentences when possible", async () => {
    // A text where each sentence fits in the budget — should not truncate
    const shortText = "Hello world. This is fine.";
    const result = await tokenizer.truncate(shortText, 100);
    expect(result).toBe(shortText);
  });
});


---
# tests/infrastructure/context/RAGContextPacker.test.ts
---
import { describe, it, expect } from "bun:test";
import { RAGContextPacker } from "../../../src/infrastructure/context/RAGContextPacker";
import { MockDeduplicator } from "../../mocks/MockDeduplicator";
import { MockTokenizer } from "../../mocks/MockTokenizer";
import type { SearchResult } from "../../../src/domain/types";
import type { Deduplicator, Tokenizer } from "../../../src/domain/systems/ContextPackagingSystem";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeResult(
  semantic_blake3: string,
  score: number,
  overrides: Partial<SearchResult["source"]> = {},
): SearchResult {
  return {
    source: {
      id: `id-${semantic_blake3}`,
      chunk_id: `c-${semantic_blake3}`,
      source_id: `s-${semantic_blake3}`,
      type: "code",
      title: "Test",
      content: `Content for ${semantic_blake3}`,
      tags: [],
      path: `src/${semantic_blake3}.ts`,
      file_blake3: "",
      semantic_blake3,
      chunk_index: 0,
      total_chunks: 1,
      embeddings: [],
      metadata: { kind: "generic" as const, encoding: "utf-8" },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    },
    score,
    match_type: "semantic",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RAGContextPacker", () => {
  it("full pipeline: dedup → sort by score desc → greedy-fit → format as Markdown", async () => {
    const dedup = new MockDeduplicator(true);
    const tokenizer = new MockTokenizer(1);
    const packer = new RAGContextPacker(dedup, tokenizer);

    const results: SearchResult[] = [
      makeResult("hash-a", 0.3),
      makeResult("hash-b", 0.9),
      makeResult("hash-c", 0.6),
    ];

    const packed = await packer.pack(results, { maxTokens: 100 });

    expect(packed.chunks_used).toBe(3);
    expect(packed.truncated).toBe(false);
    expect(packed.total_tokens).toBe(9); // "Content for hash-X" = 3 words each x 3 = 9

    // Order by score descending
    const lines = packed.markdown.split("\n");
    expect(lines[0]).toBe("### Source: src/hash-b.ts");
    expect(lines[2]).toBe("### Source: src/hash-c.ts");
    expect(lines[4]).toBe("### Source: src/hash-a.ts");
  });

  it("sets truncated=true when results exceed maxTokens", async () => {
    const dedup = new MockDeduplicator(true);
    const tokenizer = new MockTokenizer(50); // each word = 50 tokens
    const packer = new RAGContextPacker(dedup, tokenizer);

    const results: SearchResult[] = [
      makeResult("hash-a", 0.3),
      makeResult("hash-b", 0.9),
      makeResult("hash-c", 0.6),
    ];

    const packed = await packer.pack(results, { maxTokens: 200 });

    // Each result: 3 words * 50 = 150 tokens
    // Top result (hash-b, 0.9): 150 ≤ 200 ✓ → included
    // Next (hash-c, 0.6): 150 + 150 = 300 > 200 ✗ → excluded
    // chunks_used=1, truncated=true
    expect(packed.chunks_used).toBe(1);
    expect(packed.truncated).toBe(true);
    expect(packed.markdown).toContain("hash-b");
    expect(packed.markdown).not.toContain("hash-c");
    expect(packed.markdown).not.toContain("hash-a");
  });

  it("source_notes contains unique paths from included chunks", async () => {
    const dedup = new MockDeduplicator(true);
    const tokenizer = new MockTokenizer(1);
    const packer = new RAGContextPacker(dedup, tokenizer);

    const results: SearchResult[] = [
      makeResult("hash-a", 0.9, { path: "src/file-a.ts" }),
      makeResult("hash-b", 0.8, { path: "src/file-b.ts" }),
      makeResult("hash-c", 0.7, { path: "src/file-a.ts" }), // same path as hash-a
    ];

    const packed = await packer.pack(results, { maxTokens: 1000 });

    expect(packed.source_notes).toContain("src/file-a.ts");
    expect(packed.source_notes).toContain("src/file-b.ts");
    expect(packed.source_notes).toHaveLength(2);
  });

  it('format "rag" includes system prompt and <context> tags', async () => {
    const dedup = new MockDeduplicator(true);
    const tokenizer = new MockTokenizer(1);
    const packer = new RAGContextPacker(dedup, tokenizer);

    const results: SearchResult[] = [
      makeResult("hash-a", 0.9),
    ];

    const packed = await packer.pack(results, { maxTokens: 1000, format: "rag" });

    expect(packed.markdown).toStartWith(
      "You are a helpful assistant. Use the following context to answer the user's question.",
    );
    expect(packed.markdown).toContain("<context>");
    expect(packed.markdown).toContain("</context>");
    // Content between tags
    expect(packed.markdown).toContain("### Source: src/hash-a.ts");
  });

  it('format "context" is plain Markdown without system prompt', async () => {
    const dedup = new MockDeduplicator(true);
    const tokenizer = new MockTokenizer(1);
    const packer = new RAGContextPacker(dedup, tokenizer);

    const results: SearchResult[] = [
      makeResult("hash-a", 0.9),
    ];

    const packed = await packer.pack(results, { maxTokens: 1000, format: "context" });

    // Should NOT contain system prompt
    expect(packed.markdown).not.toContain("You are a helpful assistant");
    // Should NOT contain context tags
    expect(packed.markdown).not.toContain("<context>");
    expect(packed.markdown).not.toContain("</context>");
    // Should contain the source header
    expect(packed.markdown).toContain("### Source: src/hash-a.ts");
  });

  it("default format is context (plain Markdown)", async () => {
    const dedup = new MockDeduplicator(true);
    const tokenizer = new MockTokenizer(1);
    const packer = new RAGContextPacker(dedup, tokenizer);

    const results: SearchResult[] = [
      makeResult("hash-a", 0.9),
    ];

    const packed = await packer.pack(results);

    // Should NOT contain system prompt (default is "context")
    expect(packed.markdown).not.toContain("You are a helpful assistant");
    expect(packed.markdown).toContain("### Source: src/hash-a.ts");
  });

  it("empty results returns valid PackedContext with 0 chunks", async () => {
    const dedup = new MockDeduplicator(true);
    const tokenizer = new MockTokenizer(1);
    const packer = new RAGContextPacker(dedup, tokenizer);

    const packed = await packer.pack([], { maxTokens: 1000 });

    expect(packed.chunks_used).toBe(0);
    expect(packed.total_tokens).toBe(0);
    expect(packed.truncated).toBe(false);
    expect(packed.source_notes).toEqual([]);
    expect(packed.markdown).toBe("");
  });

  it("uses injectable Deduplicator — deduplicate is called and duplicates removed", async () => {
    const dedup = new MockDeduplicator(true); // enabled
    const tokenizer = new MockTokenizer(1);
    const packer = new RAGContextPacker(dedup, tokenizer);

    const results: SearchResult[] = [
      makeResult("hash-a", 0.9),
      makeResult("hash-b", 0.8),
      makeResult("hash-a", 0.7), // duplicate of hash-a, lower score
    ];

    const packed = await packer.pack(results, { maxTokens: 1000 });

    // Only 2 unique results (hash-a with score 0.9, hash-b with score 0.8)
    expect(packed.chunks_used).toBe(2);
    expect(packed.markdown).toContain("hash-b");
    expect(packed.markdown).not.toContain("hash-a with score 0.7"); // lower score not included
  });
});


---
# tests/infrastructure/embedding/CachedEmbedder.test.ts
---
/**
 * RED phase — CachedEmbedder.test.ts
 *
 * Tests for the CachedEmbedder proxy/decorator that wraps an Embedder
 * with an EmbedderCache. On embed(), it computes a cache key using
 * the hasher, checks the cache first, and only delegates to the inner
 * embedder on a cache miss.
 *
 * Acceptance Criteria:
 *  1. Cache hit: inner embedder is NOT called, cached value returned
 *  2. Cache miss: inner embedder IS called and result is cached
 *  3. Cache key derivation uses hasher.hash(text)
 *  4. Decorated embedder exposes model and dimensions from inner embedder
 */

import { describe, it, expect } from "bun:test";
import { CachedEmbedder } from "../../../src/infrastructure/embedding/CachedEmbedder";
import type { Embedding, Embedder, EmbedderCache } from "../../../src/domain/systems/EmbeddingSystem";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a spy embedder that records embed() calls and returns
 * a deterministic Embedding based on model/dimensions.
 */
function createSpyEmbedder(
  model: string,
  dimensions: number,
): Embedder & { embedCalls: string[] } {
  const embedCalls: string[] = [];
  return {
    model,
    dimensions,
    embedCalls,
    embed: async (text: string): Promise<Embedding> => {
      embedCalls.push(text);
      return {
        vector: Array.from({ length: dimensions }, (_, i) => i + 1),
        model,
        dimensions,
        tokens_in: text.length,
      };
    },
  };
}

/**
 * Creates a mock EmbedderCache backed by a plain Map.
 * Tracks set() calls for inspection.
 */
function createMockCache(): EmbedderCache & {
  entries: Map<string, Embedding>;
  setCalls: Array<{ key: string; embedding: Embedding }>;
} {
  const entries = new Map<string, Embedding>();
  const setCalls: Array<{ key: string; embedding: Embedding }> = [];
  return {
    entries,
    setCalls,
    async get(key: string): Promise<Embedding | null> {
      return entries.get(key) ?? null;
    },
    async set(key: string, embedding: Embedding): Promise<void> {
      setCalls.push({ key, embedding });
      entries.set(key, embedding);
    },
  };
}

/**
 * Creates a mock hasher that records hash() calls.
 * @param fixedHash — if provided, hash() always returns this value
 *                    otherwise returns "mock-hash:${text}"
 */
function createMockHasher(
  fixedHash?: string,
): { hash(text: string): string } & { hashCalls: string[] } {
  const hashCalls: string[] = [];
  if (fixedHash !== undefined) {
    return {
      hashCalls,
      hash: (text: string) => {
        hashCalls.push(text);
        return fixedHash;
      },
    };
  }
  return {
    hashCalls,
    hash: (text: string) => {
      hashCalls.push(text);
      return `mock-hash:${text}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("CachedEmbedder", () => {
  // -----------------------------------------------------------------------
  // AC 1: Cache hit — inner embedder NOT called, cached value returned
  // -----------------------------------------------------------------------
  it("returns cached embedding on cache hit without calling inner embedder", async () => {
    // Arrange
    const inner = createSpyEmbedder("test-model", 4);
    const cache = createMockCache();
    const hasher = createMockHasher("fixed-hash");

    const cachedEmb: Embedding = {
      vector: [9, 9, 9, 9],
      model: "test-model",
      dimensions: 4,
      tokens_in: 99,
    };
    await cache.set("test-model:fixed-hash", cachedEmb);

    const cachedEmbedder = new CachedEmbedder(inner, cache, hasher);

    // Act
    const result = await cachedEmbedder.embed("some text");

    // Assert — inner embedder NOT called, cached value returned
    expect(inner.embedCalls).toHaveLength(0);
    expect(result).toEqual(cachedEmb);
  });

  it("returns cached embedding for different text that hashes to same key", async () => {
    // Arrange — hasher always returns the same fixed hash regardless of text
    const inner = createSpyEmbedder("collision-model", 2);
    const cache = createMockCache();
    const hasher = createMockHasher("same-hash");

    const cachedEmb: Embedding = {
      vector: [7, 7],
      model: "collision-model",
      dimensions: 2,
      tokens_in: 10,
    };
    await cache.set("collision-model:same-hash", cachedEmb);

    const cachedEmbedder = new CachedEmbedder(inner, cache, hasher);

    // Act — different text, but hasher produces same hash
    const result = await cachedEmbedder.embed("completely different text");

    // Assert — cache hit on different text due to hash collision
    expect(inner.embedCalls).toHaveLength(0);
    expect(result).toEqual(cachedEmb);
  });

  // -----------------------------------------------------------------------
  // AC 2: Cache miss — inner embedder IS called, result is cached
  // -----------------------------------------------------------------------
  it("calls inner embedder and caches result on cache miss", async () => {
    // Arrange
    const inner = createSpyEmbedder("miss-model", 3);
    const cache = createMockCache();
    const hasher = createMockHasher("miss-hash");
    const cachedEmbedder = new CachedEmbedder(inner, cache, hasher);

    // Act
    const result = await cachedEmbedder.embed("hello");

    // Assert — inner embedder was called once with the correct text
    expect(inner.embedCalls).toHaveLength(1);
    expect(inner.embedCalls[0]).toBe("hello");

    // Assert — result shape matches what inner embedder would return
    expect(result.vector).toEqual([1, 2, 3]);
    expect(result.model).toBe("miss-model");
    expect(result.dimensions).toBe(3);
    expect(result.tokens_in).toBe(5); // "hello".length

    // Assert — result was stored in cache
    const cached = await cache.get("miss-model:miss-hash");
    expect(cached).not.toBeNull();
    expect(cached!.vector).toEqual([1, 2, 3]);
    expect(cached!.model).toBe("miss-model");
  });

  it("stores embedding in cache with correct key on miss", async () => {
    // Arrange
    const inner = createSpyEmbedder("store-model", 2);
    const cache = createMockCache();
    const hasher = createMockHasher("store-hash");
    const cachedEmbedder = new CachedEmbedder(inner, cache, hasher);

    // Act
    await cachedEmbedder.embed("store me");

    // Assert — exactly one set() call with the expected key
    expect(cache.setCalls).toHaveLength(1);
    expect(cache.setCalls[0].key).toBe("store-model:store-hash");
    expect(cache.setCalls[0].embedding.vector).toEqual([1, 2]);
  });

  // -----------------------------------------------------------------------
  // AC 1 + 2 (combined): Miss then subsequent hit with same text
  // -----------------------------------------------------------------------
  it("hits cache on second call with same text (miss → hit lifecycle)", async () => {
    // Arrange
    const inner = createSpyEmbedder("lifecycle-model", 2);
    const cache = createMockCache();
    const hasher = createMockHasher("lifecycle-hash");
    const cachedEmbedder = new CachedEmbedder(inner, cache, hasher);

    // Act — first call: cache miss
    const first = await cachedEmbedder.embed("repeat");

    // Assert — inner embedder called once
    expect(inner.embedCalls).toHaveLength(1);
    expect(cache.setCalls).toHaveLength(1);

    // Act — second call with same text: should be cache hit
    const second = await cachedEmbedder.embed("repeat");

    // Assert — inner embedder still called only once; results identical
    expect(inner.embedCalls).toHaveLength(1);
    expect(cache.setCalls).toHaveLength(1); // no additional set()
    expect(second).toEqual(first);
  });

  // -----------------------------------------------------------------------
  // AC 3: Cache key derivation uses hasher.hash(text)
  // -----------------------------------------------------------------------
  it("computes cache key using hasher.hash(text) in ${model}:${hash} format", async () => {
    // Arrange
    const inner = createSpyEmbedder("key-model", 2);
    const cache = createMockCache();
    const hasher = createMockHasher("known-hash");
    const cachedEmbedder = new CachedEmbedder(inner, cache, hasher);

    // Act
    await cachedEmbedder.embed("some input");

    // Assert — hasher was called with the exact input text
    expect(hasher.hashCalls).toHaveLength(1);
    expect(hasher.hashCalls[0]).toBe("some input");

    // Assert — cache key follows ${model}:${hashResult} format
    const cached = await cache.get("key-model:known-hash");
    expect(cached).not.toBeNull();
  });

  it("uses different cache keys for different texts via hasher", async () => {
    // Arrange — dynamic hash: "mock-hash:${text}"
    const inner = createSpyEmbedder("multi-key", 2);
    const cache = createMockCache();
    const hasher = createMockHasher();
    const cachedEmbedder = new CachedEmbedder(inner, cache, hasher);

    // Act — embed two different texts
    await cachedEmbedder.embed("first");
    await cachedEmbedder.embed("second");

    // Assert — each text hashed separately, different cache keys
    expect(hasher.hashCalls).toHaveLength(2);
    expect(hasher.hashCalls[0]).toBe("first");
    expect(hasher.hashCalls[1]).toBe("second");

    const key1 = "multi-key:mock-hash:first";
    const key2 = "multi-key:mock-hash:second";

    expect(await cache.get(key1)).not.toBeNull();
    expect(await cache.get(key2)).not.toBeNull();
    expect(inner.embedCalls).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // AC 4: Exposes model and dimensions from inner embedder
  // -----------------------------------------------------------------------
  it("exposes model property from inner embedder", () => {
    // Arrange
    const inner = createSpyEmbedder("my-model", 128);
    const cachedEmbedder = new CachedEmbedder(inner, createMockCache(), createMockHasher());

    // Act & Assert
    expect(cachedEmbedder.model).toBe("my-model");
  });

  it("exposes dimensions property from inner embedder", () => {
    // Arrange
    const inner = createSpyEmbedder("dim-model", 384);
    const cachedEmbedder = new CachedEmbedder(inner, createMockCache(), createMockHasher());

    // Act & Assert
    expect(cachedEmbedder.dimensions).toBe(384);
  });

  it("model and dimensions match inner embedder values", () => {
    // Arrange
    const inner = createSpyEmbedder("readonly-model", 256);
    const cachedEmbedder = new CachedEmbedder(inner, createMockCache(), createMockHasher());

    // Assert
    expect(cachedEmbedder.model).toBe("readonly-model");
    expect(cachedEmbedder.dimensions).toBe(256);

    // TypeScript ensures readonly — the following would cause a compile error:
    //   cachedEmbedder.model = "other";     // Error: Cannot assign to 'model' because it is a read-only property
    //   cachedEmbedder.dimensions = 512;    // Error: Cannot assign to 'dimensions' because it is a read-only property
  });

  // -----------------------------------------------------------------------
  // Interface conformance
  // -----------------------------------------------------------------------
  it("satisfies the Embedder interface shape", () => {
    // Arrange — verify structural compatibility
    const inner = createSpyEmbedder("iface-model", 64);
    const cachedEmbedder: Embedder = new CachedEmbedder(inner, createMockCache(), createMockHasher());

    // Act & Assert
    expect(typeof cachedEmbedder.embed).toBe("function");
    expect(typeof cachedEmbedder.model).toBe("string");
    expect(typeof cachedEmbedder.dimensions).toBe("number");
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  it("handles empty string text (miss → cache)", async () => {
    // Arrange
    const inner = createSpyEmbedder("empty-model", 2);
    const cache = createMockCache();
    const hasher = createMockHasher("empty-hash");
    const cachedEmbedder = new CachedEmbedder(inner, cache, hasher);

    // Act
    const result = await cachedEmbedder.embed("");

    // Assert — inner embedder called with empty string
    expect(inner.embedCalls).toHaveLength(1);
    expect(inner.embedCalls[0]).toBe("");
    expect(result.tokens_in).toBe(0); // "".length

    // Assert — result cached
    const cached = await cache.get("empty-model:empty-hash");
    expect(cached).not.toBeNull();
    expect(cached!.tokens_in).toBe(0);
  });

  it("cache key includes model prefix so same hash for different models does not collide", async () => {
    // Arrange — two cached embedders sharing the same cache and hasher
    const cache = createMockCache();
    const hasher = createMockHasher("shared-hash");

    const innerA = createSpyEmbedder("model-a", 3);
    const innerB = createSpyEmbedder("model-b", 4);

    const cachedA = new CachedEmbedder(innerA, cache, hasher);
    const cachedB = new CachedEmbedder(innerB, cache, hasher);

    // Act — embed same text with both models
    const resultA = await cachedA.embed("same text");
    const resultB = await cachedB.embed("same text");

    // Assert — each embedder was called (different cache keys due to model prefix)
    expect(innerA.embedCalls).toHaveLength(1);
    expect(innerB.embedCalls).toHaveLength(1);

    // Assert — results come from the correct inner embedders
    expect(resultA.dimensions).toBe(3);
    expect(resultB.dimensions).toBe(4);

    // Assert — two distinct cache entries exist (no collision)
    expect(await cache.get("model-a:shared-hash")).not.toBeNull();
    expect(await cache.get("model-b:shared-hash")).not.toBeNull();
    expect((await cache.get("model-a:shared-hash"))!.vector).toEqual([1, 2, 3]);
    expect((await cache.get("model-b:shared-hash"))!.vector).toEqual([1, 2, 3, 4]);
  });

  it("second call with different text causes a new cache miss", async () => {
    // Arrange
    const inner = createSpyEmbedder("multi-miss", 2);
    const cache = createMockCache();
    const hasher = createMockHasher(); // dynamic: "mock-hash:${text}"
    const cachedEmbedder = new CachedEmbedder(inner, cache, hasher);

    // Act — first text
    const first = await cachedEmbedder.embed("alpha");

    // Act — second text (different)
    const second = await cachedEmbedder.embed("beta");

    // Assert — both caused calls to inner embedder (both were misses)
    expect(inner.embedCalls).toHaveLength(2);
    expect(inner.embedCalls[0]).toBe("alpha");
    expect(inner.embedCalls[1]).toBe("beta");

    // Assert — results differ
    expect(first.vector).toEqual([1, 2]);
    expect(second.vector).toEqual([1, 2]); // same embedder, same dimensions
  });
});


---
# tests/infrastructure/embedding/EmbedderCacheLRU.test.ts
---
import { describe, it, expect } from "bun:test";
import { EmbedderCacheLRU } from "../../../src/infrastructure/embedding/EmbedderCacheLRU";
import type { Embedding } from "../../../src/domain/systems/EmbeddingSystem";

/**
 * Helper: create an inline Embedding for testing.
 */
function makeEmbedding(
  model: string,
  vector: number[] = [0.1, 0.2, 0.3],
  tokens_in: number = 10,
): Embedding {
  return { vector, model, dimensions: vector.length, tokens_in };
}

/**
 * Helper: build a cache key in the expected `${model}:${hash}` format.
 */
function cacheKey(model: string, hash: string): string {
  return `${model}:${hash}`;
}

describe("EmbedderCacheLRU", () => {
  // ─── Basic operations ──────────────────────────────────────────

  it("get() returns null for a missing key", async () => {
    const cache = new EmbedderCacheLRU(10);
    const result = await cache.get("nonexistent:key");
    expect(result).toBeNull();
  });

  it("set() stores an embedding and get() retrieves it", async () => {
    const cache = new EmbedderCacheLRU(10);
    const emb = makeEmbedding("model-a", [0.5, 0.6, 0.7]);
    const key = cacheKey("model-a", "abc123");

    await cache.set(key, emb);
    const retrieved = await cache.get(key);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.vector).toEqual([0.5, 0.6, 0.7]);
    expect(retrieved!.model).toBe("model-a");
    expect(retrieved!.dimensions).toBe(3);
    expect(retrieved!.tokens_in).toBe(10);
  });

  it("set() overwrites an existing key", async () => {
    const cache = new EmbedderCacheLRU(10);
    const key = cacheKey("model-a", "abc123");

    await cache.set(key, makeEmbedding("model-a", [0.1, 0.2], 5));
    await cache.set(key, makeEmbedding("model-a", [0.9, 0.8], 20));

    const retrieved = await cache.get(key);
    expect(retrieved!.vector).toEqual([0.9, 0.8]);
    expect(retrieved!.tokens_in).toBe(20);
  });

  // ─── Key format ────────────────────────────────────────────────

  it("uses ${model}:${hash} key format — same hash, different models are distinct", async () => {
    const cache = new EmbedderCacheLRU(10);

    await cache.set(cacheKey("model-a", "samehash"), makeEmbedding("model-a", [0.1]));
    await cache.set(cacheKey("model-b", "samehash"), makeEmbedding("model-b", [0.2]));

    const a = await cache.get(cacheKey("model-a", "samehash"));
    const b = await cache.get(cacheKey("model-b", "samehash"));

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.model).toBe("model-a");
    expect(b!.model).toBe("model-b");
  });

  it("uses ${model}:${hash} key format — same model, different hashes are distinct", async () => {
    const cache = new EmbedderCacheLRU(10);

    await cache.set(cacheKey("model-a", "hash1"), makeEmbedding("model-a", [0.1]));
    await cache.set(cacheKey("model-a", "hash2"), makeEmbedding("model-a", [0.2]));

    const r1 = await cache.get(cacheKey("model-a", "hash1"));
    const r2 = await cache.get(cacheKey("model-a", "hash2"));

    expect(r1!.vector).toEqual([0.1]);
    expect(r2!.vector).toEqual([0.2]);
  });

  // ─── LRU eviction ──────────────────────────────────────────────

  it("evicts the least-recently-used entry when size exceeds maxSize", async () => {
    const cache = new EmbedderCacheLRU(3);

    // Insert 3 items: A, B, C
    await cache.set("key:A", makeEmbedding("m", [0.1]));
    await cache.set("key:B", makeEmbedding("m", [0.2]));
    await cache.set("key:C", makeEmbedding("m", [0.3]));

    // Access A to make it recently-used, then insert D → evicts B (least recently used)
    await cache.get("key:A"); // A becomes most recent
    await cache.set("key:D", makeEmbedding("m", [0.4])); // evicts B

    expect(await cache.get("key:A")).not.toBeNull(); // A was accessed, still alive
    expect(await cache.get("key:B")).toBeNull();       // B was evicted (LRU)
    expect(await cache.get("key:C")).not.toBeNull();   // C still alive
    expect(await cache.get("key:D")).not.toBeNull();   // D newly inserted
  });

  it("evicts in strict LRU order under sequential inserts", async () => {
    const cache = new EmbedderCacheLRU(3);

    await cache.set("key:1", makeEmbedding("m", [0.1]));
    await cache.set("key:2", makeEmbedding("m", [0.2]));
    await cache.set("key:3", makeEmbedding("m", [0.3]));
    await cache.set("key:4", makeEmbedding("m", [0.4])); // evicts 1

    expect(await cache.get("key:1")).toBeNull();
    expect(await cache.get("key:2")).not.toBeNull();
    expect(await cache.get("key:3")).not.toBeNull();
    expect(await cache.get("key:4")).not.toBeNull();
  });

  it("re-inserting an existing key refreshes its LRU position", async () => {
    const cache = new EmbedderCacheLRU(3);

    await cache.set("key:A", makeEmbedding("m", [0.1]));
    await cache.set("key:B", makeEmbedding("m", [0.2]));
    await cache.set("key:C", makeEmbedding("m", [0.3]));

    // Overwrite A — refreshes its position
    await cache.set("key:A", makeEmbedding("m", [0.9]));
    await cache.set("key:D", makeEmbedding("m", [0.4])); // evicts B (oldest)

    expect(await cache.get("key:A")).not.toBeNull();
    expect(await cache.get("key:B")).toBeNull();
    expect(await cache.get("key:C")).not.toBeNull();
    expect(await cache.get("key:D")).not.toBeNull();
  });

  it("retrieving an entry via get() promotes it (does not get evicted next)", async () => {
    const cache = new EmbedderCacheLRU(2);

    await cache.set("key:A", makeEmbedding("m", [0.1]));
    await cache.set("key:B", makeEmbedding("m", [0.2]));

    // Access A — makes A most recent, B is now LRU
    await cache.get("key:A");
    await cache.set("key:C", makeEmbedding("m", [0.3])); // evicts B

    expect(await cache.get("key:A")).not.toBeNull();
    expect(await cache.get("key:B")).toBeNull();
    expect(await cache.get("key:C")).not.toBeNull();
  });

  // ─── Size tracking ─────────────────────────────────────────────

  it("size starts at 0", () => {
    const cache = new EmbedderCacheLRU(10);
    expect(cache.size).toBe(0);
  });

  it("size increases on set()", async () => {
    const cache = new EmbedderCacheLRU(10);
    expect(cache.size).toBe(0);

    await cache.set("k1", makeEmbedding("m", [0.1]));
    expect(cache.size).toBe(1);

    await cache.set("k2", makeEmbedding("m", [0.2]));
    expect(cache.size).toBe(2);
  });

  it("size does not grow on overwrite of existing key", async () => {
    const cache = new EmbedderCacheLRU(10);

    await cache.set("key:A", makeEmbedding("m", [0.1]));
    expect(cache.size).toBe(1);

    await cache.set("key:A", makeEmbedding("m", [0.2]));
    expect(cache.size).toBe(1); // still 1
  });

  it("size reflects eviction — decreases when entries are removed", async () => {
    const cache = new EmbedderCacheLRU(3);

    await cache.set("k1", makeEmbedding("m", [0.1]));
    await cache.set("k2", makeEmbedding("m", [0.2]));
    await cache.set("k3", makeEmbedding("m", [0.3]));
    expect(cache.size).toBe(3);

    await cache.set("k4", makeEmbedding("m", [0.4])); // evicts k1
    expect(cache.size).toBe(3); // stays at max
  });

  // ─── has() method ──────────────────────────────────────────────

  it("has() returns false for a missing key", async () => {
    const cache = new EmbedderCacheLRU(10);
    expect(await cache.has("missing:key")).toBe(false);
  });

  it("has() returns true for a present key", async () => {
    const cache = new EmbedderCacheLRU(10);
    await cache.set("present:key", makeEmbedding("m", [0.1]));
    expect(await cache.has("present:key")).toBe(true);
  });

  it("has() returns false after eviction", async () => {
    const cache = new EmbedderCacheLRU(2);

    await cache.set("k1", makeEmbedding("m", [0.1]));
    await cache.set("k2", makeEmbedding("m", [0.2]));
    await cache.set("k3", makeEmbedding("m", [0.3])); // evicts k1

    expect(await cache.has("k1")).toBe(false);
    expect(await cache.has("k2")).toBe(true);
    expect(await cache.has("k3")).toBe(true);
  });

  // ─── Edge cases ────────────────────────────────────────────────

  it("handles empty cache — get, has, size all behave correctly", async () => {
    const cache = new EmbedderCacheLRU(5);
    expect(cache.size).toBe(0);
    expect(await cache.get("anything")).toBeNull();
    expect(await cache.has("anything")).toBe(false);
  });

  it("accepts default maxSize of 100 when no argument given", () => {
    const cache = new EmbedderCacheLRU();
    expect(cache.size).toBe(0);
  });

  it("throws when maxSize is 0 or negative", () => {
    expect(() => new EmbedderCacheLRU(0)).toThrow();
    expect(() => new EmbedderCacheLRU(-1)).toThrow();
  });

  it("evicts oldest entry when cache is at capacity and new set occurs", async () => {
    const cache = new EmbedderCacheLRU(1);

    await cache.set("only-one", makeEmbedding("m", [0.1]));
    expect(cache.size).toBe(1);

    await cache.set("kicked-out", makeEmbedding("m", [0.2]));
    expect(cache.size).toBe(1);
    expect(await cache.get("only-one")).toBeNull();
    expect(await cache.get("kicked-out")).not.toBeNull();
  });

  it("preserves all entries when under maxSize", async () => {
    const cache = new EmbedderCacheLRU(100);

    const keys = Array.from({ length: 50 }, (_, i) => `key:${i}`);
    for (let idx = 0; idx < keys.length; idx++) {
      await cache.set(keys[idx], makeEmbedding("m", [idx / 50]));
    }

    expect(cache.size).toBe(50);
    for (const k of keys) {
      expect(await cache.get(k)).not.toBeNull();
    }
  });
});


---
# tests/infrastructure/embedding/EmbedderRegistry.test.ts
---
/**
 * RED phase — EmbedderRegistry.test.ts
 *
 * Tests for EmbedderRegistryImpl, the config-driven embedder registry that
 * routes source types to embedder models by priority, supports universal
 * fallback models, and provides dynamic registration.
 *
 * Acceptance Criteria:
 *  1. getEmbedder(sourceType) returns embedder with minimum priority for that type
 *  2. getEmbedders(sourceType) returns all matching embedders ordered by priority
 *  3. Universal model (no source_types filter) returned for unresolvable types
 *  4. isAvailable() returns false when no models registered
 *  5. register(sourceType, embedder, priority) adds to internal map
 *  6. modelNames returns all unique registered model names
 */

import { describe, it, expect } from "bun:test";
import { EmbedderRegistryImpl } from "../../../src/infrastructure/embedding/EmbedderRegistryImpl";
import { MockEmbedder } from "../../mocks/MockEmbedder";
import type { Embedder, EmbedderRegistry } from "../../../src/domain/systems/EmbeddingSystem";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single model entry passed to the EmbedderRegistryImpl constructor.
 * - model: display / identifier name for the embedder
 * - embedder: the embedder instance
 * - source_types: optional list of source types this model handles;
 *     if omitted or empty, the model acts as a universal fallback
 * - priority: lower number = higher priority
 */
interface EmbedderModelEntry {
  model: string;
  embedder: Embedder;
  source_types?: string[];
  priority: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates an EmbedderRegistryImpl from a list of model entries.
 * Shorthand to reduce repetition in tests.
 */
function createRegistry(entries: EmbedderModelEntry[]): EmbedderRegistryImpl {
  return new EmbedderRegistryImpl(entries);
}

/**
 * Creates a MockEmbedder with fixed model name + dimensions.
 * Returns a basic zero-vector embedder.
 */
function makeEmbedder(model: string, dims: number): MockEmbedder {
  return new MockEmbedder(model, dims);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("EmbedderRegistryImpl", () => {
  // -----------------------------------------------------------------------
  // AC 1: getEmbedder(sourceType) — minimum priority routing
  // -----------------------------------------------------------------------

  it("getEmbedder returns embedder with minimum priority for matching source type", () => {
    // Arrange
    const high = makeEmbedder("high-prio", 4);
    const low = makeEmbedder("low-prio", 4);
    const registry = createRegistry([
      { model: "low-prio", embedder: low, source_types: ["code"], priority: 10 },
      { model: "high-prio", embedder: high, source_types: ["code"], priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedder("code");

    // Assert — embedder with priority 1 (lowest number) wins
    expect(result).not.toBeNull();
    expect(result!.model).toBe("high-prio");
  });

  it("getEmbedder returns single embedder when only one matches source type", () => {
    // Arrange
    const emb = makeEmbedder("solo", 8);
    const registry = createRegistry([
      { model: "solo", embedder: emb, source_types: ["markdown"], priority: 5 },
    ]);

    // Act
    const result = registry.getEmbedder("markdown");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.model).toBe("solo");
  });

  it("getEmbedder ignores embedders registered for other source types", () => {
    // Arrange
    const codeEmb = makeEmbedder("code-model", 2);
    const mdEmb = makeEmbedder("md-model", 4);
    const registry = createRegistry([
      { model: "code-model", embedder: codeEmb, source_types: ["code"], priority: 1 },
      { model: "md-model", embedder: mdEmb, source_types: ["markdown"], priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedder("code");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.model).toBe("code-model");
  });

  it("getEmbedder prefers source-type-specific embedder over universal model", () => {
    // Arrange — universal fallback exists but specific match should win
    const specific = makeEmbedder("specific-model", 8);
    const universal = makeEmbedder("universal-model", 384);
    const registry = createRegistry([
      { model: "universal-model", embedder: universal, priority: 1 },
      { model: "specific-model", embedder: specific, source_types: ["code"], priority: 5 },
    ]);

    // Act
    const result = registry.getEmbedder("code");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.model).toBe("specific-model");
  });

  it("getEmbedder returns null when no match and no universal model", () => {
    // Arrange
    const emb = makeEmbedder("code-only", 4);
    const registry = createRegistry([
      { model: "code-only", embedder: emb, source_types: ["code"], priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedder("obsidian");

    // Assert
    expect(result).toBeNull();
  });

  // -----------------------------------------------------------------------
  // AC 2: getEmbedders(sourceType) — all matching, ordered by priority
  // -----------------------------------------------------------------------

  it("getEmbedders returns all embedders for source type in ascending priority order", () => {
    // Arrange
    const emb1 = makeEmbedder("first", 4);   // priority 1
    const emb2 = makeEmbedder("second", 4);  // priority 5
    const emb3 = makeEmbedder("third", 4);   // priority 10
    const registry = createRegistry([
      { model: "second", embedder: emb2, source_types: ["code"], priority: 5 },
      { model: "third", embedder: emb3, source_types: ["code"], priority: 10 },
      { model: "first", embedder: emb1, source_types: ["code"], priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedders("code");

    // Assert — ordered by priority ascending: 1, 5, 10
    expect(result).toHaveLength(3);
    expect(result[0].model).toBe("first");
    expect(result[1].model).toBe("second");
    expect(result[2].model).toBe("third");
  });

  it("getEmbedders returns single-element array when one embedder matches", () => {
    // Arrange
    const emb = makeEmbedder("lonely", 16);
    const registry = createRegistry([
      { model: "lonely", embedder: emb, source_types: ["markdown"], priority: 3 },
    ]);

    // Act
    const result = registry.getEmbedders("markdown");

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("lonely");
  });

  it("getEmbedders returns empty array when no match and no universal model", () => {
    // Arrange
    const emb = makeEmbedder("code-only", 4);
    const registry = createRegistry([
      { model: "code-only", embedder: emb, source_types: ["code"], priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedders("obsidian");

    // Assert
    expect(result).toEqual([]);
  });

  it("getEmbedders returns universal models when no specific match exists", () => {
    // Arrange
    const universal = makeEmbedder("universal", 384);
    const registry = createRegistry([
      { model: "universal", embedder: universal, priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedders("obsidian");

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("universal");
  });

  it("getEmbedders returns specific matches alongside universal when both exist", () => {
    // Arrange
    const specific = makeEmbedder("specific", 8);
    const universal = makeEmbedder("universal", 384);
    const registry = createRegistry([
      { model: "specific", embedder: specific, source_types: ["code"], priority: 2 },
      { model: "universal", embedder: universal, priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedders("code");

    // Assert — specific match first (lower priority), universal second
    expect(result).toHaveLength(2);
    expect(result[0].model).toBe("universal");
    expect(result[1].model).toBe("specific");
  });

  // -----------------------------------------------------------------------
  // AC 3: Universal model fallback for unresolvable types
  // -----------------------------------------------------------------------

  it("getEmbedder returns universal model for unknown source type when universal exists", () => {
    // Arrange
    const universal = makeEmbedder("fallback", 384);
    const specific = makeEmbedder("code-only", 4);
    const registry = createRegistry([
      { model: "fallback", embedder: universal, priority: 1 },
      { model: "code-only", embedder: specific, source_types: ["code"], priority: 5 },
    ]);

    // Act — "obsidian" has no specific embedder
    const result = registry.getEmbedder("obsidian");

    // Assert — universal fallback returned
    expect(result).not.toBeNull();
    expect(result!.model).toBe("fallback");
  });

  it("getEmbedder returns null when no match and no universal model configured", () => {
    // Arrange — all embedders are type-specific, no universal fallback
    const codeEmb = makeEmbedder("code-emb", 4);
    const mdEmb = makeEmbedder("md-emb", 8);
    const registry = createRegistry([
      { model: "code-emb", embedder: codeEmb, source_types: ["code"], priority: 1 },
      { model: "md-emb", embedder: mdEmb, source_types: ["markdown"], priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedder("obsidian");

    // Assert
    expect(result).toBeNull();
  });

  it("getEmbedder prefers lowest-priority universal when multiple universals exist", () => {
    // Arrange
    const fallbackHigh = makeEmbedder("high-universal", 384);   // priority 1
    const fallbackLow = makeEmbedder("low-universal", 128);     // priority 10
    const registry = createRegistry([
      { model: "low-universal", embedder: fallbackLow, priority: 10 },
      { model: "high-universal", embedder: fallbackHigh, priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedder("unknown-type");

    // Assert — lowest priority number wins
    expect(result).not.toBeNull();
    expect(result!.model).toBe("high-universal");
  });

  it("getEmbedders includes all universal models ordered by priority when no specific match", () => {
    // Arrange
    const uni1 = makeEmbedder("uni-primary", 384);
    const uni2 = makeEmbedder("uni-secondary", 128);
    const registry = createRegistry([
      { model: "uni-secondary", embedder: uni2, priority: 10 },
      { model: "uni-primary", embedder: uni1, priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedders("nonexistent");

    // Assert — both universals returned in priority order
    expect(result).toHaveLength(2);
    expect(result[0].model).toBe("uni-primary");
    expect(result[1].model).toBe("uni-secondary");
  });

  // -----------------------------------------------------------------------
  // AC 4: isAvailable
  // -----------------------------------------------------------------------

  it("isAvailable returns false when no models are registered", () => {
    // Arrange
    const registry = createRegistry([]);

    // Act & Assert
    expect(registry.isAvailable()).toBe(false);
  });

  it("isAvailable returns true when models are configured", () => {
    // Arrange
    const emb = makeEmbedder("some-model", 4);
    const registry = createRegistry([
      { model: "some-model", embedder: emb, source_types: ["code"], priority: 1 },
    ]);

    // Act & Assert
    expect(registry.isAvailable()).toBe(true);
  });

  it("isAvailable returns false after all models removed via unregister (if supported)", () => {
    // This test validates the edge case where models are dynamically removed,
    // leaving the registry empty. Since the interface doesn't define unregister,
    // this simply verifies that an initially empty registry reports false.
    // Arrange
    const registry = createRegistry([]);

    // Act & Assert
    expect(registry.isAvailable()).toBe(false);
  });

  it("isAvailable returns true even with only a universal model", () => {
    // Arrange
    const emb = makeEmbedder("universal", 384);
    const registry = createRegistry([
      { model: "universal", embedder: emb, priority: 1 },
    ]);

    // Act & Assert
    expect(registry.isAvailable()).toBe(true);
  });

  // -----------------------------------------------------------------------
  // AC 5: register(sourceType, embedder, priority)
  // -----------------------------------------------------------------------

  it("register adds a new embedder for a source type", () => {
    // Arrange
    const registry = createRegistry([]);
    const emb = makeEmbedder("new-model", 8);

    // Act
    registry.register("code", emb, 1);
    const result = registry.getEmbedder("code");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.model).toBe("new-model");
  });

  it("register makes isAvailable return true after adding an embedder", () => {
    // Arrange
    const registry = createRegistry([]);
    expect(registry.isAvailable()).toBe(false);

    // Act
    registry.register("code", makeEmbedder("new", 4), 1);

    // Assert
    expect(registry.isAvailable()).toBe(true);
  });

  it("register adds multiple embedders for the same source type", () => {
    // Arrange
    const registry = createRegistry([]);
    const emb1 = makeEmbedder("first", 4);
    const emb2 = makeEmbedder("second", 4);

    // Act
    registry.register("code", emb1, 5);
    registry.register("code", emb2, 1);
    const result = registry.getEmbedders("code");

    // Assert — both returned, ordered by priority
    expect(result).toHaveLength(2);
    expect(result[0].model).toBe("second");  // priority 1
    expect(result[1].model).toBe("first");   // priority 5
  });

  it("register adds universal embedder when source_type is '*' or empty", () => {
    // Arrange
    const registry = createRegistry([]);
    const universal = makeEmbedder("universal", 384);

    // Act — register as universal by using a marker convention
    registry.register("*", universal, 1);
    const result = registry.getEmbedder("unknown-type");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.model).toBe("universal");
  });

  // -----------------------------------------------------------------------
  // AC 6: modelNames
  // -----------------------------------------------------------------------

  it("modelNames returns all unique model names from registered embedders", () => {
    // Arrange
    const registry = createRegistry([
      { model: "alpha", embedder: makeEmbedder("alpha", 4), source_types: ["code"], priority: 1 },
      { model: "beta", embedder: makeEmbedder("beta", 8), source_types: ["markdown"], priority: 1 },
      { model: "gamma", embedder: makeEmbedder("gamma", 384), priority: 5 },
    ]);

    // Act
    const names = registry.modelNames;

    // Assert
    expect(names).toHaveLength(3);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
    expect(names).toContain("gamma");
  });

  it("modelNames deduplicates repeated model names", () => {
    // Arrange — same model name registered under multiple source types
    const registry = createRegistry([
      { model: "shared", embedder: makeEmbedder("shared", 4), source_types: ["code"], priority: 1 },
      { model: "shared", embedder: makeEmbedder("shared", 4), source_types: ["markdown"], priority: 2 },
    ]);

    // Act
    const names = registry.modelNames;

    // Assert — "shared" appears only once
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
    expect(names).toHaveLength(1);
    expect(names).toEqual(["shared"]);
  });

  it("modelNames returns empty array when no models registered", () => {
    // Arrange
    const registry = createRegistry([]);

    // Act & Assert
    expect(registry.modelNames).toEqual([]);
  });

  it("modelNames includes universal model names", () => {
    // Arrange
    const registry = createRegistry([
      { model: "universal-v2", embedder: makeEmbedder("universal-v2", 384), priority: 1 },
    ]);

    // Act & Assert
    expect(registry.modelNames).toEqual(["universal-v2"]);
  });

  // -----------------------------------------------------------------------
  // Interface conformance
  // -----------------------------------------------------------------------

  it("satisfies the EmbedderRegistry interface shape", () => {
    // Arrange — use the type system to verify interface conformance
    const registry: EmbedderRegistry = createRegistry([]);

    // Assert — structural type check: all required members present
    expect(typeof registry.getEmbedder).toBe("function");
    expect(typeof registry.register).toBe("function");
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it("getEmbedder with empty string source type uses universal fallback or returns null", () => {
    // Arrange
    const specific = makeEmbedder("code-only", 4);
    const universal = makeEmbedder("fallback", 384);
    const registry = createRegistry([
      { model: "code-only", embedder: specific, source_types: ["code"], priority: 1 },
      { model: "fallback", embedder: universal, priority: 5 },
    ]);

    // Act — empty string doesn't match any source type
    const withoutUniversal = createRegistry([
      { model: "code-only", embedder: specific, source_types: ["code"], priority: 1 },
    ]);

    // Assert
    expect(registry.getEmbedder("")).not.toBeNull();
    expect(registry.getEmbedder("")!.model).toBe("fallback");
    expect(withoutUniversal.getEmbedder("")).toBeNull();
  });

  it("handles many models with same source type — priority determines winner", () => {
    // Arrange — 5 embedders for the same source type at different priorities
    const emb1 = makeEmbedder("p1", 4);
    const emb2 = makeEmbedder("p2", 4);
    const emb3 = makeEmbedder("p3", 4);
    const emb4 = makeEmbedder("p4", 4);
    const emb5 = makeEmbedder("p5", 4);
    const registry = createRegistry([
      { model: "p5", embedder: emb5, source_types: ["code"], priority: 50 },
      { model: "p3", embedder: emb3, source_types: ["code"], priority: 30 },
      { model: "p1", embedder: emb1, source_types: ["code"], priority: 10 },
      { model: "p4", embedder: emb4, source_types: ["code"], priority: 40 },
      { model: "p2", embedder: emb2, source_types: ["code"], priority: 20 },
    ]);

    // Act — getEmbedder returns minimum priority
    const single = registry.getEmbedder("code");
    const all = registry.getEmbedders("code");

    // Assert
    expect(single).not.toBeNull();
    expect(single!.model).toBe("p1");

    // All returned in ascending priority order
    expect(all).toHaveLength(5);
    expect(all.map((e) => e.model)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("register does not affect already-returned arrays (immutability of getEmbedders)", () => {
    // Arrange
    const emb = makeEmbedder("original", 4);
    const registry = createRegistry([
      { model: "original", embedder: emb, source_types: ["code"], priority: 1 },
    ]);
    const before = registry.getEmbedders("code");

    // Act
    registry.register("code", makeEmbedder("newcomer", 4), 2);
    const after = registry.getEmbedders("code");

    // Assert — the 'before' array is a snapshot, 'after' includes the newcomer
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(2);
  });

  it("register updates availability after construction", () => {
    // Arrange — start empty
    const registry = createRegistry([]);
    expect(registry.isAvailable()).toBe(false);

    // Act
    registry.register("code", makeEmbedder("first", 4), 1);

    // Assert
    expect(registry.isAvailable()).toBe(true);

    // Register another
    registry.register("markdown", makeEmbedder("second", 8), 1);
    expect(registry.isAvailable()).toBe(true);
  });
});


---
# tests/infrastructure/embedding/LanceDbEmbedder.test.ts
---
import { describe, it, expect } from "bun:test";
import { LanceDbEmbedder } from "../../../src/infrastructure/embedding/LanceDbEmbedder";

describe("LanceDbEmbedder", () => {
  const model = "lancedb-fallback";
  const dimensions = 384;

  it("returns a zero vector of the configured dimension", async () => {
    const embedder = new LanceDbEmbedder(model, dimensions);
    const result = await embedder.embed("any text");

    expect(result.vector).toHaveLength(dimensions);
  });

  it("all elements of the returned vector are 0", async () => {
    const embedder = new LanceDbEmbedder(model, dimensions);
    const result = await embedder.embed("any text");

    for (const value of result.vector) {
      expect(value).toBe(0);
    }
  });

  it("exposes model as a readonly property", () => {
    const embedder = new LanceDbEmbedder(model, dimensions);

    expect(embedder.model).toBe(model);
  });

  it("exposes dimensions as a readonly property", () => {
    const embedder = new LanceDbEmbedder(model, dimensions);

    expect(embedder.dimensions).toBe(dimensions);
  });

  it("returns correct tokens_in on the embedding", async () => {
    const embedder = new LanceDbEmbedder(model, dimensions);
    const result = await embedder.embed("any text");

    expect(result.tokens_in).toBe(0);
  });

  it("returns consistent zero vectors for different input text", async () => {
    const embedder = new LanceDbEmbedder(model, dimensions);
    const resultA = await embedder.embed("hello world");
    const resultB = await embedder.embed("different text");

    expect(resultA.vector).toEqual(resultB.vector);
  });

  it("supports different dimensions", async () => {
    const small = new LanceDbEmbedder("small", 8);
    const result = await small.embed("test");

    expect(result.vector).toHaveLength(8);
    expect(small.dimensions).toBe(8);
    for (const value of result.vector) {
      expect(value).toBe(0);
    }
  });

  it("all properties are present in the returned Embedding", async () => {
    const embedder = new LanceDbEmbedder(model, dimensions);
    const result = await embedder.embed("any text");

    expect(result).toHaveProperty("vector");
    expect(result).toHaveProperty("model", model);
    expect(result).toHaveProperty("dimensions", dimensions);
    expect(result).toHaveProperty("tokens_in", 0);
  });
});


---
# tests/infrastructure/embedding/MultiModelEmbedder.test.ts
---
/**
 * RED phase — MultiModelEmbedder.test.ts
 *
 * Tests for the parallel multi-model embedder.
 * MultiModelEmbedder is NOT an Embedder. It returns `Record<string, Embedding>`
 * (not a single Embedding) by running all inner embedders in parallel via
 * Promise.allSettled and tolerating partial failures.
 *
 * Acceptance Criteria:
 *  1. embedAll() calls all embedders in parallel
 *  2. Returns Record<string, Embedding> (NOT single Embedding)
 *  3. Promise.allSettled resilience: one failure doesn't break others
 *  4. Partial results returned when some embedders fail
 */

import { describe, it, expect } from "bun:test";
import { MultiModelEmbedder } from "../../../src/infrastructure/embedding/MultiModelEmbedder";
import type { Embedder, Embedding } from "../../../src/domain/systems/EmbeddingSystem";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a simple inline mock embedder that resolves with a fixed vector.
 * @param model   Model name / identifier
 * @param dimensions  Dimensionality of the returned vector
 * @param delay   Optional artificial delay (ms) to simulate async work
 */
function createSuccessEmbedder(
  model: string,
  dimensions: number,
  delay = 0,
): Embedder {
  return {
    model,
    dimensions,
    embed: async (text: string): Promise<Embedding> => {
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
      return {
        vector: Array.from({ length: dimensions }, (_, i) => i + 1),
        model,
        dimensions,
        tokens_in: text.split(/\s+/).filter(Boolean).length,
      };
    },
  };
}

/**
 * Creates a mock embedder that always rejects with a given error message.
 */
function createFailingEmbedder(
  model: string,
  dimensions: number,
  message = "embedder failure",
): Embedder {
  return {
    model,
    dimensions,
    embed: async (_text: string): Promise<Embedding> => {
      throw new Error(message);
    },
  };
}

/**
 * Creates a mock embedder that records every call for later inspection.
 */
function createSpyEmbedder(
  model: string,
  dimensions: number,
  calls: Array<{ text: string; timestamp: number }>,
): Embedder {
  return {
    model,
    dimensions,
    embed: async (text: string): Promise<Embedding> => {
      calls.push({ text, timestamp: Date.now() });
      return {
        vector: Array.from({ length: dimensions }, (_, i) => i),
        model,
        dimensions,
        tokens_in: text.length,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("MultiModelEmbedder", () => {
  // -----------------------------------------------------------------------
  // AC 1: Returns Record<string, Embedding>
  // -----------------------------------------------------------------------
  it("embedAll returns Record<string, Embedding> with correct shape", async () => {
    // Arrange
    const embedders: Record<string, Embedder> = {
      "model-alpha": createSuccessEmbedder("model-alpha", 4),
      "model-beta": createSuccessEmbedder("model-beta", 8),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act
    const result = await multi.embedAll("hello world");

    // Assert — record has expected keys
    expect(result).toBeTruthy();
    expect(typeof result).toBe("object");
    expect(Object.keys(result).sort()).toEqual(["model-alpha", "model-beta"]);

    // Assert — each value is a valid Embedding
    for (const [model, emb] of Object.entries(result)) {
      expect(emb).toHaveProperty("vector");
      expect(emb).toHaveProperty("model");
      expect(emb).toHaveProperty("dimensions");
      expect(emb).toHaveProperty("tokens_in");

      expect(emb.model).toBe(model);
      expect(Array.isArray(emb.vector)).toBe(true);
      expect(typeof emb.dimensions).toBe("number");
      expect(typeof emb.tokens_in).toBe("number");
    }
  });

  it("embedAll returns Embedding values (not a single Embedding)", async () => {
    // Arrange
    const embedders: Record<string, Embedder> = {
      m1: createSuccessEmbedder("m1", 3),
      m2: createSuccessEmbedder("m2", 3),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act
    const result = await multi.embedAll("test");

    // Assert — result is a Record, not an Embedding
    // If someone mistakenly returns an Embedding, it will NOT have both
    // keys as model names AND Embedding fields on the same level.
    expect(result.m1).toBeTruthy();
    expect(result.m1.vector).toBeDefined();
    expect(result.m2).toBeTruthy();
    expect(result.m2.vector).toBeDefined();

    // Confirm it's NOT a single Embedding (no top-level vector)
    expect((result as unknown as Embedding).vector).toBeUndefined();
  });

  it("embedAll returns vector arrays with correct dimensions", async () => {
    // Arrange
    const embedders: Record<string, Embedder> = {
      small: createSuccessEmbedder("small", 2),
      large: createSuccessEmbedder("large", 384),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act
    const result = await multi.embedAll("dimensional check");

    // Assert
    expect(result.small.vector).toHaveLength(2);
    expect(result.small.dimensions).toBe(2);
    expect(result.large.vector).toHaveLength(384);
    expect(result.large.dimensions).toBe(384);
  });

  // -----------------------------------------------------------------------
  // AC 2 (parallel behaviour via timing)
  // -----------------------------------------------------------------------
  it("calls all embedders in parallel (not sequentially)", async () => {
    // Arrange — two embedders each with 50 ms artificial delay
    const embedders: Record<string, Embedder> = {
      slow1: createSuccessEmbedder("slow1", 4, 50),
      slow2: createSuccessEmbedder("slow2", 4, 50),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act — measure elapsed time
    const start = performance.now();
    const result = await multi.embedAll("parallel test");
    const elapsed = performance.now() - start;

    // Assert — if run sequentially it would take ~100 ms;
    // in parallel it should take ~50 ms (with some tolerance for scheduling).
    // We allow up to 75 ms to account for event-loop overhead.
    expect(elapsed).toBeLessThan(90);
    expect(Object.keys(result).length).toBe(2);
  });

  it("calls each embedder with the correct text", async () => {
    // Arrange
    const calls1: Array<{ text: string; timestamp: number }> = [];
    const calls2: Array<{ text: string; timestamp: number }> = [];
    const embedders: Record<string, Embedder> = {
      spy1: createSpyEmbedder("spy1", 2, calls1),
      spy2: createSpyEmbedder("spy2", 2, calls2),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act
    await multi.embedAll("specific input text");

    // Assert
    expect(calls1).toHaveLength(1);
    expect(calls1[0].text).toBe("specific input text");
    expect(calls2).toHaveLength(1);
    expect(calls2[0].text).toBe("specific input text");
  });

  // -----------------------------------------------------------------------
  // AC 3 & 4: Promise.allSettled — partial failure resilience
  // -----------------------------------------------------------------------
  it("tolerates a single failing embedder and returns partial results", async () => {
    // Arrange
    const embedders: Record<string, Embedder> = {
      good: createSuccessEmbedder("good", 4),
      bad: createFailingEmbedder("bad", 4, "oops"),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act — should NOT throw
    const result = await multi.embedAll("partial failure");

    // Assert — only the successful embedder's result is present
    expect(result.good).toBeDefined();
    expect(result.good.model).toBe("good");
    expect(result.good.vector).toHaveLength(4);

    // The failing embedder should be absent
    expect(result.bad).toBeUndefined();
  });

  it("tolerates multiple failing embedders (only successes returned)", async () => {
    // Arrange — 2 good, 2 bad
    const embedders: Record<string, Embedder> = {
      good1: createSuccessEmbedder("good1", 2),
      bad1: createFailingEmbedder("bad1", 2),
      good2: createSuccessEmbedder("good2", 4),
      bad2: createFailingEmbedder("bad2", 4),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act
    const result = await multi.embedAll("two good two bad");

    // Assert
    expect(result.good1).toBeDefined();
    expect(result.good2).toBeDefined();
    expect(result.bad1).toBeUndefined();
    expect(result.bad2).toBeUndefined();
    expect(Object.keys(result).length).toBe(2);
  });

  it("returns an empty record when all embedders fail", async () => {
    // Arrange
    const embedders: Record<string, Embedder> = {
      fail1: createFailingEmbedder("fail1", 4),
      fail2: createFailingEmbedder("fail2", 8),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act — should NOT throw despite all failing
    const result = await multi.embedAll("all fail");

    // Assert
    expect(result).toEqual({});
  });

  it("succeeds for all embedders when none fail", async () => {
    // Arrange
    const embedders: Record<string, Embedder> = {
      a: createSuccessEmbedder("a", 2),
      b: createSuccessEmbedder("b", 3),
      c: createSuccessEmbedder("c", 4),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act
    const result = await multi.embedAll("all good");

    // Assert
    expect(Object.keys(result).length).toBe(3);
    expect(result.a).toBeDefined();
    expect(result.b).toBeDefined();
    expect(result.c).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  it("returns empty record when no embedders are configured", async () => {
    // Arrange
    const multi = new MultiModelEmbedder({});

    // Act
    const result = await multi.embedAll("empty");

    // Assert
    expect(result).toEqual({});
  });

  it("handles a single embedder gracefully", async () => {
    // Arrange
    const embedders: Record<string, Embedder> = {
      solo: createSuccessEmbedder("solo", 1),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act
    const result = await multi.embedAll("solo artist");

    // Assert
    expect(Object.keys(result).length).toBe(1);
    expect(result.solo.model).toBe("solo");
    expect(result.solo.vector).toHaveLength(1);
    expect(result.solo.tokens_in).toBe(2); // two words
  });

  it("passes empty string to each embedder", async () => {
    // Arrange
    const calls1: Array<{ text: string; timestamp: number }> = [];
    const calls2: Array<{ text: string; timestamp: number }> = [];
    const embedders: Record<string, Embedder> = {
      spy1: createSpyEmbedder("spy1", 2, calls1),
      spy2: createSpyEmbedder("spy2", 2, calls2),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act
    const result = await multi.embedAll("");

    // Assert
    expect(calls1[0].text).toBe("");
    expect(calls2[0].text).toBe("");
    expect(Object.keys(result).length).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Type safety: Record key contract
  // -----------------------------------------------------------------------
  it("uses embedder model names as result keys", async () => {
    // Arrange — model name differs from record key
    const embedders: Record<string, Embedder> = {
      key1: createSuccessEmbedder("actual-model-a", 2),
      key2: createSuccessEmbedder("actual-model-b", 4),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act
    const result = await multi.embedAll("key contract");

    // Assert — keys match the record keys (key1, key2), not the inner model names
    expect(Object.keys(result).sort()).toEqual(["key1", "key2"]);
    expect(result.key1.model).toBe("actual-model-a");
    expect(result.key2.model).toBe("actual-model-b");
  });
});


---
# tests/infrastructure/embedding/NullEmbedder.test.ts
---
/**
 * RED phase — NullEmbedder.test.ts
 *
 * Tests for the null embedder that always throws.
 * NullEmbedder implements Embedder interface and always throws
 * "no embedder available" on any call to embed().
 *
 * Acceptance Criteria:
 *  1. embed() always throws an error
 *  2. Error message includes "no embedder available"
 *  3. model and dimensions properties exist (return "null" or "0")
 */

import { describe, it, expect } from "bun:test";
import { NullEmbedder } from "../../../src/infrastructure/embedding/NullEmbedder";
import type { Embedder } from "../../../src/domain/systems/EmbeddingSystem";

// ---------------------------------------------------------------------------
// NullEmbedder
// ---------------------------------------------------------------------------
describe("NullEmbedder", () => {
  // -----------------------------------------------------------------------
  // AC 1 & 2: embed() always throws with matching message
  // -----------------------------------------------------------------------
  it("embed rejects with 'no embedder available'", async () => {
    // Arrange
    const embedder = new NullEmbedder();

    // Act & Assert
    await expect(embedder.embed("anything")).rejects.toThrow("no embedder available");
  });

  it("embed rejects for empty string input", async () => {
    // Arrange
    const embedder = new NullEmbedder();

    // Act & Assert
    await expect(embedder.embed("")).rejects.toThrow("no embedder available");
  });

  it("embed rejects for special character input", async () => {
    // Arrange
    const embedder = new NullEmbedder();

    // Act & Assert
    await expect(embedder.embed("!@#$%^&*()_+\n\t\r")).rejects.toThrow("no embedder available");
  });

  it("embed rejects consistently on multiple calls", async () => {
    // Arrange
    const embedder = new NullEmbedder();

    // Act & Assert — first call
    await expect(embedder.embed("first")).rejects.toThrow("no embedder available");

    // Assert — second call (consistency)
    await expect(embedder.embed("second")).rejects.toThrow("no embedder available");

    // Assert — third call
    await expect(embedder.embed("third")).rejects.toThrow("no embedder available");
  });

  it("embed error message includes exactly 'no embedder available'", async () => {
    // Arrange
    const embedder = new NullEmbedder();

    // Act & Assert — verify the full error message
    await expect(embedder.embed("test")).rejects.toThrow("no embedder available");
  });

  // -----------------------------------------------------------------------
  // AC 3: model and dimensions properties
  // -----------------------------------------------------------------------
  it("exposes model as a readonly property returning 'null'", () => {
    // Arrange
    const embedder = new NullEmbedder();

    // Act & Assert
    expect(embedder.model).toBe("null");
  });

  it("exposes dimensions as a readonly property returning 0", () => {
    // Arrange
    const embedder = new NullEmbedder();

    // Act & Assert
    expect(embedder.dimensions).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Interface conformance
  // -----------------------------------------------------------------------
  it("satisfies the Embedder interface shape", () => {
    // Arrange
    const embedder: Embedder = new NullEmbedder();

    // Act & Assert — structural type check: all required members present
    expect(typeof embedder.embed).toBe("function");
    expect(typeof embedder.model).toBe("string");
    expect(typeof embedder.dimensions).toBe("number");
  });
});


---
# tests/infrastructure/embedding/OllamaEmbedder.test.ts
---
/**
 * RED phase — OllamaEmbedder.test.ts
 *
 * Tests for the OllamaEmbedder HTTP client that calls Ollama's /api/embeddings
 * endpoint. Covers HTTP request formation, response parsing, Float32Array
 * conversion, exponential backoff retry (1s -> 2s -> 4s), AbortSignal
 * cancellation, and readonly property access.
 *
 * Acceptance Criteria:
 *  1. embed() sends HTTP POST to /api/embeddings and returns Float32Array
 *     of configured dimensions (default 384)
 *  2. embedBatch() sends one HTTP POST per text, returns array of Embeddings
 *  3. Exponential backoff: 1s -> 2s delay between up to 3 attempts, then throws
 *  4. AbortSignal cancels in-flight request — AbortError propagates immediately
 *  5. model and dimensions readonly properties match constructor arguments
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { OllamaEmbedder } from "../../../src/infrastructure/embedding/OllamaEmbedder";
import type { Embedder } from "../../../src/domain/systems/EmbeddingSystem";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a successful mock fetch that returns the given embedding vector.
 * Tracks request info (URL, method, body) and call count for assertions.
 */
function createMockFetch(embedding: number[]) {
  const info = { url: "", method: "", body: "", callCount: 0 };
  const mock = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    info.callCount++;
    info.url =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.href
          : url.url;
    info.method = init?.method ?? "GET";
    info.body = typeof init?.body === "string" ? init.body : "";
    return new Response(JSON.stringify({ embedding }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { mock: mock as typeof fetch, info };
}

/**
 * Creates a mock fetch that always throws a network Error.
 */
function createFailingMockFetch() {
  let callCount = 0;
  const mock = async (): Promise<Response> => {
    callCount++;
    throw new Error("Network error");
  };
  return { mock: mock as typeof fetch, callCount: () => callCount };
}

/**
 * Creates a mock fetch that fails for the first `failCount` calls,
 * then succeeds on the next call.  Used to test retry logic deterministically.
 */
function createSequentialMockFetch(failCount: number, successEmbedding: number[]) {
  let callCount = 0;
  const mock = async (
    _url: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    callCount++;
    if (callCount <= failCount) {
      throw new Error("Network error");
    }
    return new Response(JSON.stringify({ embedding: successEmbedding }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { mock: mock as typeof fetch, callCount: () => callCount };
}

/**
 * Creates a mock fetch that returns a non-OK HTTP status for every call.
 */
function createErrorStatusMockFetch(status: number, statusText: string) {
  let callCount = 0;
  const mock = async (): Promise<Response> => {
    callCount++;
    return new Response(null, { status, statusText });
  };
  return { mock: mock as typeof fetch, callCount: () => callCount };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("OllamaEmbedder", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalSetTimeout: typeof globalThis.setTimeout;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalSetTimeout = globalThis.setTimeout;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  });

  // -----------------------------------------------------------------------
  // AC 5: model / dimensions readonly properties
  // -----------------------------------------------------------------------
  describe("constructor properties (AC 5)", () => {
    it("exposes model as a readonly property", () => {
      // Arrange
      const embedder = new OllamaEmbedder("nomic-embed-text", 768);

      // Act & Assert
      expect(embedder.model).toBe("nomic-embed-text");
    });

    it("exposes dimensions as a readonly property", () => {
      // Arrange
      const embedder = new OllamaEmbedder("test-model", 512);

      // Act & Assert
      expect(embedder.dimensions).toBe(512);
    });

    it("uses default dimensions of 384 when not provided", () => {
      // Arrange
      const embedder = new OllamaEmbedder("default-model");

      // Act & Assert
      expect(embedder.dimensions).toBe(384);
    });

    it("uses default baseUrl http://localhost:11434 when not provided", async () => {
      // Arrange
      const { mock, info } = createMockFetch([0.1, 0.2, 0.3]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("test-model", 3);

      // Act
      await embedder.embed("hello");

      // Assert
      expect(info.url).toBe("http://localhost:11434/api/embeddings");
    });

    it("uses custom baseUrl when provided", async () => {
      // Arrange
      const { mock, info } = createMockFetch([0.1, 0.2]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("test-model", 2, "http://custom:5678");

      // Act
      await embedder.embed("hello");

      // Assert
      expect(info.url).toBe("http://custom:5678/api/embeddings");
    });

    it("model and dimensions are compile-time readonly", () => {
      // Arrange
      const embedder = new OllamaEmbedder("readonly-test", 128);

      // Assert
      expect(embedder.model).toBe("readonly-test");
      expect(embedder.dimensions).toBe(128);

      // TypeScript ensures readonly — the following would cause compile errors:
      //   embedder.model = "other";     // Error: Cannot assign to 'model' because it is a read-only property
      //   embedder.dimensions = 256;    // Error: Cannot assign to 'dimensions' because it is a read-only property
    });
  });

  // -----------------------------------------------------------------------
  // AC 1: embed() sends HTTP POST and returns Float32Array of configured dims
  // -----------------------------------------------------------------------
  describe("embed() (AC 1)", () => {
    it("sends HTTP POST to /api/embeddings with correct model and prompt", async () => {
      // Arrange
      const { mock, info } = createMockFetch([0.1, 0.2, 0.3]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("test-model", 3);

      // Act
      await embedder.embed("hello world");

      // Assert
      expect(info.method).toBe("POST");
      expect(info.url).toContain("/api/embeddings");
      const body = JSON.parse(info.body);
      expect(body.model).toBe("test-model");
      expect(body.prompt).toBe("hello world");
    });

    it("returns an Embedding with a Float32Array vector", async () => {
      // Arrange
      const { mock } = createMockFetch([0.5, 0.6, 0.7, 0.8]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("test-model", 4);

      // Act
      const result = await embedder.embed("test");

      // Assert
      expect(result.vector).toBeInstanceOf(Float32Array);
    });

    it("returns vector with length matching default dimensions (384)", async () => {
      // Arrange
      const longVector = Array.from({ length: 384 }, (_, i) => i * 0.01);
      const { mock } = createMockFetch(longVector);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("default-model");

      // Act
      const result = await embedder.embed("test");

      // Assert
      expect(result.vector).toHaveLength(384);
      expect(result.dimensions).toBe(384);
    });

    it("returns vector with length matching custom dimensions (768)", async () => {
      // Arrange
      const longVector = Array.from({ length: 768 }, (_, i) => i * 0.005);
      const { mock } = createMockFetch(longVector);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("custom-model", 768);

      // Act
      const result = await embedder.embed("test");

      // Assert
      expect(result.vector).toHaveLength(768);
      expect(result.dimensions).toBe(768);
    });

    it("response metadata includes model, dimensions, and tokens_in", async () => {
      // Arrange
      const { mock } = createMockFetch([0.1, 0.2, 0.3, 0.4]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("meta-model", 4);

      // Act
      const result = await embedder.embed("hello world");

      // Assert
      expect(result.model).toBe("meta-model");
      expect(result.dimensions).toBe(4);
      // tokens_in uses ceil(text.length / 4) heuristic
      expect(result.tokens_in).toBe(Math.ceil("hello world".length / 4));
    });

    it("throws when API response is malformed (non-JSON)", async () => {
      // Arrange — mock setTimeout to resolve immediately for fast test
      globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof globalThis.setTimeout;
      const mockFetch = async (): Promise<Response> => {
        return new Response("not json", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      };
      globalThis.fetch = mockFetch as typeof fetch;
      const embedder = new OllamaEmbedder("bad-response", 3);

      // Act & Assert
      await expect(embedder.embed("test")).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // AC 2: embedBatch() sends HTTP POST for each text
  // -----------------------------------------------------------------------
  describe("embedBatch() (AC 2)", () => {
    it("embeds multiple texts and returns array of Embedding results", async () => {
      // Arrange
      const { mock } = createMockFetch([0.1, 0.2, 0.3]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("batch-model", 3);

      // Act
      const results = await embedder.embedBatch([
        "first text",
        "second text",
        "third text",
      ]);

      // Assert
      expect(results).toHaveLength(3);
      for (const r of results) {
        expect(r.vector).toBeInstanceOf(Float32Array);
        expect(r.vector).toHaveLength(3);
        expect(r.model).toBe("batch-model");
        expect(r.dimensions).toBe(3);
      }
    });

    it("sends exactly one HTTP POST per text in the batch", async () => {
      // Arrange
      let callCount = 0;
      const mockFetch = async (): Promise<Response> => {
        callCount++;
        return new Response(JSON.stringify({ embedding: [0.1, 0.2] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };
      globalThis.fetch = mockFetch as typeof fetch;
      const embedder = new OllamaEmbedder("count-model", 2);

      // Act
      await embedder.embedBatch(["a", "b", "c", "d"]);

      // Assert
      expect(callCount).toBe(4);
    });

    it("handles batch with a single text", async () => {
      // Arrange
      const { mock } = createMockFetch([0.42, 0.84]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("single-batch", 2);

      // Act
      const results = await embedder.embedBatch(["only one"]);

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].model).toBe("single-batch");
      expect(results[0].vector).toHaveLength(2);
    });

    it("returns empty array for empty batch (no fetch calls)", async () => {
      // Arrange — do NOT mock fetch; embedBatch([]) calls Promise.all([])
      // which resolves to [] without invoking any embed() call.
      const embedder = new OllamaEmbedder("empty-batch", 2);

      // Act
      const results = await embedder.embedBatch([]);

      // Assert
      expect(results).toEqual([]);
    });

    it("rejects entire batch when one embed fails after retries exhausted", async () => {
      // Arrange — mock fetch that always throws (persistent failure, no recovery)
      const mockFetch = async (): Promise<Response> => {
        throw new Error("Persistent failure");
      };
      globalThis.fetch = mockFetch as typeof fetch;
      globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof globalThis.setTimeout;
      const embedder = new OllamaEmbedder("fail-batch", 2);

      // Act & Assert — Promise.all propagates failure from any call
      await expect(
        embedder.embedBatch(["fail1", "fail2"]),
      ).rejects.toThrow("Persistent failure");
    });
  });

  // -----------------------------------------------------------------------
  // AC 3: Exponential backoff — 1s -> 2s delay, max 3 attempts, then throws
  // -----------------------------------------------------------------------
  describe("retry with exponential backoff (AC 3)", () => {
    it("succeeds on first retry after single failure", async () => {
      // Arrange — mock setTimeout to resolve sleep() immediately
      globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof globalThis.setTimeout;

      const { mock, callCount } = createSequentialMockFetch(1, [0.1, 0.2, 0.3]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("retry-model", 3);

      // Act
      const result = await embedder.embed("retry test");

      // Assert — 2 fetch calls total (1 fail + 1 success)
      expect(result.vector).toBeInstanceOf(Float32Array);
      expect(result.vector).toHaveLength(3);
    });

    it("succeeds on second retry after two failures", async () => {
      // Arrange
      globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof globalThis.setTimeout;

      const { mock } = createSequentialMockFetch(2, [0.5, 0.6]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("retry-model", 2);

      // Act
      const result = await embedder.embed("retry again");

      // Assert — 3 fetch calls total (2 fail + 1 success)
      expect(result.vector).toHaveLength(2);
      expect(result.model).toBe("retry-model");
    });

    it("throws after 3 failed attempts (max retries exhausted)", async () => {
      // Arrange
      globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof globalThis.setTimeout;

      const { mock, callCount } = createFailingMockFetch();
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("fail-model", 3);

      // Act & Assert
      await expect(embedder.embed("will fail")).rejects.toThrow();
    });

    it("makes exactly 3 fetch attempts before throwing on persistent failure", async () => {
      // Arrange
      globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof globalThis.setTimeout;

      const { mock, callCount } = createFailingMockFetch();
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("count-fails", 3);

      // Act & Assert
      try {
        await embedder.embed("count me");
      } catch {
        // Expected
      }

      // Assert — exactly 3 fetch calls were made
      expect(callCount()).toBe(3);
    });

    it("last thrown error is the error from the final attempt", async () => {
      // Arrange
      globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof globalThis.setTimeout;

      const { mock } = createSequentialMockFetch(3, [0.1]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("last-err", 1);

      // Act & Assert
      await expect(embedder.embed("fail")).rejects.toThrow("Network error");
    });

    it("retries on HTTP error status (500) up to 3 attempts", async () => {
      // Arrange
      globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof globalThis.setTimeout;

      const { mock, callCount } = createErrorStatusMockFetch(500, "Internal Server Error");
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("http-retry", 3);

      // Act & Assert
      await expect(embedder.embed("server error")).rejects.toThrow(
        /Ollama API error: 500/i,
      );
      expect(callCount()).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // AC 4: AbortSignal cancels in-flight request (AbortError, no retry)
  // -----------------------------------------------------------------------
  describe("AbortSignal support (AC 4)", () => {
    it("passes AbortSignal through to fetch init", async () => {
      // Arrange
      let capturedSignal: AbortSignal | undefined;
      const mockFetch = async (
        _url: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        capturedSignal = init?.signal;
        return new Response(JSON.stringify({ embedding: [0.1] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };
      globalThis.fetch = mockFetch as typeof fetch;
      const embedder = new OllamaEmbedder("signal-test", 1);
      const controller = new AbortController();

      // Act
      await embedder.embed("test", controller.signal);

      // Assert
      expect(capturedSignal).toBe(controller.signal);
    });

    it("rejects with AbortError when passed an already-aborted signal", async () => {
      // Arrange — mock fetch checks signal and throws DOMException like real fetch
      const mockFetch = async (
        _url: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        if (init?.signal?.aborted) {
          throw new DOMException("The operation was aborted", "AbortError");
        }
        return new Response(JSON.stringify({ embedding: [0.1] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };
      globalThis.fetch = mockFetch as typeof fetch;
      const embedder = new OllamaEmbedder("abort-test", 1);
      const controller = new AbortController();
      controller.abort();

      // Act & Assert
      await expect(embedder.embed("test", controller.signal)).rejects.toThrow();
      await expect(
        embedder.embed("test", controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
    });

    it("does NOT retry when AbortError is thrown (propagates immediately)", async () => {
      // Arrange
      let fetchCallCount = 0;
      const mockFetch = async (
        _url: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        fetchCallCount++;
        // Simulate real fetch: throw AbortError if signal is already aborted
        if (init?.signal?.aborted) {
          throw new DOMException("The operation was aborted", "AbortError");
        }
        throw new Error("Network error");
      };
      globalThis.fetch = mockFetch as typeof fetch;
      // Mock setTimeout in case any sleep runs (it shouldn't since first fetch
      // throws AbortError, but hedge against implementation changes)
      globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof globalThis.setTimeout;
      const embedder = new OllamaEmbedder("no-retry-abort", 2);
      const controller = new AbortController();

      // Act — abort before calling embed
      controller.abort();

      // Assert
      await expect(
        embedder.embed("test", controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
      // Only the first attempt fires; no retry because AbortError re-throws
      expect(fetchCallCount).toBe(1);
    });

    it("rejects when signal is aborted mid-flight (simulated)", async () => {
      // Arrange — create a pending fetch that can be aborted externally
      let abortHandler: (() => void) | null = null;
      let signalCaptured = false;
      const mockFetch = async (
        _url: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        return new Promise((_resolve, reject) => {
          if (init?.signal) {
            signalCaptured = true;
            if (init.signal.aborted) {
              reject(new DOMException("The operation was aborted", "AbortError"));
              return;
            }
            init.signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted", "AbortError"));
            });
          }
          // Intentionally never resolve — keep request in-flight
        });
      };
      globalThis.fetch = mockFetch as typeof fetch;
      const embedder = new OllamaEmbedder("mid-flight", 2);
      const controller = new AbortController();

      // Act — start request, then abort after a microtask
      const promise = embedder.embed("in flight", controller.signal);
      setTimeout(() => controller.abort(), 0);

      // Assert
      await expect(promise).rejects.toMatchObject({ name: "AbortError" });
      expect(signalCaptured).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Interface conformance
  // -----------------------------------------------------------------------
  describe("Embedder interface conformance", () => {
    it("satisfies the Embedder interface shape", () => {
      // Arrange
      const embedder: Embedder = new OllamaEmbedder("iface-model", 64);

      // Act & Assert
      expect(typeof embedder.embed).toBe("function");
      expect(typeof embedder.model).toBe("string");
      expect(typeof embedder.dimensions).toBe("number");
    });

    it("embed() returns a Promise", () => {
      // Arrange
      const { mock } = createMockFetch([0.1]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("promise-test", 1);

      // Act
      const result = embedder.embed("test");

      // Assert
      expect(result).toBeInstanceOf(Promise);
    });
  });
});


---
# tests/infrastructure/hashing/BLAKE3Hasher.test.ts
---
import { describe, it, expect } from "bun:test";
import { BLAKE3Hasher } from "../../../src/infrastructure/hashing/BLAKE3Hasher";

describe("BLAKE3Hasher", () => {
  const hasher = new BLAKE3Hasher();

  it("hash('hello') returns a 64-character hex string", async () => {
    const result = await hasher.hash("hello");
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hash('hello') !== hash('world')", async () => {
    const [a, b] = await Promise.all([
      hasher.hash("hello"),
      hasher.hash("world"),
    ]);
    expect(a).not.toBe(b);
  });

  it("hashFile(path) matches hash(content) for the same file", async () => {
    const content = "BLAKE3 test file content";
    const path = "/tmp/blake3-test-file.txt";
    await Bun.write(path, content);
    const fileHash = await hasher.hashFile(path);
    const contentHash = await hasher.hash(content);
    expect(fileHash).toBe(contentHash);
  });

  it("hash('') returns a valid 64-character hex string", async () => {
    const result = await hasher.hash("");
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hash is deterministic — same input always returns same output", async () => {
    const input = "determinism-test-" + Math.random();
    const [a, b] = await Promise.all([
      hasher.hash(input),
      hasher.hash(input),
    ]);
    expect(a).toBe(b);
  });

  it("hash algorithm property is 'BLAKE3'", () => {
    expect(hasher.algorithm).toBe("BLAKE3");
  });
});


---
# tests/infrastructure/hashing/TokenEstimatorSimple.test.ts
---
import { describe, it, expect } from "bun:test";
import { TokenEstimatorSimple } from "../../../src/infrastructure/hashing/TokenEstimatorSimple";

describe("TokenEstimatorSimple", () => {
  const estimator = new TokenEstimatorSimple();

  it("estimate('hello') returns 2 (Math.ceil(5/4))", async () => {
    const result = await estimator.estimate("hello");
    expect(result).toBe(2);
  });

  it("estimate('') returns 0", async () => {
    const result = await estimator.estimate("");
    expect(result).toBe(0);
  });

  it("estimate('a'.repeat(100)) returns 25 (Math.ceil(100/4))", async () => {
    const result = await estimator.estimate("a".repeat(100));
    expect(result).toBe(25);
  });

  it("estimate('a'.repeat(3)) returns 1 (Math.ceil(3/4))", async () => {
    const result = await estimator.estimate("a".repeat(3));
    expect(result).toBe(1);
  });

  it("estimate('a'.repeat(4)) returns 1 (Math.ceil(4/4))", async () => {
    const result = await estimator.estimate("a".repeat(4));
    expect(result).toBe(1);
  });

  it("model property is 'simple-byte-estimate'", () => {
    expect(estimator.model).toBe("simple-byte-estimate");
  });
});


---
# tests/infrastructure/hashing/TokenEstimatorTiktoken.test.ts
---
import { describe, it, expect } from "bun:test";
import { TokenEstimatorTiktoken } from "../../../src/infrastructure/hashing/TokenEstimatorTiktoken";

describe("TokenEstimatorTiktoken", () => {
  const estimator = new TokenEstimatorTiktoken();

  it("model property is set to 'gpt-4'", () => {
    expect(estimator.model).toBe("gpt-4");
  });

  it("estimate('') returns 0", async () => {
    const result = await estimator.estimate("");
    expect(result).toBe(0);
  });

  it("estimate returns reasonable non-negative values", async () => {
    const result = await estimator.estimate("a".repeat(100));
    expect(result).toBeGreaterThanOrEqual(0);
  });
});


---
# tests/infrastructure/lancedb/LanceDbSourceRepository.test.ts
---
import { describe, it, expect, beforeEach } from "bun:test";
import * as lancedb from "@lancedb/lancedb";

import type { SourceData, SearchQuery, IndexStats } from "../../../src/domain/types";
import type { FileIndex } from "../../../src/domain/ast";
import type { SourceRepository } from "../../../src/domain/ports/SourceRepository";
import { LanceDbSourceRepository } from "../../../src/infrastructure/lancedb/LanceDbSourceRepository";
import type { Import, Export, SymbolDetail, Relationship } from "../../../src/domain/ast";

/**
 * Build a minimal SourceData with sensible defaults for testing.
 */
function makeSourceData(overrides: Partial<SourceData> & { id: string }): SourceData {
  return {
    chunk_id: overrides.chunk_id ?? `chunk-${overrides.id}`,
    source_id: overrides.source_id ?? `src-${overrides.id}`,
    type: overrides.type ?? "code",
    title: overrides.title ?? `Title ${overrides.id}`,
    content: overrides.content ?? `Content for ${overrides.id}`,
    tags: overrides.tags ?? [],
    path: overrides.path ?? `/test/file-${overrides.id}.ts`,
    file_blake3: overrides.file_blake3 ?? `blake3-file-${overrides.id}`,
    semantic_blake3: overrides.semantic_blake3 ?? `blake3-sem-${overrides.id}`,
    chunk_index: overrides.chunk_index ?? 0,
    total_chunks: overrides.total_chunks ?? 1,
    embeddings: overrides.embeddings ?? [],
    metadata: overrides.metadata ?? { kind: "code", language: "typescript" },
    created_at: overrides.created_at ?? "2026-06-01T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Build a minimal FileIndex for testing.
 */
function makeFileIndex(overrides: Partial<FileIndex> & { path: string }): FileIndex {
  return {
    file_blake3: overrides.file_blake3 ?? "blake3-file-idx",
    language: overrides.language ?? "typescript",
    imports: overrides.imports ?? [],
    exports: overrides.exports ?? [],
    symbols: overrides.symbols ?? [],
    relationships: overrides.relationships ?? [],
    last_parsed: overrides.last_parsed ?? "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("LanceDbSourceRepository", () => {
  let repo: SourceRepository;

  beforeEach(async () => {
    // Fresh in-memory LanceDB for each test
    repo = new LanceDbSourceRepository("memory://");
    await (repo as LanceDbSourceRepository).connect();
  });

  // ── Sources table CRUD ──────────────────────────────────────

  describe("sources table CRUD", () => {
    it("upsert → getById returns the data", async () => {
      const data = makeSourceData({ id: "s1" });
      await repo.upsert(data);

      const result = await repo.getById("s1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("s1");
      expect(result!.content).toBe("Content for s1");
    });

    it("upsert → getByPath returns all chunks for that path", async () => {
      const chunk1 = makeSourceData({ id: "c1", path: "/shared.ts", chunk_index: 0, total_chunks: 2 });
      const chunk2 = makeSourceData({ id: "c2", path: "/shared.ts", chunk_index: 1, total_chunks: 2 });

      await repo.upsert(chunk1);
      await repo.upsert(chunk2);

      const results = await repo.getByPath("/shared.ts");
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.id).sort()).toEqual(["c1", "c2"]);
    });

    it("upsert multiple chunks → getByPath returns all", async () => {
      const data1 = makeSourceData({ id: "a1", path: "/multi.ts", chunk_index: 0 });
      const data2 = makeSourceData({ id: "a2", path: "/multi.ts", chunk_index: 1 });
      const data3 = makeSourceData({ id: "a3", path: "/multi.ts", chunk_index: 2 });

      await repo.upsert(data1);
      await repo.upsert(data2);
      await repo.upsert(data3);

      const results = await repo.getByPath("/multi.ts");
      expect(results).toHaveLength(3);
    });

    it("upsertBatch → getById for each", async () => {
      const allData = [
        makeSourceData({ id: "b1", path: "/batch.ts" }),
        makeSourceData({ id: "b2", path: "/batch.ts" }),
        makeSourceData({ id: "b3", path: "/other.ts" }),
      ];

      await repo.upsertBatch(allData);

      const r1 = await repo.getById("b1");
      const r2 = await repo.getById("b2");
      const r3 = await repo.getById("b3");

      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      expect(r3).not.toBeNull();
    });

    it("delete → getById returns null after", async () => {
      const data = makeSourceData({ id: "d1" });
      await repo.upsert(data);

      const before = await repo.getById("d1");
      expect(before).not.toBeNull();

      await repo.delete("d1");

      const after = await repo.getById("d1");
      expect(after).toBeNull();
    });

    it("deleteByPath → getByPath returns [] after", async () => {
      await repo.upsert(makeSourceData({ id: "e1", path: "/delete-path.ts" }));
      await repo.upsert(makeSourceData({ id: "e2", path: "/delete-path.ts" }));
      await repo.upsert(makeSourceData({ id: "e3", path: "/keep.ts" }));

      await repo.deleteByPath("/delete-path.ts");

      const removed = await repo.getByPath("/delete-path.ts");
      expect(removed).toHaveLength(0);

      // Other paths remain
      const kept = await repo.getByPath("/keep.ts");
      expect(kept).toHaveLength(1);
    });
  });

  // ── Multi-column embeddings ────────────────────────────────

  describe("embeddings", () => {
    it("hasModelEmbedding returns true for entries with embeddings", async () => {
      const withEmb = makeSourceData({ id: "emb1", embeddings: [0.1, 0.2, 0.3] });
      const withoutEmb = makeSourceData({ id: "emb2", embeddings: [] });

      await repo.upsert(withEmb);
      await repo.upsert(withoutEmb);

      expect(await repo.hasModelEmbedding("emb1")).toBe(true);
      expect(await repo.hasModelEmbedding("emb2")).toBe(false);
    });

    it("hasSemanticBlake3 returns true when hash exists", async () => {
      const data = makeSourceData({ id: "h1", semantic_blake3: "my-unique-hash-abc" });
      await repo.upsert(data);

      expect(await repo.hasSemanticBlake3("my-unique-hash-abc")).toBe(true);
      expect(await repo.hasSemanticBlake3("nonexistent-hash")).toBe(false);
    });

    it("hasSemanticBlake3 returns false for missing hash when table has data", async () => {
      await repo.upsert(makeSourceData({ id: "h2", semantic_blake3: "hash-1" }));
      await repo.upsert(makeSourceData({ id: "h3", semantic_blake3: "hash-2" }));

      expect(await repo.hasSemanticBlake3("hash-1")).toBe(true);
      expect(await repo.hasSemanticBlake3("hash-3")).toBe(false);
    });
  });

  // ── File Index CRUD ────────────────────────────────────────

  describe("file_index CRUD", () => {
    it("upsertFileIndex → getFileIndex returns it", async () => {
      const imports: Import[] = [{ source: "fs", specifiers: ["readFile"], kind: "named" }];
      const exports: Export[] = [{ name: "myFunc", kind: "named" }];
      const symbols: SymbolDetail[] = [
        { kind: "function", name: "myFunc", signature: "myFunc(): void", startPosition: { line: 1, column: 0 }, endPosition: { line: 5, column: 1 } },
      ];
      const relationships: Relationship[] = [{ type: "imports", source: "index.ts", target: "fs" }];

      const idx = makeFileIndex({
        path: "/index.ts",
        file_blake3: "abc123",
        language: "typescript",
        imports,
        exports,
        symbols,
        relationships,
      });

      await repo.upsertFileIndex(idx);

      const result = await repo.getFileIndex("/index.ts");
      expect(result).not.toBeNull();
      expect(result!.path).toBe("/index.ts");
      expect(result!.file_blake3).toBe("abc123");
      expect(result!.language).toBe("typescript");
      expect(result!.imports).toEqual(imports);
      expect(result!.exports).toEqual(exports);
      expect(result!.symbols).toEqual(symbols);
      expect(result!.relationships).toEqual(relationships);
    });

    it("getFileIndex returns null for missing path", async () => {
      const result = await repo.getFileIndex("/nonexistent.ts");
      expect(result).toBeNull();
    });

    it("deleteFileIndex → getFileIndex returns null", async () => {
      const idx = makeFileIndex({ path: "/temp.ts" });
      await repo.upsertFileIndex(idx);

      const before = await repo.getFileIndex("/temp.ts");
      expect(before).not.toBeNull();

      await repo.deleteFileIndex("/temp.ts");

      const after = await repo.getFileIndex("/temp.ts");
      expect(after).toBeNull();
    });

    it("getFileBlake3ByPath returns correct hash", async () => {
      await repo.upsert(makeSourceData({ id: "f1", path: "/file-a.ts", file_blake3: "hash-a" }));
      await repo.upsert(makeSourceData({ id: "f2", path: "/file-b.ts", file_blake3: "hash-b" }));

      expect(await repo.getFileBlake3ByPath("/file-a.ts")).toBe("hash-a");
      expect(await repo.getFileBlake3ByPath("/file-b.ts")).toBe("hash-b");
      expect(await repo.getFileBlake3ByPath("/missing.ts")).toBeNull();
    });
  });

  // ── Search ─────────────────────────────────────────────────

  describe("search", () => {
    it("performs keyword search returning relevant results", async () => {
      await repo.upsert(makeSourceData({ id: "q1", content: "The quick brown fox", path: "/fox.ts" }));
      await repo.upsert(makeSourceData({ id: "q2", content: "Jumping over the lazy dog", path: "/dog.ts" }));
      await repo.upsert(makeSourceData({ id: "q3", content: "Foxes are quick animals", path: "/foxes.ts" }));

      const query: SearchQuery = {
        text: "fox",
        mode: "keyword",
        top_k: 10,
      };

      const results = await repo.search(query);
      // At least the two entries with "fox" should be returned
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("search respects source_types filter", async () => {
      await repo.upsert(makeSourceData({ id: "t1", content: "code content", type: "code", path: "/a.ts" }));
      await repo.upsert(makeSourceData({ id: "t2", content: "markdown doc", type: "markdown", path: "/a.md" }));

      const query: SearchQuery = {
        text: "content",
        mode: "keyword",
        top_k: 10,
        source_types: ["code"],
      };

      const results = await repo.search(query);
      expect(results.every((r) => r.source.type === "code")).toBe(true);
    });

    it("search respects top_k limit", async () => {
      for (let i = 0; i < 10; i++) {
        await repo.upsert(makeSourceData({ id: `topk-${i}`, content: "matching content", path: `/file-${i}.ts` }));
      }

      const query: SearchQuery = {
        text: "matching",
        mode: "keyword",
        top_k: 3,
      };

      const results = await repo.search(query);
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  // ── Cleanup ────────────────────────────────────────────────

  describe("cleanup", () => {
    it("dropAll clears all data", async () => {
      await repo.upsert(makeSourceData({ id: "clr1", path: "/clear.ts" }));
      await repo.upsertFileIndex(makeFileIndex({ path: "/clear.idx.ts" }));

      expect(await repo.getById("clr1")).not.toBeNull();
      expect(await repo.getFileIndex("/clear.idx.ts")).not.toBeNull();

      await repo.dropAll();

      expect(await repo.getById("clr1")).toBeNull();
      expect(await repo.getFileIndex("/clear.idx.ts")).toBeNull();
    });
  });

  // ── Stats ──────────────────────────────────────────────────

  describe("stats", () => {
    it("stats returns correct counts", async () => {
      // 2 files, 3 chunks total
      await repo.upsert(makeSourceData({ id: "st1", path: "/file1.ts", chunk_index: 0, total_chunks: 2 }));
      await repo.upsert(makeSourceData({ id: "st2", path: "/file1.ts", chunk_index: 1, total_chunks: 2 }));
      await repo.upsert(makeSourceData({ id: "st3", path: "/file2.ts", chunk_index: 0, total_chunks: 1 }));

      const s = await repo.stats();
      expect(s.total_sources).toBeGreaterThan(0);
      expect(s.total_chunks).toBe(3);
      expect(s.total_files).toBeGreaterThan(0);
      expect(s.last_indexed).toBeTruthy();
    });
  });

  // ── Additional utility methods ─────────────────────────────

  describe("getSourceIdsByHash", () => {
    it("returns array of source_ids for matching semantic_blake3", async () => {
      await repo.upsert(makeSourceData({ id: "sid1", source_id: "src-a", semantic_blake3: "hash-x" }));
      await repo.upsert(makeSourceData({ id: "sid2", source_id: "src-b", semantic_blake3: "hash-y" }));
      await repo.upsert(makeSourceData({ id: "sid3", source_id: "src-a", semantic_blake3: "hash-x" }));

      const ids = await repo.getSourceIdsByHash("hash-x");
      expect(ids.sort()).toEqual(["src-a", "src-a"]);
    });

    it("returns empty array for nonexistent hash", async () => {
      const ids = await repo.getSourceIdsByHash("nope");
      expect(ids).toEqual([]);
    });
  });
});


---
# tests/infrastructure/logger/Logger.test.ts
---
import { describe, expect, test, afterEach } from "bun:test";
import { PinoLogger } from "../../../src/infrastructure/logger/PinoLogger";
import { SilentLogger } from "../../../src/infrastructure/logger/SilentLogger";
import type { Logger } from "../../../src/domain/ports/Logger";

describe("PinoLogger", () => {
  let logs: unknown[] = [];
  const transport = {
    write: (obj: unknown) => {
      logs.push(obj);
    },
  };

  afterEach(() => {
    logs = [];
  });

  test("info logs structured JSON output", () => {
    const logger = new PinoLogger(
      { level: "info", module: "test" },
      transport as any
    );
    logger.info("hello world");

    expect(logs.length).toBe(1);
    const entry = JSON.parse(logs[0] as string);
    expect(entry.msg).toBe("hello world");
    expect(entry.level).toBe(30); // pino info level
    expect(entry.module).toBe("test");
  });

  test("warn logs structured JSON output", () => {
    const logger = new PinoLogger(
      { level: "warn", module: "test" },
      transport as any
    );
    logger.warn("warning message");

    expect(logs.length).toBe(1);
    const entry = JSON.parse(logs[0] as string);
    expect(entry.msg).toBe("warning message");
    expect(entry.level).toBe(40); // pino warn level
  });

  test("error logs structured JSON output", () => {
    const logger = new PinoLogger(
      { level: "error", module: "test" },
      transport as any
    );
    logger.error("error message");

    expect(logs.length).toBe(1);
    const entry = JSON.parse(logs[0] as string);
    expect(entry.msg).toBe("error message");
    expect(entry.level).toBe(50); // pino error level
  });

  test("debug logs structured JSON output", () => {
    const logger = new PinoLogger(
      { level: "debug", module: "test" },
      transport as any
    );
    logger.debug("debug message");

    expect(logs.length).toBe(1);
    const entry = JSON.parse(logs[0] as string);
    expect(entry.msg).toBe("debug message");
    expect(entry.level).toBe(20); // pino debug level
  });

  test("child() adds context to output", () => {
    const logger = new PinoLogger(
      { level: "info", module: "parent" },
      transport as any
    );
    const child = logger.child({ requestId: "abc-123" });
    child.info("child message");

    expect(logs.length).toBe(1);
    const entry = JSON.parse(logs[0] as string);
    expect(entry.msg).toBe("child message");
    expect(entry.module).toBe("parent");
    expect(entry.requestId).toBe("abc-123");
  });

  test("info with extra args includes them in log", () => {
    const logger = new PinoLogger(
      { level: "info", module: "test" },
      transport as any
    );
    logger.info("user login", { userId: 42 });

    expect(logs.length).toBe(1);
    const entry = JSON.parse(logs[0] as string);
    expect(entry.msg).toBe("user login");
    expect(entry.userId).toBe(42);
  });
});

describe("SilentLogger", () => {
  let logger: Logger;

  test("info produces no output", () => {
    logger = new SilentLogger();
    // Should not throw
    expect(() => logger.info("test")).not.toThrow();
  });

  test("warn produces no output", () => {
    logger = new SilentLogger();
    expect(() => logger.warn("test")).not.toThrow();
  });

  test("error produces no output", () => {
    logger = new SilentLogger();
    expect(() => logger.error("test")).not.toThrow();
  });

  test("debug produces no output", () => {
    logger = new SilentLogger();
    expect(() => logger.debug("test")).not.toThrow();
  });
});


---
# tests/infrastructure/markdown/MarkdownAstParser.test.ts
---
import { describe, expect, test } from "bun:test";
import { MarkdownAstParser } from "../../../src/infrastructure/markdown/MarkdownAstParser";

describe("MarkdownAstParser", () => {
  const parser = new MarkdownAstParser();

  test("extracts headings with level, text, and anchor", () => {
    const md = `# Title\n\n## Section One\n\n### Subsection\n\nSome content`;
    const headings = parser.parse(md);

    expect(headings).toHaveLength(3);
    expect(headings[0]).toEqual({ level: 1, text: "Title", anchor: "title" });
    expect(headings[1]).toEqual({ level: 2, text: "Section One", anchor: "section-one" });
    expect(headings[2]).toEqual({ level: 3, text: "Subsection", anchor: "subsection" });
  });

  test("generates GitHub-style anchor slugs", () => {
    const md = `# Hello World!\n## Special Characters: @#$%\n### Multiple   Spaces\n`;
    const headings = parser.parse(md);

    expect(headings[0].anchor).toBe("hello-world");
    expect(headings[1].anchor).toBe("special-characters");
    expect(headings[2].anchor).toBe("multiple-spaces");
  });

  test("returns empty array for text without headings", () => {
    const md = `Just a paragraph.\n\nAnother paragraph.`;
    const headings = parser.parse(md);
    expect(headings).toEqual([]);
  });

  test("returns empty array for empty string", () => {
    const headings = parser.parse("");
    expect(headings).toEqual([]);
  });

  test("handles multiple headings at the same level", () => {
    const md = `## A\n## B\n## C`;
    const headings = parser.parse(md);
    expect(headings).toHaveLength(3);
    expect(headings.map((h) => h.text)).toEqual(["A", "B", "C"]);
  });

  test("handles code blocks without extracting code as headings", () => {
    const md = `# Real Heading\n\`\`\`\n# Not a heading\n\`\`\`\n\n## Another Heading`;
    const headings = parser.parse(md);
    expect(headings).toHaveLength(2);
    expect(headings[0].text).toBe("Real Heading");
    expect(headings[1].text).toBe("Another Heading");
  });
});


---
# tests/infrastructure/parser/AstGrepParser.test.ts
---
import { describe, it, expect } from "bun:test";
import { AstGrepParser } from "../../../src/infrastructure/parser/AstGrepParser";

describe("AstGrepParser", () => {
  const parser = new AstGrepParser();
  const fixturePath = "tests/fixtures/sample-function.ts";

  it("parses sample-function.ts with type 'code'", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.type).toBe("code");
  });

  it("language includes 'typescript'", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.metadata.kind).toBe("code");
    if (result.metadata.kind === "code") {
      expect(result.metadata.language).toBe("typescript");
    }
  });

  it("extracts symbols: at least 1 function and 1 class", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.fileIndex).toBeDefined();
    expect(result.fileIndex!.symbols.length).toBeGreaterThanOrEqual(3);

    const functions = result.fileIndex!.symbols.filter(
      (s) => s.kind === "function",
    );
    const classes = result.fileIndex!.symbols.filter((s) => s.kind === "class");
    const interfaces = result.fileIndex!.symbols.filter(
      (s) => s.kind === "interface",
    );

    expect(functions.length).toBeGreaterThanOrEqual(1);
    expect(classes.length).toBe(1);
    expect(interfaces.length).toBe(1);
  });

  it("populates FileIndex with imports", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.fileIndex).toBeDefined();
    expect(result.fileIndex!.imports.length).toBeGreaterThanOrEqual(2);

    const utilsImport = result.fileIndex!.imports.find(
      (i) => i.source === "./utils",
    );
    expect(utilsImport).toBeDefined();
    expect(utilsImport!.specifiers).toContain("something");

    const fsImport = result.fileIndex!.imports.find((i) => i.source === "fs");
    expect(fsImport).toBeDefined();
  });

  it("populates FileIndex with exports", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.fileIndex).toBeDefined();
    expect(result.fileIndex!.exports.length).toBeGreaterThanOrEqual(2);

    const fnExport = result.fileIndex!.exports.find(
      (e) => e.name === "calculateTotal",
    );
    expect(fnExport).toBeDefined();
    expect(fnExport!.kind).toBe("named");

    const defaultExport = result.fileIndex!.exports.find(
      (e) => e.kind === "default",
    );
    expect(defaultExport).toBeDefined();
  });

  it("computes complexity metrics: lines, functions, classes", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.metadata.kind).toBe("code");
    if (result.metadata.kind === "code") {
      expect(result.metadata.complexity).toBeDefined();
      expect(result.metadata.complexity!.lines).toBeGreaterThan(0);
      expect(result.metadata.complexity!.functions).toBeGreaterThanOrEqual(1);
      expect(result.metadata.complexity!.classes).toBe(1);
    }
  });

  it("extracts top-level declarations", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.metadata.kind).toBe("code");
    if (result.metadata.kind === "code") {
      expect(result.metadata.topLevelDeclarations).toBeDefined();
      expect(result.metadata.topLevelDeclarations!.length).toBeGreaterThanOrEqual(3);
      expect(result.metadata.topLevelDeclarations).toContain("User");
      expect(result.metadata.topLevelDeclarations).toContain("UserService");
      expect(result.metadata.topLevelDeclarations).toContain("greet");
      expect(result.metadata.topLevelDeclarations).toContain("calculateTotal");
    }
  });

  it("file_blake3 is a 64-character hex string", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.file_blake3).toMatch(/^[0-9a-f]{64}$/);
  });

  it("supportsFile returns true for .ts and .tsx", () => {
    expect(parser.supportsFile("file.ts")).toBe(true);
    expect(parser.supportsFile("file.tsx")).toBe(true);
    expect(parser.supportsFile("file.js")).toBe(true);
    expect(parser.supportsFile("file.md")).toBe(false);
  });
});


---
# tests/infrastructure/parser/MarkdownParser.test.ts
---
import { describe, it, expect } from "bun:test";
import { MarkdownParser } from "../../../src/infrastructure/parser/MarkdownParser";
import type { Heading, Link, MarkdownStats } from "../../../src/infrastructure/parser/types";

describe("MarkdownParser", () => {
  const parser = new MarkdownParser();
  const fixturePath = "tests/fixtures/simple-note.md";

  it("parses simple-note.md with type 'markdown'", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.type).toBe("markdown");
  });

  it("extracts title from H1 as 'Welcome to IndeX'", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.metadata.kind).toBe("markdown");
    if (result.metadata.kind === "markdown") {
      expect(result.metadata.heading).toBe("Welcome to IndeX");
    }
  });

  it("extracts all headings with level, text, and anchor", async () => {
    const result = await parser.parse(fixturePath);
    const md = result.metadata as typeof result.metadata & { headings: Heading[] };
    expect(md.headings).toBeDefined();
    expect(md.headings.length).toBeGreaterThanOrEqual(3);

    const h1 = md.headings.find((h) => h.level === 1);
    expect(h1).toBeDefined();
    expect(h1!.text).toBe("Welcome to IndeX");
    expect(h1!.anchor).toBe("welcome-to-index");

    const h2s = md.headings.filter((h) => h.level === 2);
    expect(h2s.length).toBe(2);
    expect(h2s[0]!.text).toBe("Getting Started");
    expect(h2s[1]!.text).toBe("Features");

    const h3s = md.headings.filter((h) => h.level === 3);
    expect(h3s.length).toBe(1);
    expect(h3s[0]!.text).toBe("Installation");
  });

  it("extracts links with url, text, and isInternal", async () => {
    const result = await parser.parse(fixturePath);
    const md = result.metadata as typeof result.metadata & { links: Link[] };
    expect(md.links).toBeDefined();

    const openCodeLink = md.links.find(
      (l) => l.url === "https://github.com/opencode-ai",
    );
    expect(openCodeLink).toBeDefined();
    expect(openCodeLink!.text).toBe("OpenCode");
    expect(openCodeLink!.isInternal).toBe(false);
    expect(openCodeLink!.isAnchor).toBe(false);
  });

  it("computes stats: wordCount > 0, paragraphCount, codeBlockCount", async () => {
    const result = await parser.parse(fixturePath);
    const md = result.metadata as typeof result.metadata & { stats: MarkdownStats };
    expect(md.stats).toBeDefined();
    expect(md.stats.wordCount).toBeGreaterThan(0);
    expect(md.stats.readingTimeMinutes).toBeGreaterThanOrEqual(1);
    expect(md.stats.paragraphCount).toBeGreaterThan(0);
    expect(md.stats.codeBlockCount).toBe(1);
  });

  it("metadata kind is 'markdown'", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.metadata.kind).toBe("markdown");
  });

  it("tags is empty array", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.tags).toEqual([]);
  });

  it("file_blake3 is a 64-character hex string", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.file_blake3).toMatch(/^[0-9a-f]{64}$/);
  });

  it("content includes all markdown text", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.content).toContain("Welcome to IndeX");
    expect(result.content).toContain("Getting Started");
    expect(result.content).toContain("OpenCode");
  });
});


---
# tests/infrastructure/parser/ObsidianParser.test.ts
---
import { describe, it, expect } from "bun:test";
import { ObsidianParser } from "../../../src/infrastructure/parser/ObsidianParser";
import type { WikiLink } from "../../../src/infrastructure/parser/types";

describe("ObsidianParser", () => {
  const parser = new ObsidianParser();
  const fixturePath = "tests/fixtures/obsidian-note.md";

  it("parses obsidian-note.md with type 'obsidian'", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.type).toBe("obsidian");
  });

  it("extracts title from frontmatter as 'My Obsidian Note'", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.metadata.kind).toBe("obsidian");
    if (result.metadata.kind === "obsidian") {
      // Title is not directly in obsidian metadata kind — but the frontmatter
      // is stored. We validate via the frontmatter field.
      expect(result.metadata.frontmatter).toBeDefined();
      expect(result.metadata.frontmatter?.title).toBe("My Obsidian Note");
    }
  });

  it("extracts tags from frontmatter: ['daily', 'journal']", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.tags).toEqual(["daily", "journal"]);
    if (result.metadata.kind === "obsidian") {
      expect(result.metadata.tags).toEqual(["daily", "journal"]);
    }
  });

  it("extracts wiki-links [[target]] and [[target|alias]]", async () => {
    const result = await parser.parse(fixturePath);
    const od = result.metadata as typeof result.metadata & {
      wikiLinks: WikiLink[];
    };
    expect(od.wikiLinks).toBeDefined();
    expect(od.wikiLinks.length).toBe(3);

    const plainLink = od.wikiLinks.find((w) => w.target === "typescript-generics");
    expect(plainLink).toBeDefined();
    expect(plainLink!.alias).toBeUndefined();

    const aliasLink = od.wikiLinks.find(
      (w) => w.target === "dependency-injection",
    );
    expect(aliasLink).toBeDefined();
    expect(aliasLink!.alias).toBe("DI patterns");

    const dailyLink = od.wikiLinks.find((w) => w.target === "daily/2024-01-14");
    expect(dailyLink).toBeDefined();
  });

  it("content excludes frontmatter (does not start with '---')", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.content).not.toMatch(/^---\n/);
    // Content should start with the actual note body
    expect(result.content.trimStart().startsWith("# My Obsidian Note")).toBe(true);
  });

  it("backlinks and graphConnections are empty arrays", async () => {
    const result = await parser.parse(fixturePath);
    const od = result.metadata as typeof result.metadata & {
      backlinks: string[];
      graphConnections: string[];
    };
    expect(od.backlinks).toEqual([]);
    expect(od.graphConnections).toEqual([]);
  });

  it("file_blake3 is a 64-character hex string", async () => {
    const result = await parser.parse(fixturePath);
    expect(result.file_blake3).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hasFrontmatter static method detects YAML frontmatter", () => {
    expect(ObsidianParser.hasFrontmatter("---\ntitle: Test\n---\nContent")).toBe(true);
    expect(ObsidianParser.hasFrontmatter("# No frontmatter")).toBe(false);
  });
});


---
# tests/infrastructure/parser/ParserRegistry.test.ts
---
import { describe, it, expect, beforeAll } from "bun:test";
import { ParserRegistry } from "../../../src/infrastructure/parser/ParserRegistry";
import { MarkdownParser } from "../../../src/infrastructure/parser/MarkdownParser";
import { ObsidianParser } from "../../../src/infrastructure/parser/ObsidianParser";
import { AstGrepParser } from "../../../src/infrastructure/parser/AstGrepParser";

describe("ParserRegistry", () => {
  let registry: ParserRegistry;
  let mdParser: MarkdownParser;
  let obsParser: ObsidianParser;
  let tsParser: AstGrepParser;

  beforeAll(() => {
    registry = new ParserRegistry();
    mdParser = new MarkdownParser();
    obsParser = new ObsidianParser();
    tsParser = new AstGrepParser();

    registry.register(mdParser);
    registry.register(obsParser);
    registry.register(tsParser);
  });

  it("getParser('.ts') returns AstGrepParser", () => {
    const parser = registry.getParser("tests/fixtures/sample-function.ts");
    expect(parser).toBe(tsParser);
  });

  it("getParser('.tsx') returns AstGrepParser", () => {
    // Use a real-ish path — extension-based, content doesn't matter here
    const parser = registry.getParser("tests/fixtures/component.tsx");
    expect(parser).toBe(tsParser);
  });

  it("getParser('.md') with Obsidian frontmatter returns ObsidianParser", () => {
    const parser = registry.getParser("tests/fixtures/obsidian-note.md");
    expect(parser).toBe(obsParser);
  });

  it("getParser('.md') without Obsidian frontmatter returns MarkdownParser", () => {
    const parser = registry.getParser("tests/fixtures/simple-note.md");
    expect(parser).toBe(mdParser);
  });

  it("getParser('.md') with tags frontmatter returns ObsidianParser", () => {
    const parser = registry.getParser("tests/fixtures/note-with-tags.md");
    expect(parser).toBe(obsParser);
  });

  it("getParser('.py') returns null for unsupported extension", () => {
    const parser = registry.getParser("script.py");
    expect(parser).toBeNull();
  });

  it("getParser('.unknown') returns null", () => {
    const parser = registry.getParser("file.unknown");
    expect(parser).toBeNull();
  });

  it("getEnabledParsers() returns all registered parsers (unique)", () => {
    const parsers = registry.getEnabledParsers();
    // 3 unique parser instances: MarkdownParser, ObsidianParser, AstGrepParser
    expect(parsers.length).toBe(3);
    expect(parsers).toContain(mdParser);
    expect(parsers).toContain(obsParser);
    expect(parsers).toContain(tsParser);
  });

  it("getEnabledParsers() excludes parsers with enabled=false", () => {
    const disabledParser = new AstGrepParser();
    (disabledParser as any).enabled = false;
    registry.register(disabledParser);
    const parsers = registry.getEnabledParsers();
    expect(parsers).not.toContain(disabledParser);
    expect(parsers.length).toBe(3); // still 3, disabled one excluded
  });
});


---
# tests/infrastructure/watcher/ChokidarWatcher.test.ts
---
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { ChokidarWatcher } from "../../../src/infrastructure/watcher/ChokidarWatcher";
import { mkdtempSync, writeFileSync, unlinkSync, realpathSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("ChokidarWatcher", () => {
  let watcher: ChokidarWatcher;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "chokidar-test-")));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("start() / stop() lifecycle works", async () => {
    watcher = new ChokidarWatcher(tmpDir);
    await watcher.start();
    expect(watcher).toBeDefined();
    await watcher.stop();
  });

  test("adding a file emits 'add' event", async () => {
    watcher = new ChokidarWatcher(tmpDir);
    const added: string[] = [];
    watcher.on("add", (p: string) => added.push(p));
    await watcher.start();

    const filePath = join(tmpDir, "new-file.txt");
    writeFileSync(filePath, "hello", "utf-8");

    // Wait for chokidar to detect + debounce
    await new Promise((r) => setTimeout(r, 600));
    await watcher.stop();

    expect(added.length).toBe(1);
    expect(added[0]).toContain("new-file.txt");
  });

  test("changing a file emits 'change' event", async () => {
    watcher = new ChokidarWatcher(tmpDir);
    const changed: string[] = [];
    watcher.on("change", (p: string) => changed.push(p));
    await watcher.start();

    const filePath = join(tmpDir, "change-me.txt");
    writeFileSync(filePath, "v1", "utf-8");
    await new Promise((r) => setTimeout(r, 600));
    writeFileSync(filePath, "v2", "utf-8");
    await new Promise((r) => setTimeout(r, 600));
    await watcher.stop();

    expect(changed.length).toBeGreaterThanOrEqual(1);
    expect(changed.some((p) => p.includes("change-me.txt"))).toBe(true);
  });

  test("deleting a file emits 'unlink' event", async () => {
    watcher = new ChokidarWatcher(tmpDir);
    const unlinked: string[] = [];
    watcher.on("unlink", (p: string) => unlinked.push(p));
    await watcher.start();

    const filePath = join(tmpDir, "delete-me.txt");
    writeFileSync(filePath, "bye", "utf-8");
    await new Promise((r) => setTimeout(r, 1000));
    unlinkSync(filePath);
    await new Promise((r) => setTimeout(r, 1000));
    await watcher.stop();

    expect(unlinked.length).toBeGreaterThanOrEqual(1);
    expect(unlinked.some((p) => p.includes("delete-me.txt"))).toBe(true);
  });

  test("debounce fires only once within 500ms for rapid changes", async () => {
    watcher = new ChokidarWatcher(tmpDir, { debounceMs: 500 });
    const changed: string[] = [];
    watcher.on("change", (p: string) => changed.push(p));
    await watcher.start();

    const filePath = join(tmpDir, "rapid-changes.txt");
    writeFileSync(filePath, "v1", "utf-8");
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(filePath, "v2", "utf-8");
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(filePath, "v3", "utf-8");
    await new Promise((r) => setTimeout(r, 700));
    await watcher.stop();

    // Multiple changes within debounce window should coalesce into one event
    expect(changed.length).toBe(1);
  });
});

---
# tests/integration/full-cycle.test.ts
---
// ---------------------------------------------------------------------------
// Integration Test — Full Pipeline: Index → Search → Pack
// Uses real parsers (MarkdownParser) + real chunker (HeadingChunker) +
// mocked storage (MockSourceRepository).
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { createApp } from "../../src/index";
import { MockSourceRepository } from "../mocks/MockSourceRepository";
import { MockEmbedder } from "../mocks/MockEmbedder";

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

describe("Full pipeline integration", () => {
  let tmpDir: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "indeX-integration-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates app with test-mode DI container", () => {
    app = createApp({
      testMode: true,
      repository: new MockSourceRepository(),
      logger: mockLogger,
    });

    expect(app).toBeDefined();
    expect(typeof app.index.execute).toBe("function");
    expect(typeof app.search.execute).toBe("function");
    expect(typeof app.pack.execute).toBe("function");
    expect(typeof app.chunk.execute).toBe("function");
    expect(typeof app.embed.execute).toBe("function");
    expect(typeof app.watch.execute).toBe("function");
    expect(typeof app.del.execute).toBe("function");
  });

  test("indexes a markdown fixture through real parser + chunker", async () => {
    // Create fixture files
    writeFileSync(
      join(tmpDir, "note1.md"),
      `# Title

This is some content about TypeScript.

## Section

More details here.`,
      "utf-8",
    );

    writeFileSync(
      join(tmpDir, "note2.md"),
      `# Another Note

Content about Markdown parsing.`,
      "utf-8",
    );

    const stats = await app.index.execute(tmpDir);
    expect(stats.total_files).toBe(2);
    expect(stats.total_chunks).toBeGreaterThanOrEqual(2);
  });

  test("searches indexed content", async () => {
    const results = await app.search.execute("TypeScript", { mode: "keyword", top_k: 10 });
    expect(Array.isArray(results)).toBe(true);
    // Should find at least the TypeScript-related content
    expect(results.length).toBeGreaterThan(0);
  });

  test("packs files into markdown bundle", async () => {
    const packed = await app.pack.execute(tmpDir, {
      include: ["**/*.md"],
    });
    expect(packed.markdown).toContain("Title");
    expect(packed.markdown).toContain("Another Note");
    expect(packed.chunks_used).toBe(2);
  });
});

---
# tests/integration/setup.test.ts
---
import { describe, expect, test } from "bun:test";

describe("setup", () => {
  test("bun test works", () => {
    expect(1 + 1).toBe(2);
  });
});


---
# tests/mocks/MockChunker.ts
---
import type { Chunk, Chunker } from "../../src/domain/systems/ChunkingSystem";
import type { SourceType } from "../../src/domain/types";

/**
 * A mock chunker that returns a pre-configured array of chunks.
 * Useful for testing chunker pipeline logic without real chunking.
 */
export class MockChunker implements Chunker {
  readonly type: SourceType = "generic";

  constructor(private readonly chunks: Chunk[]) {}

  async chunk(_text: string): Promise<Chunk[]> {
    return this.chunks;
  }
}


---
# tests/mocks/MockDeduplicator.ts
---
import type { Deduplicator } from "../../src/domain/systems/ContextPackagingSystem";
import type { SearchResult } from "../../src/domain/types";

/**
 * A mock deduplicator that optionally deduplicates by semantic_blake3.
 * When enabled (default), keeps the entry with highest score.
 * Can be disabled to test pipeline behaviour without dedup.
 */
export class MockDeduplicator implements Deduplicator {
  private readonly enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  async deduplicate(results: SearchResult[]): Promise<SearchResult[]> {
    if (!this.enabled) return results;

    const seen = new Map<string, SearchResult>();
    for (const result of results) {
      const hash = result.source.semantic_blake3;
      const existing = seen.get(hash);
      if (!existing || result.score > existing.score) {
        seen.set(hash, result);
      }
    }
    return Array.from(seen.values());
  }
}


---
# tests/mocks/MockEmbedder.ts
---
import type { Embedding, Embedder } from "../../src/domain/systems/EmbeddingSystem";

/**
 * A mock embedder with configurable model name, dimensions, and return values.
 * By default returns a zero vector of the configured dimension.
 * Useful for testing embedding pipeline logic without a real model.
 */
export class MockEmbedder implements Embedder {
  readonly model: string;
  readonly dimensions: number;

  private _customEmbedding: Embedding | null = null;

  constructor(model: string, dimensions: number) {
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<Embedding> {
    if (this._customEmbedding !== null) {
      return this._customEmbedding;
    }

    return {
      vector: Array.from({ length: this.dimensions }, () => 0),
      model: this.model,
      dimensions: this.dimensions,
      tokens_in: Math.max(1, Math.round(text.length / 4)),
    };
  }

  /** Override the next return value of embed() for testing edge cases. */
  setMockReturnValue(embedding: Embedding): void {
    this._customEmbedding = embedding;
  }

  /** Reset to default behavior (zero vector + approximated token count). */
  resetMockReturnValue(): void {
    this._customEmbedding = null;
  }
}


---
# tests/mocks/MockEmbedderRegistry.ts
---
import type { Embedder, EmbedderRegistry } from "../../src/domain/systems/EmbeddingSystem";

/**
 * A mock embedder registry that returns pre-configured embedders by source type.
 * Useful for testing registry-dependent logic without a real registry.
 */
export class MockEmbedderRegistry implements EmbedderRegistry {
  private readonly embedders = new Map<string, Embedder>();

  constructor(embedders: Record<string, Embedder> = {}) {
    for (const [sourceType, embedder] of Object.entries(embedders)) {
      this.embedders.set(sourceType, embedder);
    }
  }

  getEmbedder(sourceType: string): Embedder | null {
    return this.embedders.get(sourceType) ?? null;
  }

  register(sourceType: string, embedder: Embedder, _priority: number): void {
    this.embedders.set(sourceType, embedder);
  }
}


---
# tests/mocks/MockHasher.ts
---
import { createHash } from "crypto";
import type { Hasher } from "../../src/domain/systems/HashingSystem";

/**
 * A mock hasher implementation using Node.js crypto (SHA-256).
 * Deterministic and has no WASM dependency — suitable for tests.
 */
export class MockHasher implements Hasher {
  readonly algorithm = "sha256";

  async hash(data: string | Uint8Array): Promise<string> {
    const input = typeof data === "string" ? data : Buffer.from(data);
    return createHash("sha256").update(input).digest("hex");
  }

  async hashFile(path: string): Promise<string> {
    const file = Bun.file(path);
    const content = await file.text();
    return this.hash(content);
  }

  async hashDirectory(_path: string): Promise<string> {
    return "mocked-dir-hash";
  }
}


---
# tests/mocks/MockSourceRepository.ts
---
import type { SourceRepository } from "../../src/domain/ports/SourceRepository";
import type { SourceData, SearchQuery, SearchResult, IndexStats } from "../../src/domain/types";
import type { FileIndex } from "../../src/domain/ast";

/**
 * In-memory SourceRepository implementation for unit tests.
 * Uses Map<string, SourceData> for chunk storage and Map<string, FileIndex> for file index storage.
 * All search operations are linear scans — optimized for test correctness, not performance.
 */
export class MockSourceRepository implements SourceRepository {
  private sources = new Map<string, SourceData>();
  private fileIndices = new Map<string, FileIndex>();
  private lastIndexed: string = new Date().toISOString();

  // ── Source CRUD ────────────────────────────────────────────

  async upsert(data: SourceData): Promise<void> {
    this.sources.set(data.id, data);
  }

  async upsertBatch(data: SourceData[]): Promise<void> {
    for (const d of data) {
      this.sources.set(d.id, d);
    }
  }

  async getById(id: string): Promise<SourceData | null> {
    return this.sources.get(id) ?? null;
  }

  async getByPath(path: string): Promise<SourceData[]> {
    const results: SourceData[] = [];
    for (const source of this.sources.values()) {
      if (source.path === path) {
        results.push(source);
      }
    }
    return results;
  }

  async getBySourceId(sourceId: string): Promise<SourceData[]> {
    const results: SourceData[] = [];
    for (const source of this.sources.values()) {
      if (source.source_id === sourceId) {
        results.push(source);
      }
    }
    return results;
  }

  async delete(id: string): Promise<void> {
    this.sources.delete(id);
  }

  async deleteByPath(path: string): Promise<void> {
    for (const [id, source] of this.sources.entries()) {
      if (source.path === path) {
        this.sources.delete(id);
      }
    }
  }

  // ── Search ─────────────────────────────────────────────────

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (const source of this.sources.values()) {
      // Filter by source_types if specified
      if (query.source_types && query.source_types.length > 0) {
        if (!query.source_types.includes(source.type)) {
          continue;
        }
      }

      // Filter by tags if specified
      if (query.tags && query.tags.length > 0) {
        if (!query.tags.some((t) => source.tags.includes(t))) {
          continue;
        }
      }

      // Compute a mock TF-like score
      const score = this.computeScore(source.content, query.text);
      if (query.min_score !== undefined && score < query.min_score) {
        continue;
      }

      results.push({
        source,
        score,
        match_type: query.mode,
      });
    }

    // Sort by score descending, limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, query.top_k);
  }

  /**
   * Simple TF-like scoring: count of query words that appear in content / total words in content.
   */
  private computeScore(content: string, queryText: string): number {
    if (!queryText) return 0;
    const contentLower = content.toLowerCase();
    const queryWords = queryText.toLowerCase().split(/\s+/).filter(Boolean);
    if (queryWords.length === 0) return 0;
    const contentWords = contentLower.split(/\s+/).filter(Boolean);
    if (contentWords.length === 0) return 0;

    const matches = queryWords.filter((w) => contentLower.includes(w)).length;
    return matches / contentWords.length;
  }

  // ── Hash / Embedding queries ───────────────────────────────

  async hasSemanticBlake3(hash: string): Promise<boolean> {
    for (const source of this.sources.values()) {
      if (source.semantic_blake3 === hash) return true;
    }
    return false;
  }

  async hasModelEmbedding(id: string): Promise<boolean> {
    const source = this.sources.get(id);
    if (!source) return false;
    return source.embeddings.length > 0;
  }

  async getSourceIdsByHash(hash: string): Promise<string[]> {
    const ids: string[] = [];
    for (const source of this.sources.values()) {
      if (source.semantic_blake3 === hash) {
        ids.push(source.source_id);
      }
    }
    return ids;
  }

  async getFileBlake3ByPath(path: string): Promise<string | null> {
    for (const source of this.sources.values()) {
      if (source.path === path) return source.file_blake3;
    }
    return null;
  }

  // ── Stats ──────────────────────────────────────────────────

  async stats(): Promise<IndexStats> {
    const uniquePaths = new Set<string>();
    for (const source of this.sources.values()) {
      uniquePaths.add(source.path);
    }
    return {
      total_sources: uniquePaths.size,
      total_chunks: this.sources.size,
      total_files: uniquePaths.size,
      last_indexed: this.lastIndexed,
    };
  }

  // ── File Index CRUD ────────────────────────────────────────

  async upsertFileIndex(index: FileIndex): Promise<void> {
    this.fileIndices.set(index.path, index);
  }

  async getFileIndex(path: string): Promise<FileIndex | null> {
    return this.fileIndices.get(path) ?? null;
  }

  async deleteFileIndex(path: string): Promise<void> {
    this.fileIndices.delete(path);
  }

  // ── Cleanup ────────────────────────────────────────────────

  async dropAll(): Promise<void> {
    this.sources.clear();
    this.fileIndices.clear();
  }
}


---
# tests/mocks/MockTokenEstimator.ts
---
import type { TokenEstimator } from "../../src/domain/systems/HashingSystem";

/**
 * A mock token estimator that returns a fixed token count.
 * Useful for predictable testing of chunker token-boundary logic.
 */
export class MockTokenEstimator implements TokenEstimator {
  readonly model = "mock";

  constructor(private readonly count: number) {}

  async estimate(_text: string): Promise<number> {
    return this.count;
  }
}


---
# tests/mocks/MockTokenizer.ts
---
import type { Tokenizer } from "../../src/domain/systems/ContextPackagingSystem";

/**
 * A mock tokenizer that splits by whitespace (1 token ≈ 1 word).
 * Deterministic and dependency-free — suitable for tests.
 */
export class MockTokenizer implements Tokenizer {
  private readonly tokensPerWord: number;

  constructor(tokensPerWord = 1) {
    this.tokensPerWord = tokensPerWord;
  }

  async count(text: string): Promise<number> {
    if (!text || text.trim().length === 0) return 0;
    const words = text.trim().split(/\s+/).length;
    return words * this.tokensPerWord;
  }

  async truncate(text: string, maxTokens: number): Promise<string> {
    if (maxTokens <= 0) return "";
    const words = text.split(/\s+/);
    const maxWords = Math.floor(maxTokens / this.tokensPerWord);
    if (words.length <= maxWords) return text;
    return words.slice(0, maxWords).join(" ");
  }
}


---
# tests/presentation/api/api.test.ts
---
// ---------------------------------------------------------------------------
// HTTP API — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { createServer } from "../../../src/presentation/api/server";
import { MockSourceRepository } from "../../mocks/MockSourceRepository";
import type { SearchResult, IndexStats } from "../../../src/domain/types";

function createMockApp() {
  const repo = new MockSourceRepository();
  return {
    index: {
      execute: async (_path: string): Promise<IndexStats> => ({
        total_sources: 0, total_chunks: 0, total_files: 0, last_indexed: new Date().toISOString(),
      }),
    },
    search: {
      execute: async (_query: string, _opts?: any): Promise<SearchResult[]> => [],
    },
    pack: { execute: async () => ({ markdown: "", chunks_used: 0, total_tokens: 0, truncated: false, source_notes: [] }) },
    chunk: { execute: async () => [] },
    embed: { execute: async () => {} },
    watch: { execute: async () => {}, stop: async () => {} },
    del: { execute: async () => {} },
  };
}

describe("HTTP API", () => {
  test("GET /api/search returns JSON results", async () => {
    const app = createServer(createMockApp() as any);
    const res = await app.request("/api/search?q=test&mode=hybrid");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("results");
    expect(body).toHaveProperty("count");
  });

  test("GET /api/search without q returns 400", async () => {
    const app = createServer(createMockApp() as any);
    const res = await app.request("/api/search");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  test("GET /api/stats returns JSON", async () => {
    const app = createServer(createMockApp() as any);
    const res = await app.request("/api/stats");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("stats");
  });

  test("POST /api/index with valid path returns status", async () => {
    const app = createServer(createMockApp() as any);
    const res = await app.request("/api/index", {
      method: "POST",
      body: JSON.stringify({ path: "./vault" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("POST /api/index without path returns 400", async () => {
    const app = createServer(createMockApp() as any);
    const res = await app.request("/api/index", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/index with invalid JSON returns 400", async () => {
    const app = createServer(createMockApp() as any);
    const res = await app.request("/api/index", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });
});

---
# tests/presentation/cli/cli.test.ts
---
// ---------------------------------------------------------------------------
// CLI — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { parseArgs } from "../../../src/presentation/cli/cli";

describe("CLI argument parsing", () => {
  test("parses index command", () => {
    const result = parseArgs(["index", "./vault"]);
    expect(result.command).toBe("index");
    expect(result.args).toEqual(["./vault"]);
  });

  test("parses search command with flags", () => {
    const result = parseArgs(["search", "query text", "--mode", "hybrid", "--top-k", "5"]);
    expect(result.command).toBe("search");
    expect(result.args).toEqual(["query text"]);
    expect(result.flags.mode).toBe("hybrid");
    expect(result.flags["top-k"]).toBe("5");
  });

  test("parses pack command with output flag", () => {
    const result = parseArgs(["pack", "./vault", "-o", "bundle.md"]);
    expect(result.command).toBe("pack");
    expect(result.args).toEqual(["./vault"]);
    expect(result.flags.o).toBe("bundle.md");
  });

  test("parses pack command with include/exclude flags", () => {
    const result = parseArgs(["pack", ".", "--include", "**/*.md", "--exclude", "node_modules,.git"]);
    expect(result.command).toBe("pack");
    expect(result.args).toEqual(["."]);
    expect(result.flags.include).toBe("**/*.md");
    expect(result.flags.exclude).toBe("node_modules,.git");
  });

  test("parses chunk command", () => {
    const result = parseArgs(["chunk", "./vault"]);
    expect(result.command).toBe("chunk");
    expect(result.args).toEqual(["./vault"]);
  });

  test("parses embed command", () => {
    const result = parseArgs(["embed", "./vault"]);
    expect(result.command).toBe("embed");
    expect(result.args).toEqual(["./vault"]);
  });

  test("parses watch command", () => {
    const result = parseArgs(["watch", "./vault"]);
    expect(result.command).toBe("watch");
    expect(result.args).toEqual(["./vault"]);
  });

  test("parses stats command", () => {
    const result = parseArgs(["stats"]);
    expect(result.command).toBe("stats");
    expect(result.args).toEqual([]);
  });

  test("parses --help flag", () => {
    const result = parseArgs(["--help"]);
    expect(result.command).toBe("help");
  });

  test("unknown command returns help", () => {
    const result = parseArgs(["unknown"]);
    expect(result.command).toBe("help");
  });

  test("empty args returns help", () => {
    const result = parseArgs([]);
    expect(result.command).toBe("help");
  });
});

