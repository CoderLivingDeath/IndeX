// ---------------------------------------------------------------------------
// SyncUseCase — synchronise the index with the file system
//
// Uses a tree-snapshot hash (BLAKE3 of sorted {relativePath, mtimeMs} entries)
// to quickly detect if anything changed.  On mismatch:
//   1. Stale paths in DB → deleteByPath (prune)
//   2. New / changed files → diffIndexFile (re-index)
//   3. Unchanged files   → skip (no file I/O)
//
// Snapshot entries are stored in db_meta for entry-level diffing.
// ---------------------------------------------------------------------------

import { join, resolve } from "path";
import type { SourceRepository } from "../domain/ports/SourceRepository";
import type { FileFilter } from "../domain/ports/FileFilter";
import type { Hasher } from "../domain/systems/HashingSystem";
import type { Logger } from "../domain/ports/Logger";
import { DiffIndexingService } from "../domain/services/DiffIndexingService";
import { computeTreeSnapshot } from "../shared/TreeSnapshot";
import type { TreeEntry } from "../shared/TreeSnapshot";

export interface SyncResult {
  /** Tree-snapshot hash before sync. null on first run. */
  previousHash: string | null;
  /** Current tree-snapshot hash (after sync). */
  currentHash: string;
  /** Number of stale file entries removed from the DB. */
  deleted: number;
  /** Number of files (re-)indexed (new + modified). */
  indexed: number;
  /** Number of files skipped (unchanged — via mtime match). */
  skipped: number;
  /** Number of errors during sync. */
  errors: number;
}

const SNAPSHOT_HASH_KEY = "tree_snapshot_hash";
const SNAPSHOT_ENTRIES_KEY = "tree_snapshot_entries";

interface StoredEntry {
  r: string;  // relativePath
  m: number;  // mtimeMs
}

export class SyncUseCase {
  constructor(
    private readonly repo: SourceRepository,
    private readonly diffService: DiffIndexingService,
    private readonly hasher: Hasher,
    private readonly fileFilter: FileFilter,
    private readonly logger?: Logger,
    private readonly excludePatterns: string[] = [],
  ) {}

  /**
   * Synchronise the index with the file system under `directory`.
   *
   * 1. Compute a tree snapshot (BLAKE3 of sorted {path, mtime} entries).
   * 2. If the snapshot hash matches the stored value → nothing changed (skip).
   * 3. Otherwise, diff stored vs current entries to find:
   *    - **Deleted** files (in DB but not on disk) → remove from DB.
   *    - **New / modified** files (mtime differs or not in old entries) → re-index.
   * 4. Store the new snapshot hash + entries for next run.
   */
  async execute(directory: string): Promise<SyncResult> {
    const root = resolve(directory);

    // 1. Compute current tree snapshot
    const snapshot = await computeTreeSnapshot(
      directory,
      this.fileFilter,
      this.hasher,
      this.excludePatterns,
    );

    // 2. Quick check — tree unchanged
    const previousHash = await this.repo.getDbMeta(SNAPSHOT_HASH_KEY) as string | null;
    if (previousHash === snapshot.hash) {
      this.logger?.info("Tree snapshot unchanged — nothing to sync");
      return {
        previousHash,
        currentHash: snapshot.hash,
        deleted: 0,
        indexed: 0,
        skipped: snapshot.entries.length,
        errors: 0,
      };
    }

    // 3. Build current path sets for O(1) lookup
    const currentAbsPaths = new Set<string>();
    const currentByRel = new Map<string, TreeEntry>();
    for (const e of snapshot.entries) {
      currentAbsPaths.add(e.path);
      currentByRel.set(e.relativePath, e);
    }

    // 4. Load stored entries from previous sync
    //    Note: getDbMeta auto-parses JSON, so storedRaw is already an array.
    const storedRaw = await this.repo.getDbMeta(SNAPSHOT_ENTRIES_KEY);
    const oldByRel = new Map<string, number>();  // relativePath → mtimeMs
    if (storedRaw) {
      const stored = storedRaw as StoredEntry[];
      if (Array.isArray(stored)) {
        for (const se of stored) {
          if (se && typeof se.r === "string" && typeof se.m === "number") {
            oldByRel.set(se.r, se.m);
          }
        }
      }
    }

    // 5a. Find stale DB paths — files in DB but not on disk
    const dbPaths = await this.repo.getAllPaths();
    const toDelete: string[] = [];
    for (const dbPath of dbPaths) {
      if (!currentAbsPaths.has(dbPath)) {
        toDelete.push(dbPath);
      }
    }

    // 5b. Find files that need (re-)indexing (new or mtime changed)
    const toIndex: string[] = [];
    for (const [relPath, entry] of currentByRel) {
      const oldMtime = oldByRel.get(relPath);
      if (oldMtime === undefined || oldMtime !== entry.mtimeMs) {
        toIndex.push(entry.path);
      }
    }

    // 6. Execute deletions
    let deleted = 0;
    let delErrors = 0;
    for (const path of toDelete) {
      try {
        await this.repo.deleteByPath(path);
        await this.repo.deleteFileIndex(path);
        deleted++;
        this.logger?.info(`Deleted stale: ${path}`);
      } catch (err) {
        delErrors++;
        this.logger?.error(`Error deleting ${path}: ${err}`);
      }
    }

    // 7. Execute (re-)indexing before persisting the snapshot. The snapshot
    //    is a checkpoint: writing it before the work would mark a failed pass
    //    as successful and permanently skip the missed files.
    let indexed = 0;
    let skipped = 0;
    let idxErrors = 0;
    for (const path of toIndex) {
      try {
        const result = await this.diffService.diffIndexFile(path);
        indexed += result.indexed;
        skipped += result.skipped;
        idxErrors += result.errors;
      } catch (err) {
        idxErrors++;
        this.logger?.error(`Error indexing ${path}: ${err}`);
      }
    }

    // 8. Persist the snapshot only on a fully successful pass.
    const totalErrors = delErrors + idxErrors;
    if (totalErrors === 0) {
      const storedEntries: StoredEntry[] = snapshot.entries.map((e) => ({
        r: e.relativePath,
        m: e.mtimeMs,
      }));
      await this.repo.setDbMeta(SNAPSHOT_ENTRIES_KEY, JSON.stringify(storedEntries));
      await this.repo.setDbMeta(SNAPSHOT_HASH_KEY, snapshot.hash);
    } else {
      this.logger?.warn(
        `Sync finished with ${totalErrors} error(s) — keeping the previous snapshot so the next sync retries`,
      );
    }

    // Files neither deleted nor re-indexed: unchanged tree entries plus
    // files whose content hash already matched.
    const unchanged = snapshot.entries.length - toIndex.length;
    const totalSkipped = skipped + unchanged;

    this.logger?.info(
      `Sync complete: ${deleted} deleted, ${indexed} indexed, ` +
      `${totalSkipped} skipped, ${totalErrors} errors`,
    );

    return {
      previousHash,
      currentHash: snapshot.hash,
      deleted,
      indexed,
      skipped: totalSkipped,
      errors: totalErrors,
    };
  }
}
