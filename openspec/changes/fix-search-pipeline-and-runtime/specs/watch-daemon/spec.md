## ADDED Requirements

### Requirement: Watch daemon lifecycle
The system SHALL run the file watcher as a detached background process managed through `.indeX/watch.json`.

#### Scenario: Start writes starting state
- **WHEN** running `indeX watch start <dir>`
- **THEN** `.indeX/watch.json` SHALL be written with status `starting` and `pid: null` before the daemon is spawned

#### Scenario: Daemon registers its PID
- **WHEN** the daemon has loaded its dependencies
- **THEN** it SHALL write its own PID and status `running` to `.indeX/watch.json`

#### Scenario: Stop clears PID
- **WHEN** running `indeX watch stop`
- **THEN** the daemon SHALL be signalled and the config SHALL be updated to status `stopped` with `pid: null`

#### Scenario: Status reports health
- **WHEN** running `indeX watch status` while the daemon is alive
- **THEN** it SHALL report directory, PID, status, start time, health response, uptime, and watcher status

#### Scenario: One daemon per index directory
- **WHEN** starting a second daemon for a directory whose configured PID is alive
- **THEN** the command SHALL refuse to start and exit non-zero

### Requirement: Spawn target resolution
The daemon SHALL be launched through a resolvable entrypoint in both dev and compiled modes.

#### Scenario: Dev mode entrypoint
- **WHEN** the CLI runs from source (`bun run src/presentation/cli/cli.ts`)
- **THEN** the daemon SHALL be spawned with an absolute path to `src/watch/WatchDaemon.ts` that exists relative to the CLI module, not the caller's working directory

#### Scenario: Compiled mode entrypoint
- **WHEN** the CLI runs as a compiled executable
- **THEN** the daemon SHALL be spawned via the executable's `watch-daemon` subcommand

#### Scenario: Missing entrypoint
- **WHEN** the resolved entrypoint does not exist
- **THEN** the command SHALL report a clear error and reset the config to `stopped`

### Requirement: Startup failure handling
The daemon SHALL never leave a stale `starting` state or a PID that does not belong to it.

#### Scenario: Watcher fails to start
- **WHEN** the watcher throws during startup
- **THEN** the daemon SHALL write status `error` with `pid: null` and exit non-zero

#### Scenario: Stale PID detected
- **WHEN** the stored PID belongs to a dead process
- **THEN** `watch start` SHALL treat it as stale and overwrite the config

#### Scenario: Health server unavailable
- **WHEN** the health server cannot bind the requested port
- **THEN** the daemon SHALL fall back to a random port or report the failure without crashing the watcher

#### Scenario: Shutdown cleanup
- **WHEN** the daemon receives SIGTERM or SIGINT
- **THEN** it SHALL stop the watcher and health server and write status `stopped` before exiting
