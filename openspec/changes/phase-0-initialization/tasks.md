## 1. Project Initialization

- [ ] 1.1 Run `bun init -y` to create `package.json` with Bun defaults
- [ ] 1.2 Create `tsconfig.json` with strict mode, `@/*` path alias → `src/*`, ES module resolution
- [ ] 1.3 Create `.gitignore` excluding `node_modules`, `.indeX/data`, `dist/`
- [ ] 1.4 Create full `src/` directory tree: `domain/{systems,ports,services}`, `application/di`, `infrastructure/{chunking,embedding,context,hashing,lancedb,parser,watcher,logger}`, `presentation/{cli,api,web}`, `config`
- [ ] 1.5 Create full `tests/` directory tree: `domain/{systems,services}`, `infrastructure/{chunking,embedding,context,hashing,lancedb,parser,config}`, `application`, `fixtures`, `mocks`
- [ ] 1.6 Install core dependencies: `typescript`, `@types/bun`, `hash-wasm`, `zod`, `remark`, `remark-frontmatter`, `remark-gfm`, `yaml`
- [ ] 1.7 **RED**: Write `tests/integration/setup.test.ts` verifying `bun test` works (1+1=2 assertion)
- [ ] 1.8 **GREEN**: Create `src/index.ts` stub that prints "IndeX started"
- [ ] 1.9 **TEST**: Run `bun test` — all tests must pass
