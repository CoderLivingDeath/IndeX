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
