# IndeX

**Индексатор кода и заметок** с гибридным (векторный + ключевой) поиском на LanceDB.

CLI-инструмент, который парсит, чанкует, эмбеддит и индексирует файлы в локальную векторную БД, а затем позволяет искать по ним — семантически, по ключевым словам, или по AST-структуре кода.

---

## Возможности

### ✅ Реализовано

| Возможность | Статус |
|-------------|--------|
| Индексация файлов (TS/JS/Python/C#/JSON/MD) | ✅ Работает |
| Гибридный поиск (векторный + keyword) | ✅ Работает |
| AST-поиск (по структуре кода) | ✅ Работает |
| Чанкование (heading / paragraph / sentence / overflow) | ✅ Работает |
| Контекстная упаковка (JSONL / Markdown) | ✅ Работает |
| Переиспользование эмбеддингов (BLAKE3) | ✅ Работает |
| init — создание конфига | ✅ Работает |
| clear — очистка индекса | ✅ Работает |
| scan — предпросмотр фильтров | ✅ Работает |
| sync — синхронизация индекса с файловой системой | ✅ Работает |
| MCP-сервер для AI-агентов (`indeX mcp`, stdio) | ✅ Работает |
| Watch-демон (фоновое наблюдение) | ✅ Работает |

### 🚧 В разработке

- **Multi-model embeddings** — реестр пока выбирает одну модель на тип источника; одновременное хранение векторов нескольких моделей не реализовано.
- **Compatibility:** `@ast-grep/napi` на Windows может падать при загрузке отдельных языков (см. известные проблемы).

---

## Установка

**Требования:** [Bun](https://bun.sh), [Ollama](https://ollama.com) (для эмбеддингов)

```bash
# Установка зависимостей
bun install

# Сборка в единый exe-файл (опционально)
bun build --compile --target=bun-windows-x64 ./src/presentation/cli/cli.ts --outfile=dist/indeX
```

После сборки `dist/indeX.exe` можно запускать без Bun.

---

## Быстрый старт

```bash
# 1. Создать конфиг
indeX init

# 2. Запустить Ollama (отдельный терминал)
ollama serve

# 3. Проиндексировать проект
indeX embed .

# 4. Найти что-нибудь
indeX search "BLAKE3 hasher" --mode hybrid

# 5. Посмотреть статистику
indeX stats
```

---

## CLI — полный обзор команд

### Сводная таблица

| Команда | Назначение | Загрузка |
|---------|-----------|----------|
| `init` | Создание конфига `.indeX/config.json` | Мгновенно |
| `embed <path>` | Полная индексация (парсинг → чанкинг → эмбеддинг → сохранение) | Lazy ~5s |
| `search <query>` | Поиск по индексу (4 режима) | Lazy ~5s |
| `pack <path>` | Упаковка файлов в JSONL или Markdown | Lazy ~5s |
| `chunk <path>` | Разбивка на чанки (без эмбеддинга) | Lazy ~5s |
| `scan <path>` | Dry-run фильтров включения/исключения | Мгновенно |
| `stats` | Статистика индекса | Lazy ~5s |
| `sync [dir]` | Синхронизация индекса с файловой системой | Lazy ~5s |
| `clear` | Очистка `.indeX/index.lancedb/` | Мгновенно |
| `watch` | Управление watch-демоном (start/stop/status) | Мгновенно |
| `mcp` | Запуск MCP-сервера (stdio) для AI-агентов | Lazy ~5s |

> **Lazy ~5s** — первый запуск грузит нативные модули (LanceDB, ast-grep, chokidar). Последующие вызовы — мгновенно (кэш).

---

### `indeX init`

**Синтаксис:** `indeX init [options]`

**Назначение:** Создаёт `.indeX/config.json` с настройками по умолчанию и опционально скаффолдит AI-агента.

#### Аргументы

Нет обязательных аргументов.

#### Опции

| Опция | Описание | Возможные значения | По умолчанию |
|-------|----------|-------------------|--------------|
| `--path <dir>` | Директория для конфига | Путь к папке | Текущая директория |
| `--agent opencode` | Создать `.opencode/skills/indeX/SKILL.md` | `opencode` | — |
| `--mcp` | Добавить MCP-секцию в `.opencode/opencode.json` | — | — (требует `--agent`) |

#### Примеры

```bash
# Минимальный конфиг
$ indeX init
Created .indeX/config.json

# С навыком для OpenCode
$ indeX init --agent opencode
Created .indeX/config.json
Created .opencode/skills/indeX/SKILL.md

# С навыком + MCP для AI-агента
$ indeX init --agent opencode --mcp
Created .indeX/config.json
Created .opencode/skills/indeX/SKILL.md
Updated MCP config in .opencode/opencode.json

# В указанную директорию
$ indeX init --path /home/user/projects/myapp
Created /home/user/projects/myapp/.indeX/config.json
```

#### Примечания

- Если конфиг уже существует — команда не перезаписывает, выводит `Config already exists`.
- Агентский навык позволяет AI-агентам (OpenCode) автоматически получать доступ к IndeX в новых проектах.
- `--mcp` добавляет MCP-сервер в `opencode.json` для интеграции с AI-агентами (в разработке).

---

### `indeX embed <path>`

**Синтаксис:** `indeX embed <path>`

**Назначение:** Полный цикл индексации: сканирует директорию, парсит все поддерживаемые файлы, разбивает на чанки, генерирует эмбеддинги (через Ollama) и сохраняет в LanceDB.

#### Аргументы

| Аргумент | Описание | Обязательный |
|----------|----------|-------------|
| `<path>` | Путь к директории для индексации | ✅ Да |

#### Опции

Нет опций.

#### Примеры

```bash
# Индексация текущей директории
$ indeX embed .
Indexed 142 files, 1847 chunks (235 reused)

# Индексация конкретного проекта
$ indeX embed /home/user/projects/myapp
Indexed 89 files, 1240 chunks (98 reused)

# Индексация поддиректории
$ indeX embed ./src
Indexed 67 files, 892 chunks (112 reused)
```

#### Примечания

- Поддерживаемые расширения: `.ts`, `.tsx`, `.js`, `.jsx`, `.md`, `.json`, `.cs`, `.py`
- Игнорируемые паттерны (всегда): `node_modules/`, `.git/`, `dist/`, `build/`, `.tmp/`, `.opencode/`, `.venv/`, `__pycache__/`, `target/`, `vendor/`
- Для эмбеддингов требуется запущенный Ollama на `localhost:11434`
- Первый запуск ~5 секунд (загрузка нативных модулей)
- Вывод показывает количество файлов, чанков и переиспользованных эмбеддингов (по BLAKE3). Строки чанков сохраняются для каждого файла — дедупликация касается только вычисления вектора.

---

### `indeX search <query>`

**Синтаксис:** `indeX search <query> [options]`

**Назначение:** Поиск по проиндексированным данным. Поддерживает 4 режима: гибридный, семантический, ключевой и AST.

#### Аргументы

| Аргумент | Описание | Обязательный |
|----------|----------|-------------|
| `<query>` | Поисковый запрос | ✅ Да |

#### Опции

| Опция | Описание | Возможные значения | По умолчанию |
|-------|----------|-------------------|--------------|
| `--mode <mode>` | Режим поиска | `hybrid`, `semantic`, `keyword`, `ast` | `hybrid` |
| `--ast` | Сокращение для `--mode ast` | — | — |
| `--top-k <n>` | Количество результатов | Число (1–1000) | `10` |
| `--tags <tags>` | Фильтр по тегам | Список через запятую | — |
| `--columns <cols>` | Колонки вывода JSON | Список через запятую | Компактный формат |

#### Режимы поиска

| Флаг | Режим | Механизм | Когда использовать |
|------|-------|----------|-------------------|
| `--mode hybrid` | **Гибридный** (по умолчанию) | Векторный (cosine similarity) + ключевой (FTS) с весом `hybrid_weight` | Универсальный поиск |
| `--mode semantic` | **Семантический** | Только векторный поиск по эмбеддингам | Поиск по смыслу, синонимы |
| `--mode keyword` | **Ключевой** | Только полнотекстовый поиск (FTS) | Точное совпадение терминов, имён |
| `--mode ast` | **AST** | Фильтр по AST-метаданным (символы, импорты, экспорты) | Поиск функций, классов, интерфейсов |
| `--ast` | сокращение | То же, что `--mode ast` | Удобный флаг |

#### Колонки вывода (`--columns`)

Без `--columns` — компактный формат (match_type, path, score).

С `--columns` — JSON Lines (один JSON-объект на строку).

| Колонка | Описание | Тип |
|---------|----------|-----|
| `match_type` | Режим, который совпал (`hybrid`, `semantic`, `keyword`, `ast`) | `string` |
| `path` | Путь к исходному файлу | `string` |
| `score` | Оценка релевантности (0–1) | `number` |
| `type` | Тип источника (`code`, `markdown`, `json` и т.д.) | `string` |
| `title` | Заголовок чанка | `string` |
| `content` | Полное текстовое содержимое чанка | `string` |
| `tags` | Теги (из frontmatter для markdown) | `string` |
| `chunk` | Плоские поля `chunk_index` и `total_chunks` | `number` × 2 |
| `blake3` | Плоские поля `file_blake3` и `semantic_blake3` | `string` × 2 |
| `ast` | AST-метаданные (символы, импорты, экспорты); `null` для не-кода | `object|null` |
| `meta` | Полный объект метаданных (`metadata`) | `object` |
| `timestamps` | Плоские поля `created_at` и `updated_at` | `string` × 2 |
| `model_scores` | Оценки по каждой модели (для multi-model) | `object|null` |
| `embedding` | Сырой вектор эмбеддинга | `number[]` |

#### Примеры

```bash
# Простой гибридный поиск (компактный вывод)
$ indeX search "BLAKE3 hasher"
[hybrid] src/infrastructure/hashing/BLAKE3Hasher.ts — score: 0.873
[hybrid] src/domain/services/DiffIndexingService.ts — score: 0.651
[keyword] src/index.ts — score: 0.442

# Семантический поиск (по смыслу)
$ indeX search "how does indexing work" --mode semantic
[semantic] src/domain/services/IndexingService.ts — score: 0.912
[semantic] src/application/IndexUseCase.ts — score: 0.834
[semantic] src/index.ts — score: 0.721

# Ключевой поиск (точное совпадение)
$ indeX search "ChokidarWatcher" --mode keyword
[keyword] src/infrastructure/watcher/ChokidarWatcher.ts — score: 1.000
[keyword] src/index.ts — score: 0.875

# AST-поиск (структура кода)
$ indeX search "class" --ast --top-k 5
[ast] src/domain/services/IndexingService.ts — score: 0.950
[ast] src/application/SearchUseCase.ts — score: 0.920
[ast] src/infrastructure/lancedb/LanceDbSourceRepository.ts — score: 0.910
[ast] src/presentation/mcp/IndeXMcpServer.ts — score: 0.900
[ast] src/watch/WatchDaemon.ts — score: 0.890

# Поиск с кастомными колонками (JSON Lines)
$ indeX search "BLAKE3" --columns path,score,blake3,timestamps
{"path":"src/infrastructure/hashing/BLAKE3Hasher.ts","score":0.873,"blake3":{"file_blake3":"abc123...","semantic_blake3":"def456..."},"timestamps":{"created_at":"2026-06-20T...","updated_at":"2026-06-20T..."}}

# AST-поиск с колонкой ast (показывает символы, импорты, экспорты)
$ indeX search "interface" --ast --columns path,score,ast
{"path":"src/domain/types.ts","score":0.940,"ast":{"symbols":["SearchQuery","Chunk","SourceType"],"imports":[],"exports":["SearchQuery","Chunk","SourceType","SearchResult"]}}

# Поиск с лимитом результатов
$ indeX search "logger" --mode semantic --top-k 3
[semantic] src/infrastructure/logger/PinoLogger.ts — score: 0.951
[semantic] src/infrastructure/logger/SilentLogger.ts — score: 0.870
[semantic] src/domain/ports/Logger.ts — score: 0.812
```

#### Примечания

- Для `--mode ast` требуется, чтобы файлы были проиндексированы с AST-метаданными (всегда так при `embed`).
- Без `--columns` вывод — компактный (match_type, path, score).
- С `--columns` вывод — JSON Lines, удобный для машинной обработки.

---

### `indeX pack <path>`

**Синтаксис:** `indeX pack <path> [options]`

**Назначение:** Упаковывает файлы в структурированный контекст (JSONL или Markdown) для передачи LLM. Вывод всегда идёт в stdout, `-o` дополнительно записывает в файл.

#### Аргументы

| Аргумент | Описание | Обязательный |
|----------|----------|-------------|
| `<path>` | Путь к директории для упаковки | ✅ Да |

#### Опции

| Опция | Описание | Возможные значения | По умолчанию |
|-------|----------|-------------------|--------------|
| `--format <type>` | Формат вывода | `jsonl`, `md` | `jsonl` |
| `-o, --output <file>` | Дополнительно записать в файл | Путь к файлу | — |
| `--include <pattern>` | Включить только файлы по glob | Glob-паттерн (разделитель `,`) | Все поддерживаемые |
| `--exclude <pattern>` | Исключить файлы по glob | Glob-паттерн (разделитель `,`) | — |
| `--meta` | Включить секцию метаданных | — | Включено (по умолчанию) |
| `--ast` | Включить AST-секцию | — | Включено (по умолчанию) |
| `--content` | Включить секцию содержимого | — | Включено (по умолчанию) |
| `--links` | Включить секцию cross-file связей | — | Выключено |

#### Секции

| Флаг | Секция | Содержимое JSONL | Содержимое MD |
|------|--------|-----------------|---------------|
| `--meta` | `metadata` | `type`, `language`, `lines`, `tokens`, `tags`, `path`, `blake3`, `last_parsed` | Блок метаданных |
| `--ast` | `### ast` | `imports` (JSONL), `exports` (JSONL), `symbols`, `complexity` | JSONL-блок |
| `--content` | `### code` / `### content` | Полный текст файла | Фenced `<pre><code>` блок |
| `--links` | `### links` | `source`, `target`, `relationship` | JSONL-блок |

**Правило:** Без флагов секций — `meta + ast + content`. Любой явный флаг переопределяет набор (указывайте только то, что нужно).

#### Форматы

| Флаг | Формат | Структура | Применение |
|------|--------|-----------|------------|
| `--format jsonl` (по умолчанию) | JSON Lines | Один JSON-объект на строку: `{"path":"...","type":"code","content":"..."}` | Машинная обработка, парсинг |
| `--format md` | Markdown | Заголовок + файловый индекс + файлы с секциями | Чтение человеком, контекст для LLM |

#### Примеры

```bash
# JSONL (по умолчанию): meta + ast + content
$ indeX pack .
{"path":"src/index.ts","type":"code","content":"// ...","ast":{...},"meta":{...}}
{"path":"src/domain/types.ts","type":"code","content":"// ...","ast":{...},"meta":{...}}
...

# Markdown: meta + ast + content
$ indeX pack . --format md
# IndeX Pack
> Source: .
> Format: md

## File Index
1. src/index.ts
2. src/domain/types.ts
...

## src/index.ts
### metadata
type: code | language: typescript | lines: 325 | tokens: 2800

### ast
{"imports":["Config","SourceRepository",...],"exports":["createApp","AppUseCases"]}

### code
<pre><code>// ... full content ...

# Markdown → stdout + файл
$ indeX pack . --format md -o bundle.md
# ... stdout ...
Packed 142 files → bundle.md (285000 tokens)

# Только содержимое (JSONL), без meta и ast
$ indeX pack . --content
{"type":"code","path":"src/index.ts","content":"// ..."}
{"type":"code","path":"src/domain/types.ts","content":"// ..."}

# Только meta + ast (без содержимого)
$ indeX pack . --meta --ast
{"path":"src/index.ts","ast":{...},"meta":{...}}

# С фильтрами включения/исключения
$ indeX pack . --include "**/*.ts" --exclude "**/*.test.ts"
{"path":"src/index.ts","type":"code","content":"// ..."}

# Markdown с meta + links (удобно для анализа зависимостей)
$ indeX pack . --format md --meta --links
```

#### Примечания

- Вывод всегда идёт в stdout (полный вывод в терминал).
- `-o` не заменяет stdout, а пишет копию в файл.
- Glob-паттерны используют `*` (не матчит `/`) и `**` (матчит любую вложенность).
- Примеры glob: `**/*.ts` (все TS-файлы), `src/**` (всё в src/), `**/*.{ts,md}` (TS и MD).

---

### `indeX chunk <path>`

**Синтаксис:** `indeX chunk <path>`

**Назначение:** Разбивает файлы на семантические чанки (без эмбеддинга и сохранения в БД). Полезно для предпросмотра стратегий чанкования.

#### Аргументы

| Аргумент | Описание | Обязательный |
|----------|----------|-------------|
| `<path>` | Путь к директории для чанкования | ✅ Да |

#### Опции

Нет опций.

#### Примеры

```bash
$ indeX chunk .
Chunked into 1847 chunks

$ indeX chunk ./src
Chunked into 892 chunks
```

#### Примечания

- Использует стратегии чанкования из конфига (по умолчанию: heading → paragraph → sentence → overflow).
- Не требует Ollama.
- Быстрее `embed`, так как не включает эмбеддинг и запись в БД.

---


#### Примечания

- Поведение идентично `index`. Обе команды существуют для семантической ясности.
- Для эмбеддингов требуется Ollama.

---

### `indeX scan <path>`

**Синтаксис:** `indeX scan <path> [options]`

**Назначение:** Dry-run — предпросмотр, какие файлы попадут под фильтры команд `embed`/`pack`/`chunk`. Без индексации и без загрузки нативных модулей (мгновенно).

#### Аргументы

| Аргумент | Описание | Обязательный |
|----------|----------|-------------|
| `<path>` | Путь к директории для сканирования | ✅ Да |

#### Опции

| Опция | Описание | Возможные значения | По умолчанию |
|-------|----------|-------------------|--------------|
| `--include <pattern>` | Включить только файлы по glob | Glob-паттерн (разделитель `,`) | Все файлы |
| `--exclude <pattern>` | Исключить файлы по glob | Glob-паттерн (разделитель `,`) | — |
| `--config-exclude` | Применить стандартные исключения (node_modules, .git и т.д.) | — | Выключено |
| `--no-default-exclude` | Отключить фильтр по расширениям | — | Выключено (фильтр включён) |
| `--show-all` | Показать каждый файл в каждой группе | — | Выключено (только статистика) |

#### Стандартные исключения (включаются `--config-exclude`):

```
**/node_modules/**  **/.git/**  **/dist/**  **/build/**
**/.tmp/**  **/.opencode/**  **/.indeX/**  **/.venv/**
**/__pycache__/**  **/target/**  **/vendor/**
```

#### Фильтр расширений (по умолчанию):

`.ts`, `.tsx`, `.js`, `.jsx`, `.md`, `.json`, `.cs`

#### Примеры

```bash
# Базовая статистика по всем файлам
$ indeX scan .
Scanned D:\projects\myapp
  Total files found: 2850
  Extension filter: .ts, .tsx, .js, .jsx, .md, .json, .cs
  Indexable files (final): 248 (9%)

Files that WILL be processed (248):
  src/ (67)
  tests/ (34)
  config/ (12)
  docs/ (8)
  ...

# Со стандартными исключениями
$ indeX scan . --config-exclude
Scanned D:\projects\myapp
  Total files found: 2850
  Exclude patterns:
    **/node_modules/**
    **/.git/**
    **/dist/**
    **/build/**
    ...
  After exclude: 523 (18%)
  Extensions (top 15):
    .ts: 142
    .json: 89
    .md: 45
    .js: 12

  Extension filter: .ts, .tsx, .js, .jsx, .md, .json, .cs
  Indexable files (final): 248 (9%)

Files that WILL be processed (248):
  src/ (67)
  tests/ (34)
  ...

# С кастомным include-фильтром
$ indeX scan . --include "**/*.ts"
Scanned D:\projects\myapp
  Total files found: 2850
  Include patterns:
    **/*.ts
  Indexable files (final): 142 (5%)

Files that WILL be processed (142):
  src/ (67)
  tests/ (34)
  ...

# Со всеми файлами (без фильтра расширений)
$ indeX scan . --no-default-exclude
Scanned D:\projects\myapp
  Total files found: 2850
  Extension filter: disabled
  Final (all files): 2850

# Подробный вывод (show-all)
$ indeX scan . --config-exclude --show-all
Scanned D:\projects\myapp
  Total files found: 2850
  Exclude patterns:
    **/node_modules/**
  After exclude: 523 (18%)
  Excluded files:
    node_modules/express/index.js
    node_modules/lodash/core.js
    ...
  Extensions (top 15):
    .ts: 142
  Extension filter: .ts, .tsx, .js, .jsx, .md, .json, .cs
  Indexable files (final): 248 (9%)
  Skipped by extension:
    logo.svg
    style.css
    ...

Files that WILL be processed (248):
  src/ (67)
    index.ts
    cli.ts
    ...
```

#### Примечания

- Мгновенная команда — не требует `loadApp()`.
- Полезна для отладки glob-паттернов перед массовой индексацией.
- Фильтр расширений определяет, какие файлы будут обработаны `embed`/`pack`/`chunk`.

---

### `indeX stats`

**Синтаксис:** `indeX stats`

**Назначение:** Показывает статистику проиндексированных данных.

#### Аргументы

Нет аргументов.

#### Опции

Нет опций.

#### Примеры

```bash
$ indeX stats
Index statistics:
  Files:    142
  Chunks:   1847
  Tokens:   285000
  Reused:   235
  Last indexed: 2026-06-20T20:30:00.000Z

# Пустой индекс
$ indeX stats
Index statistics:
  Files:    0
  Chunks:   0
  Tokens:   0
  Reused:   0
  Last indexed: —
```

#### Поля вывода

| Поле | Описание |
|------|----------|
| `Files` | Количество проиндексированных файлов |
| `Chunks` | Общее количество чанков |
| `Tokens` | Общее количество токенов |
| `Reused` | Количество переиспользованных эмбеддингов (по BLAKE3) |
| `Last indexed` | Время последней индексации |

---

### `indeX sync [dir]`

**Синтаксис:** `indeX sync [dir]`

**Назначение:** Синхронизирует индекс с файловой системой. Удаляет из индекса файлы, которых больше нет на диске (prune), и переиндексирует изменённые/новые файлы. Использует BLAKE3-слепок дерева файлов для быстрого обнаружения изменений.

#### Аргументы

| Аргумент | Описание | Обязательный |
|----------|----------|-------------|
| `[dir]` | Путь к директории (по умолчанию — текущая) | Нет |

#### Опции

Нет опций.

#### Примеры

```bash
# Синхронизация с изменениями
$ indeX sync /home/user/projects/myapp
Sync complete: 3 deleted, 12 indexed, 0 skipped, 0 errors

# Без изменений
$ indeX sync /home/user/projects/myapp
Tree snapshot unchanged — index is up to date.

# Текущая директория
$ indeX sync
Tree snapshot unchanged — index is up to date.
```

#### Поля вывода (при изменениях)

| Поле | Описание |
|------|----------|
| `deleted` | Количество файлов, удалённых из индекса (нет на диске) |
| `indexed` | Количество новых/изменённых файлов |
| `skipped` | Количество пропущенных файлов |
| `errors` | Количество ошибок при обработке |

#### Примечания

- Полезно после ручного удаления/переименования файлов.
- Быстрее полной переиндексации, так как использует diff.
- BLAKE3-слепок — хэш всего дерева файлов, хранится в `.indeX/`.

---

### `indeX clear`

**Синтаксис:** `indeX clear`

**Назначение:** Полностью очищает индекс — удаляет директорию `.indeX/index.lancedb/`. Лёгкая команда, не требует загрузки нативных модулей.

#### Аргументы

Нет аргументов.

#### Опции

Нет опций.

#### Примеры

```bash
$ indeX clear
Index cleared.

# Повторный вызов (уже пусто)
$ indeX clear
Index cleared.
```

#### Примечания

- Мгновенное выполнение (<200 мс).
- После `clear` конфиг `.indeX/config.json` сохраняется.
- Для повторной индексации: `indeX embed .`
- На Windows может не сработать, если файлы БД заблокированы другим процессом. В таком случае: `Failed to clear index: ... Files may be locked. Close other processes or reboot.`

---

### `indeX watch`

**Синтаксис:** `indeX watch <command> [options]`

**Назначение:** Управление watch-демоном — фоновым процессом для автоматической переиндексации при изменениях файлов. Удалённые файлы автоматически убираются из индекса.

#### Подкоманды

| Команда | Описание |
|---------|----------|
| `start <dir>` | Запустить watch-демон |
| `stop` | Остановить watch-демон |
| `status` | Показать статус watch-демона |

#### `indeX watch start <dir>`

| Аргумент | Описание | Обязательный |
|----------|----------|-------------|
| `<dir>` | Директория для наблюдения | ✅ Да |

| Опция | Описание | Возможные значения | По умолчанию |
|-------|----------|-------------------|--------------|
| `--port <n>` | Порт health-сервера | Число (1–65535) | Случайный |

```bash
$ indeX watch start . --port 3456
Watch daemon starting for D:\projects\myapp (PID: 12345)
Config: .indeX/watch.json
```

#### `indeX watch stop`

```bash
$ indeX watch stop
Stopping watch daemon (PID: 12345)...
Watch daemon stopped.
```

#### `indeX watch status`

```bash
$ indeX watch status
Watch daemon status:
  Directory: D:\projects\myapp
  PID:       12345
  Status:    running
  Started:   2026-06-20T20:35:00.000Z
  Responding: Yes
  Uptime:     5m 23s
  Watcher:    active
```

##### Поля вывода

| Поле | Описание |
|------|----------|
| `Directory` | Наблюдаемая директория |
| `PID` | ID процесса демона |
| `Status` | `starting` / `running` / `stopped` / `error` |
| `Started` | Время запуска |
| `Responding` | Доступен ли health-эндпоинт (`Yes` / `No` / `—`) |
| `Uptime` | Время работы (формат: `5m 23s`) |
| `Watcher` | Статус файлового watcher'а (`active` / `stopped` / `unknown`) |

#### Примечания

- Демон использует BLAKE3-диффинг — переиндексирует только изменённые файлы.
- Конфиг демона: `.indeX/watch.json`.
- Один демон на одну `.indeX/` директорию.
- Работает и в dev mode, и в скомпилированном exe: entrypoint резолвится относительно модуля CLI, а не текущей директории.
- Игнорируемые директории (`node_modules`, `.git`, `.indeX`, `dist`, `build`, `.opencode`) задаются предикатом, совместимым с chokidar 5.
- **Известная проблема на Windows:** PID может быть переиспользован другим процессом после остановки демона.

---

### `indeX mcp`

**Синтаксис:** `indeX mcp`

**Назначение:** Запускает MCP-сервер (Model Context Protocol) поверх **stdio** для AI-агентов. stdout используется только для JSON-RPC, все логи идут в stderr.

```bash
# Запуск сервера (обычно вызывается агентом, а не вручную)
$ indeX mcp
```

Зарегистрированные инструменты: `search`, `embed`, `pack`, `stats`, `scan`, `clear`, `chunk`, `watch_start`, `watch_status`, `watch_stop`. Конфигурация `.opencode/opencode.json` использует `["indeX", "mcp"]`.

---

## Web UI (React)

Современный SPA-интерфейс на **React 19 + MUI** находится в `web/`, собирается в `dist/web` и раздаётся Hono-сервером.

```bash
# Собрать SPA (React → dist/web)
bun run build:web

# Запустить API + UI на http://localhost:3000
bun run serve:web

# In-memory режим (без сохранения индекса)
bun run serve:web -- --memory
```

Возможности UI:

- поиск в режимах keyword / hybrid / semantic;
- фильтры по источникам, тегам, минимальному score и размеру страницы;
- пагинация, раскрытие деталей и навигация по чанкам источника: кликабельная карта, prev/next, стрелки ← →, распределение размеров и компактный список;
- AST-дерево кода (imports / exports / symbols с номерами строк), полные метаданные, BLAKE3, ID, embedding preview и копирование карточки в JSON;
- панель Index / Session / System в выезжающем drawer;
- редактирование конфига и очистка индекса с подтверждением.

Оформление повторяет референс IndeX Style: тёмная база `#070B0E`, неоновый голубой `#00DBFF`, диагональный световой луч, сетка на фоне, логотип с угловыми скобками и компактные карточки результатов с визуальной картой чанков. Сборка выполняется автоматически при запуске `serve:web`, если исходники новее `dist/web`.

---

## Архитектура

Проект построен по принципам **Ports & Adapters** (гексагональная архитектура) + **DDD**.

```
src/
  domain/             # Чистое ядро — ноль внешних зависимостей
    types.ts            # SourceType, SearchQuery, SearchResult, Chunk
    ast.ts              # AST-типы (Symbol, Import, Export, Complexity)
    ports/              # Интерфейсы: SourceRepository, FileFilter, Logger, SourceParserRegistry
    services/           # IndexingService, SearchService, DiffIndexingService
    systems/            # ChunkingSystem, EmbeddingSystem

  infrastructure/     # Адаптеры — реализация портов
    parser/             # AstGrepParser (TS/JS/Python/C#/JSON), MarkdownParser, ObsidianParser
    chunking/           # ChunkerFactory: heading, paragraph, sentence, overflow, code
    embedding/          # OllamaEmbedder, CachedEmbedder, EmbedderCacheLRU, EmbedderRegistryImpl
    hashing/            # BLAKE3Hasher, TokenEstimatorSimple
    lancedb/            # LanceDbSourceRepository
    logger/             # PinoLogger, SilentLogger
    watcher/            # ChokidarWatcher
    context/            # RAGContextPacker
    markdown/           # MarkdownAstParser

  application/        # Use cases — оркестрация систем
    IndexUseCase.ts     # Полный цикл индексации
    SearchUseCase.ts    # Поиск с агрегацией результатов
    PackUseCase.ts      # Упаковка файлов в контекст
    ChunkUseCase.ts     # Только чанкование
    EmbedUseCase.ts     # Только эмбеддинг
    WatchUseCase.ts     # Наблюдение за изменениями
    DeleteUseCase.ts    # Удаление и статистика
    SyncUseCase.ts      # Синхронизация с ФС

  presentation/       # Интерфейсы пользователя
    cli/                # Commander CLI (11 команд)
    api/                # Hono HTTP API + сборка web
    mcp/                # MCP-сервер (stdio)

  config/             # ConfigLoader — Zod-валидация конфига
  shared/             # globMatcher, TreeSnapshot, fileUtils
  watch/              # WatchDaemon, WatchHealthServer, WatchConfig
  index.ts            # createApp() — composition root

web/                  # React 19 + MUI SPA (source)
  index.html
  src/                # App, components, theme, api client
dist/web/             # собранный SPA (gitignored)
```

**Правило:** `domain/` никогда не импортирует из `infrastructure/` или внешних пакетов.  
Все связи — в `src/index.ts` (`createApp()`). Тесты подменяют адаптеры через моки (`tests/mocks/`).

---

## Конфигурация

Файл: `.indeX/config.json`. Валидируется через Zod.

```json
{
  "models": [
    {
      "name": "qllama/multilingual-e5-small",
      "dimensions": 384,
      "provider": "ollama",
      "baseUrl": "http://localhost:11434"
    }
  ],
  "universal_model": "qllama/multilingual-e5-small",
  "chunking": {
    "default_strategy": "heading",
    "max_chunk_size": 500,
    "overlap": 32
  },
  "search": {
    "default_mode": "hybrid",
    "top_k": 10,
    "hybrid_weight": 0.7
  },
  "indexing": {
    "exclude": [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/build/**",
      "**/.tmp/**",
      "**/.opencode/**",
      "**/.indeX/**",
      "**/.venv/**",
      "**/__pycache__/**",
      "**/target/**",
      "**/vendor/**"
    ]
  },
  "embedder": {
    "cache_size": 1000
  }
}
```

---

## Зависимости

| Пакет | Назначение |
|-------|-----------|
| `@lancedb/lancedb` | Векторная БД (гибридный поиск) |
| `@ast-grep/napi` | AST-парсеры для кода |
| `@ast-grep/lang-*` | Языковые парсеры (C#, JSON, Python) |
| `commander` | CLI-фреймворк |
| `hono` | HTTP-сервер |
| `chokidar` | Файловый watcher |
| `@modelcontextprotocol/sdk` | MCP-протокол |
| `hash-wasm` | BLAKE3-хэширование |
| `pino` | Логирование |
| `remark` | Markdown-парсер |
| `zod` | Валидация схем |
| `micromatch` | Glob-матчинг |
| `gpt-tokenizer` | Подсчёт токенов |
| `yaml` | YAML-парсер (фронтматер) |

---

## Тестирование

```bash
# Все тесты
bun test

# Один файл
bun test tests/domain/types.test.ts

# С покрытием
bun test --coverage

# Проверка типов (strict + exactOptionalPropertyTypes)
bun run typecheck
```

- Фреймворк: `bun:test` (describe, expect, test)
- `bun test` не проверяет типы — для этого есть отдельный `bun run typecheck` (`tsc --noEmit`)
- Моки: `tests/mocks/Mock*.ts` — реализуют доменные интерфейсы
- Интеграционные тесты: `tests/integration/` — используют `memory://` LanceDB
- Фикстуры: `tests/fixtures/` — образцы .md и .ts файлов
- Ollama **не требуется** для тестов — используется MockEmbedder

---

## Сборка

```bash
# Компиляция в exe
bun build --compile --target=bun-windows-x64 ./src/presentation/cli/cli.ts --outfile=dist/indeX

# Использование без Bun
dist\indeX.exe embed .
dist\indeX.exe search "query" --mode hybrid
```

**Важно:** Первый запуск `embed`/`search`/`pack`/`chunk`/`stats` — ~5 секунд (lazy-загрузка нативных модулей).  
`init`, `clear`, `scan`, `watch` — запускаются мгновенно (без тяжёлых импортов).

---

## Известные проблемы

- **Multi-model embeddings** — реестр выбирает одну модель на тип источника; одновременное хранение векторов нескольких моделей не реализовано.
- **`@ast-grep/napi` v0.43.0 на Windows** — падает с `TODO: ReadSymbol(GetProcAddress { source: 127 })`.
- **Rename events** — приходят как два события (unlink + add), полная переиндексация.
- **LanceDB startup lag** — старые транзакции замедляют открытие БД. Решение: `indeX clear`.
- **Lazy imports** — первый запуск `loadApp()` ~5 секунд. Последующие — мгновенно (кэш).
- **Watch PID на Windows** — PID может быть переиспользован другим процессом. Приемлемо для локального инструмента.

---

## Лицензия

MIT
