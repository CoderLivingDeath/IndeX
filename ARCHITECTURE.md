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
