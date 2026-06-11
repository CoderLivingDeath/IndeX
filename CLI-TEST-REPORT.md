# IndeX CLI — Manual Test Report

## Environment
- **OS:** Windows 10
- **Runtime:** Bun (latest)
- **Project:** IndeX (all 12 phases + Phase 13 AST search)
- **Date:** 2026-06-11

---

## Тестовый набор данных

```
tmp/cli-test/
├── readme.md           # Markdown (36 строк, 164 токена) — общая документация
├── note-with-tags.md   # Obsidian (32 строки, 142 токена) — теги: typescript, tutorial
├── obsidian-test.md    # Obsidian (13 строк, 76 токенов) — теги: testing, cli, wiki-links
├── utils.ts            # TypeScript (26 строк, 141 токен) — функции, интерфейс, импорты
└── subfolder/
    └── deep-note.md    # Markdown (12 строк, 51 токен) — тест рекурсивного обхода
```

**Всего:** 5 файлов (4 .md + 1 .ts)

---

## Результаты тестирования

### 1. `--help`
**Команда:** `bun run src/presentation/cli/cli.ts -- --help`
**Статус:** ✅ **ПРОЙДЕН**
**Вывод:** Все 8 команд (index, search, pack, chunk, embed, watch, stats, clear) + флаги (--mode, --top-k, --tags, --ast, -o, --include, --exclude).

---

### 2. `index <path>`
**Команда:** `bun run ... index D:\repos\IndeX\tmp\cli-test`
**Статус:** ✅ **ПРОЙДЕН**
**Вывод:** `Indexed 5 files, 5 chunks`
**Проверено:**
- Индексирует .md и .ts файлы
- Рекурсивно обходит подпапки
- Heading-based чанкинг (1 chunk = 1 файл, т.к. файлы меньше 500 токенов)

---

### 3. `search <query> --mode ... --top-k N`

| Режим | Команда | Результат |
|-------|---------|-----------|
| **keyword** | `search "TypeScript" --mode keyword --top-k 5` | ✅ `note-with-tags.md` на 1-м месте (score: 2.799) |
| **hybrid** | `search "indexing" --mode hybrid --top-k 5` | ✅ `readme.md` найден (score: 1.603) |
| **semantic** | `search "typescript generics" --mode semantic --top-k 3` | ✅ `note-with-tags.md` на 1-м месте (score: 7.146) |
| **ast** | `search "function" --ast --top-k 5` | ✅ `utils.ts` найден (score: 0.487) |
| **ast (полный флаг)** | `search "greet" --mode ast --top-k 3` | ✅ `utils.ts` найден (score: 0.396) |
| **tags** | `search "typescript" --tags "typescript"` | ✅ note-with-tags.md найден |

**Статус:** ✅ **ПРОЙДЕН**
**Замечание:** После `clear` поиск возвращает `No results found` — корректно.

---

### 4. `pack <path>`

| Вариант | Команда | Статус |
|---------|---------|--------|
| stdout | `pack D:\repos\IndeX\tmp\cli-test` | ✅ 5 файлов, 1238 токенов, метаданные, AST JSONL |
| -o file | `pack ... -o cli-test-packed.md` | ✅ Файл записан, `Packed 5 files → file (1238 tokens)` |
| --include | `pack ... --include "**/*.ts"` | ✅ Только utils.ts (1 файл, 462 токена) |
| --exclude | `pack ... --exclude "*.ts"` | ⚠️ **БАГ** — `utils.ts` не исключается |

**Статус:** ✅ **ПРОЙДЕН** (с багом)

**Баг #1: `--exclude "*.ts"` не работает**
- **Причина:** Функция `matchesGlob()` в `src/application/PackUseCase.ts` (строка 49) не обрабатывает простые glob-паттерны `*.ts`. Попадает в fallback `filePath.includes(pattern)` — ищет буквальную строку `*.ts` в пути.
- **Workaround:** Использовать `--exclude "**/*.ts"` вместо `*.ts`
- **Серьёзность:** Низкая (есть workaround)

---

### 5. `chunk <path>`
**Команда:** `chunk D:\repos\IndeX\tmp\cli-test`
**Статус:** ✅ **ПРОЙДЕН**
**Вывод:** `Chunked into 5 chunks` + лог `Chunking produced 5 chunks from 5 files`

---

### 6. `embed <path>`
**Команда:** `embed D:\repos\IndeX\tmp\cli-test`
**Статус:** ✅ **ПРОЙДЕН**
**Вывод:** `Embedding complete`, `Embedded and upserted 5 chunks`
**Ollama:** Работает, модель `qllama/multilingual-e5-small` (384-dim)

---

### 7. `watch <path>`
**Команда:** `watch D:\repos\IndeX\tmp\cli-test`
**Статус:** ✅ **ПРОЙДЕН**
**Вывод:** `Watching D:\repos\IndeX\tmp\cli-test` — запускается без ошибок

---

### 8. `stats`
**Команда:** `stats`
**Статус:** ❌ **НЕ РАБОТАЕТ**
**Вывод:** `Stats requested` — команда-заглушка, реальной статистики нет.
**Причина:** В `cli.ts` (строка 156-159) — берёт `app.del` но ничего с ним не делает. Просто `console.log("Stats requested")`.

---

### 9. `clear`
**Команда:** `clear`
**Статус:** ✅ **ПРОЙДЕН**
**Вывод:** `Index cleared.` После очистки поиск возвращает 0 результатов.

---

### 10. Error Handling

| Сценарий | Вывод | Статус |
|----------|-------|--------|
| `index` без пути | `Error: path required` | ✅ |
| `search` без запроса | `Error: query required` | ✅ |
| `pack` без пути | `Error: path required` | ✅ |
| `chunk` без пути | `Error: path required` | ✅ |
| `embed` без пути | `Error: path required` | ✅ |

---

## Итоговая таблица

| Команда | Статус | Примечание |
|---------|--------|-----------|
| `--help` | ✅ | Все команды + флаги |
| `index <path>` | ✅ | 5 файлов, рекурсивно |
| `search --mode keyword` | ✅ | TF-based скоринг |
| `search --mode semantic` | ✅ | Через Ollama (e5-small) |
| `search --mode hybrid` | ✅ | Взвешенная комбинация |
| `search --mode ast` | ✅ | Поиск по AST символам |
| `search --tags` | ✅ | Фильтрация по тегам |
| `search --top-k` | ✅ | Лимит результатов |
| `pack <path>` | ✅ | 5 файлов, метаданные, AST |
| `pack -o <file>` | ✅ | Запись в файл |
| `pack --include` | ✅ | `**/*.ts` работает |
| `pack --exclude` | ✅ | **Баг #1: ИСПРАВЛЕН** — `*.ts` работает |
| `chunk <path>` | ✅ | |
| `embed <path>` | ✅ | + Ollama |
| `watch <path>` | ✅ | Запускается |
| `stats` | ✅ | **Баг #2: ИСПРАВЛЕН** — показывает Files/Chunks/Tokens |
| `clear` | ✅ | Полная очистка |
| Error handling | ✅ | Все missing path/query |

---

## Исправленные баги

### ~~Баг #1: `pack --exclude "*.ts"` не работает~~ ✅ **ИСПРАВЛЕН**
- **Файл:** `src/application/PackUseCase.ts`
- **Функция:** `matchesGlob()` (строка 49)
- **Описание:** Простые glob-паттерны без `**/` prefix (например `*.ts`) обрабатывались как подстрока (`filePath.includes(pattern)`), а не как glob.
- **Фикс:** Добавлена ветка для паттернов вида `*.ext`:
  ```typescript
  if (pattern.startsWith("*.")) {
    const ext = pattern.slice(1);
    return normalised.endsWith(ext);
  }
  ```

### ~~Баг #2: `stats` — команда-заглушка~~ ✅ **ИСПРАВЛЕН**
- **Файл:** `src/presentation/cli/cli.ts` (строка 156-159)
- **Описание:** Команда `stats` выводила только "Stats requested" без реальных данных.
- **Фикс:** Заменена на вызов `app.del.stats()`, который возвращает `IndexStats` (через `DeleteUseCase.stats() → LanceDbSourceRepository.stats()`).
