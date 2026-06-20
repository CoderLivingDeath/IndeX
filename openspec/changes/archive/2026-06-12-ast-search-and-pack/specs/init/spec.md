## ADDED Requirements

### Requirement: CLI init --agent opencode
The `init` command SHALL support scaffolding AI agent configuration for opencode, creating `.opencode/skills/indeX/SKILL.md`.

#### Scenario: Create skill with --agent opencode
- **WHEN** running `indeX init --agent opencode`
- **THEN** `.opencode/skills/indeX/SKILL.md` SHALL be created alongside `.indeX/config.json`

#### Scenario: Skill not created without flag
- **WHEN** running `indeX init` without `--agent`
- **THEN** only `.indeX/config.json` SHALL be created
