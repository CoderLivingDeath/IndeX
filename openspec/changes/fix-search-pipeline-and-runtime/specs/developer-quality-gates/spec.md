## ADDED Requirements

### Requirement: Strict typecheck gate
The project SHALL provide a typecheck command that validates `src/**` and `tests/**` under the repository's strict TypeScript settings.

#### Scenario: Typecheck command exists
- **WHEN** running `bun run typecheck`
- **THEN** it SHALL execute `tsc --noEmit` against the project tsconfig

#### Scenario: Zero project errors
- **WHEN** running `bun run typecheck`
- **THEN** it SHALL exit with status 0 and report no errors in project files

#### Scenario: Third-party declarations isolated
- **WHEN** third-party packages ship declarations that require DOM types or contain errors
- **THEN** the tsconfig SHALL provide the required libs and skip checking dependency declarations, without disabling strictness for project code

#### Scenario: Optional properties are type-safe
- **WHEN** a function receives optional filters or watcher options
- **THEN** the call sites SHALL satisfy `exactOptionalPropertyTypes` without casts

### Requirement: Deterministic test suite
Tests SHALL not depend on the repository's own contents or on wall-clock-sensitive scans.

#### Scenario: Full suite passes
- **WHEN** running `bun test`
- **THEN** every test SHALL pass within the default timeout

#### Scenario: Fixture-based file tests
- **WHEN** a test needs files to scan, chunk, pack, or index
- **THEN** it SHALL use a temporary fixture directory, not the repository root

#### Scenario: Search integration test
- **WHEN** semantic or hybrid search is tested
- **THEN** the test SHALL use a real in-memory LanceDB repository and assert that a semantically similar chunk is returned

#### Scenario: No hidden dependence on Ollama
- **WHEN** running the suite on a machine without Ollama
- **THEN** all tests SHALL still pass via mocks

### Requirement: Documentation matches the CLI
User-facing documentation SHALL describe the commands and flags that actually exist.

#### Scenario: Command table matches help
- **WHEN** comparing the README command table with `indeX --help`
- **THEN** the command sets SHALL match

#### Scenario: No stale known-issues
- **WHEN** a known bug listed in AGENTS.md is fixed by this change
- **THEN** the entry SHALL be removed or updated

#### Scenario: Column shapes documented
- **WHEN** README documents `chunk`, `blake3`, or `timestamps` output
- **THEN** the documented shape SHALL match the CLI formatter output
