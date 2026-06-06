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
