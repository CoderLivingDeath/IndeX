## ADDED Requirements

### Requirement: Snapshot-based synchronisation
The system SHALL synchronise the index with the file system using a tree snapshot (BLAKE3 over sorted path/mtime entries).

#### Scenario: First sync
- **WHEN** running sync for a directory with no stored snapshot
- **THEN** all matching files SHALL be indexed and a snapshot SHALL be stored

#### Scenario: Unchanged tree short-circuits
- **WHEN** the current snapshot hash equals the stored hash
- **THEN** sync SHALL report `deleted: 0`, `indexed: 0` and skip all file reads

#### Scenario: Deleted files pruned
- **WHEN** a path exists in the index but not on disk
- **THEN** its chunks and file index entry SHALL be deleted

#### Scenario: New and modified files reindexed
- **WHEN** a file is new or its mtime differs from the stored entry
- **THEN** it SHALL be re-indexed through the diff indexing service

#### Scenario: Unchanged files skipped
- **WHEN** a file's mtime matches the stored entry
- **THEN** it SHALL NOT be read or re-indexed

#### Scenario: Result reports counts
- **WHEN** sync completes
- **THEN** it SHALL report `previousHash`, `currentHash`, `deleted`, `indexed`, `skipped`, and `errors`

### Requirement: Failure-safe snapshot persistence
The system SHALL persist the tree snapshot only after a successful indexing pass.

#### Scenario: Successful pass stores snapshot
- **WHEN** all deletions and reindex operations succeed
- **THEN** the new snapshot hash and entries SHALL be written to `db_meta`

#### Scenario: Failed pass keeps previous snapshot
- **WHEN** one or more files fail to re-index
- **THEN** the previous snapshot SHALL remain in `db_meta` so the next sync retries those files

#### Scenario: Errors are surfaced
- **WHEN** sync finishes with errors
- **THEN** the result `errors` count SHALL be greater than zero and the failing paths SHALL be logged

#### Scenario: Retry after failure
- **WHEN** sync is re-run after a failed pass
- **THEN** files that were not indexed SHALL be detected and attempted again

### Requirement: Idempotent sync
Re-running sync on an unchanged tree SHALL not duplicate rows or corrupt the index.

#### Scenario: Repeated sync is a no-op
- **WHEN** sync succeeds and is immediately run again
- **THEN** the second run SHALL report an unchanged snapshot and make no writes

#### Scenario: Repeated deletion is harmless
- **WHEN** deleting a path that is already absent from the index
- **THEN** sync SHALL NOT fail and SHALL NOT increment the error count
