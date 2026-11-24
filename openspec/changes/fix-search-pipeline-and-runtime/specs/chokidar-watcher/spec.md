## ADDED Requirements

### Requirement: Ignore rules use chokidar predicates
The watcher SHALL apply ignore patterns through a predicate or regular expression compatible with chokidar 5, not through glob strings.

#### Scenario: Glob patterns translated
- **WHEN** the watcher is constructed with glob ignore patterns such as `**/node_modules/**`
- **THEN** it SHALL pass a predicate to chokidar that evaluates those patterns with the shared glob matcher

#### Scenario: Dependency directories ignored
- **WHEN** a file changes under `node_modules/`, `.git/`, `dist/`, or `build/`
- **THEN** the watcher SHALL NOT emit an event for that file

#### Scenario: Index directory ignored
- **WHEN** IndeX writes to `.indeX/` while indexing
- **THEN** the watcher SHALL NOT emit events for those writes

#### Scenario: No raw glob strings
- **WHEN** constructing the chokidar watcher
- **THEN** the `ignored` option SHALL NOT receive glob strings directly

#### Scenario: Debounce preserved
- **WHEN** multiple rapid changes occur for the same event and path
- **THEN** only the final event SHALL be emitted after the debounce interval

#### Scenario: Delete events delivered
- **WHEN** a watched file is deleted
- **THEN** the watcher SHALL emit an `unlink` event with the file path
