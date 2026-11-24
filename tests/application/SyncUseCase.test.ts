// ---------------------------------------------------------------------------
// SyncUseCase — snapshot, prune, failure-safety, idempotency
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { FileFilter } from "../../src/domain/ports/FileFilter";
import type { DiffIndexingService } from "../../src/domain/services/DiffIndexingService";
import type { SourceData } from "../../src/domain/types";
import { SyncUseCase } from "../../src/application/SyncUseCase";
import { MockHasher } from "../mocks/MockHasher";
import { MockSourceRepository } from "../mocks/MockSourceRepository";

const SNAPSHOT_HASH_KEY = "tree_snapshot_hash";

const filter: FileFilter = {
  formats: [".ts"],
  shouldInclude: (p) => p.endsWith(".ts"),
};

class FakeDiffService {
  calls: string[] = [];
  failures = new Set<string>();

  async diffIndexFile(path: string) {
    this.calls.push(path);
    if (this.failures.has(path)) {
      return { indexed: 0, skipped: 0, errors: 1 };
    }
    return { indexed: 1, skipped: 0, errors: 0 };
  }
}

function makeSource(id: string, path: string): SourceData {
  const now = new Date().toISOString();
  return {
    id,
    chunk_id: id,
    source_id: `src-${id}`,
    type: "code",
    title: path,
    content: "content",
    tags: [],
    path,
    file_blake3: `file-${id}`,
    semantic_blake3: `sem-${id}`,
    chunk_index: 0,
    total_chunks: 1,
    embeddings: [],
    metadata: { kind: "code", language: "typescript" },
    created_at: now,
    updated_at: now,
  };
}

function touchInFuture(path: string): void {
  const future = new Date(Date.now() + 5000);
  utimesSync(path, future, future);
}

describe("SyncUseCase", () => {
  let dir: string;
  let repo: MockSourceRepository;
  let diff: FakeDiffService;
  let sync: SyncUseCase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sync-test-"));
    repo = new MockSourceRepository();
    diff = new FakeDiffService();
    sync = new SyncUseCase(
      repo,
      diff as unknown as DiffIndexingService,
      new MockHasher(),
      filter,
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("first sync indexes all files and stores a snapshot", async () => {
    writeFileSync(join(dir, "a.ts"), "a", "utf-8");
    writeFileSync(join(dir, "b.ts"), "b", "utf-8");

    const result = await sync.execute(dir);

    expect(result.previousHash).toBeNull();
    expect(result.indexed).toBe(2);
    expect(diff.calls).toHaveLength(2);
    expect(await repo.getDbMeta(SNAPSHOT_HASH_KEY)).toBe(result.currentHash);
  });

  test("unchanged tree is a no-op", async () => {
    writeFileSync(join(dir, "a.ts"), "a", "utf-8");
    await sync.execute(dir);
    diff.calls = [];

    const result = await sync.execute(dir);

    expect(result.indexed).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(0);
    expect(diff.calls).toHaveLength(0);
  });

  test("prunes paths that no longer exist on disk", async () => {
    writeFileSync(join(dir, "keep.ts"), "keep", "utf-8");
    const stalePath = join(dir, "stale.ts");
    await repo.upsert(makeSource("stale", stalePath));
    await repo.upsert(makeSource("keep", join(dir, "keep.ts")));

    const result = await sync.execute(dir);

    expect(result.deleted).toBe(1);
    expect(await repo.getByPath(stalePath)).toHaveLength(0);
  });

  test("reindexes files whose mtime changed", async () => {
    const filePath = join(dir, "a.ts");
    writeFileSync(filePath, "v1", "utf-8");
    await sync.execute(dir);
    diff.calls = [];

    writeFileSync(filePath, "v2", "utf-8");
    touchInFuture(filePath);

    const result = await sync.execute(dir);

    expect(result.indexed).toBe(1);
    expect(diff.calls).toEqual([filePath]);
  });

  test("keeps the previous snapshot when indexing fails", async () => {
    const aPath = join(dir, "a.ts");
    const bPath = join(dir, "b.ts");
    writeFileSync(aPath, "a1", "utf-8");
    writeFileSync(bPath, "b1", "utf-8");

    await sync.execute(dir);
    const goodHash = await repo.getDbMeta(SNAPSHOT_HASH_KEY);

    // Change both files, but make one fail.
    writeFileSync(aPath, "a2", "utf-8");
    writeFileSync(bPath, "b2", "utf-8");
    touchInFuture(aPath);
    touchInFuture(bPath);
    diff.failures.add(bPath);

    const failed = await sync.execute(dir);

    expect(failed.errors).toBeGreaterThan(0);
    expect(await repo.getDbMeta(SNAPSHOT_HASH_KEY)).toBe(goodHash);
  });

  test("retries files missed by a failed pass", async () => {
    const aPath = join(dir, "a.ts");
    const bPath = join(dir, "b.ts");
    writeFileSync(aPath, "a1", "utf-8");
    writeFileSync(bPath, "b1", "utf-8");

    await sync.execute(dir);

    writeFileSync(aPath, "a2", "utf-8");
    writeFileSync(bPath, "b2", "utf-8");
    touchInFuture(aPath);
    touchInFuture(bPath);

    diff.failures.add(bPath);
    await sync.execute(dir);

    diff.failures.clear();
    diff.calls = [];
    const retry = await sync.execute(dir);

    expect(retry.errors).toBe(0);
    expect(diff.calls).toContain(bPath);
  });

  test("repeated successful sync is idempotent", async () => {
    writeFileSync(join(dir, "a.ts"), "a", "utf-8");
    const first = await sync.execute(dir);
    const second = await sync.execute(dir);

    expect(second.previousHash).toBe(first.currentHash);
    expect(second.currentHash).toBe(first.currentHash);
    expect(second.indexed).toBe(0);
    expect(second.deleted).toBe(0);
  });
});
