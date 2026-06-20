---
name: indeX
description: Use the IndeX tool to index, search, and pack codebases with hybrid (vector + keyword) AST-aware search. Load when working with the IndeX project — searching code, packing context for LLM, indexing, or configuring the search engine.
version: 1.0.0
type: skill
---

# IndeX Skill

> Index, search, and pack code through IndeX — a local code & document indexer
> with hybrid (vector + keyword) search and AST-aware parsing.

---

## Overview

IndeX indexes code and notes into LanceDB. Key capabilities:

- **Hybrid search** — vector (semantic) + keyword (FTS) weighted combination
- **AST search** — filter by code structure (functions, classes, imports)
- **Pack** — bundle files into compact JSONL or readable Markdown for LLM context
- **Watch daemon** — background re-indexing on file changes
- **Multi-language** — TS/JS, Python, JSON, Markdown, C#

Run from the project root (where `.indeX/config.json` lives).

The compiled `indeX` binary is in PATH — use it directly, no `bun run` needed.

---

## Quick Start

```bash
# Init config, embed, search
indeX init
indeX embed .
indeX search "BLAKE3 hasher" --mode hybrid

# Pack files for LLM context
indeX pack . --format md --meta --content
```

---

## Commands

| Command | Description |
|---------|-------------|
| `init` | Create `.indeX/config.json` (+ `--agent opencode` for `.opencode/skills/`) |
| `embed <path>` | Scan, parse, chunk, embed, save to LanceDB |
| `search <query>` | Search with modes + custom columns |
| `pack <path>` | Bundle files into JSONL (default) or MD |
| `scan <path>` | Dry-run — preview which files match filters |
| `chunk <path>` | Split files into semantic chunks |
| `stats` | Show index statistics |
| `clear` | Delete `.indeX/` (config + DB) |
| `watch start <dir>` | Start background re-indexing daemon |
| `watch status` | Ping daemon health endpoint |
| `watch stop` | Stop daemon |

Heavy commands (embed, search, pack, chunk, stats) lazy-load native
modules on first call (~5s), then cached. `init`, `clear`, `scan`, `watch` are
lightweight (no native imports).

### `init --agent opencode`

Creates `.opencode/skills/indeX/SKILL.md` alongside the config — so AI agents
get this skill automatically in new projects:

```bash
indeX init --agent opencode
# → .indeX/config.json
# → .opencode/skills/indeX/SKILL.md
```

---

## Search

### Modes

| Mode | Flag | Use case |
|------|------|----------|
| `hybrid` | `--mode hybrid` (default) | General purpose — vector + keyword combined |
| `semantic` | `--mode semantic` | Meaning / intent matching |
| `keyword` | `--mode keyword` | Exact term match |
| `ast` | `--mode ast` or `--ast` | Structural search (functions, classes, imports) |

### Columns

Control output via `--columns path,score,content,ast,...`:

`match_type` `path` `score` `type` `title` `content` `tags` `chunk`
`blake3` `ast` `meta` `timestamps` `model_scores` `embedding`

---

## Pack

Output sections per file. Section flags are **positive only** — pass any
combination to override defaults:

| Flag | Section | What's included |
|------|---------|-----------------|
| `--meta` | metadata | type, language, lines, tokens, tags, path, blake3, last_parsed |
| `--ast` | AST | JSONL: imports, exports, symbols, complexity |
| `--content` | code/content | Full file content |
| `--links` | links | Cross-file relationships |

No section flags → default set (meta + ast + content). Any explicit flag →
**only** what you listed.

### Format

| Flag | Format | One line per file → | Use for |
|------|--------|---------------------|---------|
| `--format jsonl` (default) | One JSON object | `{"path":"...","type":"code","content":"..."}` | Machine parsing, compact |
| `--format md` | Markdown | File Index + per-file sections + code fences | Human reading, LLM context |

```bash
indeX pack .                          # jsonl: meta+ast+content
indeX pack . --format md              # md: meta+ast+content
indeX pack . --content                # jsonl: only content
indeX pack . --meta --links           # jsonl: only meta+links
indeX pack . --format md -o ctx.md    # md → stdout + file
```

Output always goes to stdout. `-o` additionally writes to file.

---

## Config

`.indeX/config.json` (Zod-validated):

```json
{
  "models": [{ "name": "qllama/multilingual-e5-small", "dimensions": 384, "provider": "ollama" }],
  "universal_model": "qllama/multilingual-e5-small",
  "chunking": { "default_strategy": "heading", "max_chunk_size": 500, "overlap": 32 },
  "search": { "default_mode": "hybrid", "top_k": 10, "hybrid_weight": 0.7 },
  "indexing": {
    "exclude": ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**",
                "**/.tmp/**", "**/.opencode/**", "**/.venv/**", "**/__pycache__/**",
                "**/target/**", "**/vendor/**"]
  }
}
```

---

## Architecture

```
CLI → loadApp() → createApp()
                       │
             ┌─────────┼──────────┐
             ▼         ▼          ▼
     ParserRegistry  Embedder  LanceDB
             │         │          │
     AstGrepParser  Ollama    SearchUseCase
     CSharpParser           PackUseCase
```

- `domain/` — zero external deps (pure core)
- `infrastructure/` — adapters (parsers, embedders, DB)
- `application/` — use cases orchestrating systems
- `src/index.ts` — `createApp()` composition root
- `loadApp()` — lazy cached import of native modules (~5s first call)
- `clear`, `watch`, `scan`, `init` — skip `loadApp()`, fast startup

---

## Watch Daemon

- Background process, spawns `createApp()` in child
- PID written to `.indeX/watch.json` (3 phases: starting→running→health_port)
- BLAKE3 diffing — only changed files re-indexed
- `GET /api/health`, `POST /api/shutdown` on random port
- One daemon per `.indeX/` directory

---

## Best Practices

1. **English queries** — vector models are more accurate with English
2. **Mode selection** — AST for structure, semantic for meaning, keyword for exact terms
3. **Packing for LLM** — `--meta --content` gives code + metadata (recommended)
4. **Dry-run first** — `scan` before `embed` to preview file filters
5. **Glob patterns** — `*` doesn't match `/`, use `**/*.ts` for subdirectories
6. **After clearing** — re-run `init` to recreate config before `embed`

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `search` returns nothing | No index | `indeX embed .` |
| Ollama connection refused | Ollama not running | `ollama serve` |
| LanceDB slow startup | Old transactions | `indeX clear` |
| `Packed 0 files` | Glob mismatch | Check via `indeX scan .` |
| Packed file has wrong format | Section flags | Pass explicit `--meta --content --ast --links` |
| First command is slow (~5s) | `loadApp()` lazy import | Normal — subsequent calls are cached |
