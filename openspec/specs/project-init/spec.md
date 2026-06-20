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

### Requirement: AI agent scaffolding via --agent flag
The `init` command SHALL support creating AI agent configuration alongside the default config.

#### Scenario: --agent opencode creates skill file
- **WHEN** running `indeX init --agent opencode`
- **THEN** `.opencode/skills/indeX/SKILL.md` SHALL be created alongside `.indeX/config.json`

#### Scenario: Skill file content
- **WHEN** the skill file is created
- **THEN** it SHALL contain full documentation of all indeX commands, search modes, pack sections, configuration, architecture, best practices, and troubleshooting

#### Scenario: No agent flag — only config
- **WHEN** running `indeX init` without `--agent`
- **THEN** only `.indeX/config.json` SHALL be created (no skill file)
