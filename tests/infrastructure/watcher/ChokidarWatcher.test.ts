import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { ChokidarWatcher, createIgnoreMatcher } from "../../../src/infrastructure/watcher/ChokidarWatcher";
import { mkdtempSync, writeFileSync, unlinkSync, realpathSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("ChokidarWatcher", () => {
  let watcher: ChokidarWatcher;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "chokidar-test-")));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("start() / stop() lifecycle works", async () => {
    watcher = new ChokidarWatcher(tmpDir);
    await watcher.start();
    expect(watcher).toBeDefined();
    await watcher.stop();
  });

  test("adding a file emits 'add' event", async () => {
    watcher = new ChokidarWatcher(tmpDir);
    const added: string[] = [];
    watcher.on("add", (p: string) => added.push(p));
    await watcher.start();

    const filePath = join(tmpDir, "new-file.txt");
    writeFileSync(filePath, "hello", "utf-8");

    // Wait for chokidar to detect + debounce
    await new Promise((r) => setTimeout(r, 600));
    await watcher.stop();

    expect(added.length).toBe(1);
    expect(added[0]).toContain("new-file.txt");
  });

  test("changing a file emits 'change' event", async () => {
    watcher = new ChokidarWatcher(tmpDir);
    const changed: string[] = [];
    watcher.on("change", (p: string) => changed.push(p));
    await watcher.start();

    const filePath = join(tmpDir, "change-me.txt");
    writeFileSync(filePath, "v1", "utf-8");
    await new Promise((r) => setTimeout(r, 600));
    writeFileSync(filePath, "v2", "utf-8");
    await new Promise((r) => setTimeout(r, 600));
    await watcher.stop();

    expect(changed.length).toBeGreaterThanOrEqual(1);
    expect(changed.some((p) => p.includes("change-me.txt"))).toBe(true);
  });

  test("deleting a file emits 'unlink' event", async () => {
    watcher = new ChokidarWatcher(tmpDir);
    const unlinked: string[] = [];
    watcher.on("unlink", (p: string) => unlinked.push(p));
    await watcher.start();

    const filePath = join(tmpDir, "delete-me.txt");
    writeFileSync(filePath, "bye", "utf-8");
    await new Promise((r) => setTimeout(r, 1000));
    unlinkSync(filePath);
    await new Promise((r) => setTimeout(r, 1000));
    await watcher.stop();

    expect(unlinked.length).toBeGreaterThanOrEqual(1);
    expect(unlinked.some((p) => p.includes("delete-me.txt"))).toBe(true);
  });

  test("ignore matcher covers dependency and index directories", () => {
    const ignored = createIgnoreMatcher([
      "**/node_modules/**",
      "**/.git/**",
      "**/.indeX/**",
    ]);
    expect(ignored).toBeDefined();
    expect(ignored!("C:/project/node_modules/pkg/index.js")).toBe(true);
    expect(ignored!("C:/project/.git/config")).toBe(true);
    expect(ignored!("C:/project/.indeX/watch.json")).toBe(true);
    expect(ignored!("C:/project/src/index.ts")).toBe(false);
    expect(createIgnoreMatcher([])).toBeUndefined();
  });

  test("debounce fires only once within 500ms for rapid changes", async () => {
    watcher = new ChokidarWatcher(tmpDir, { debounceMs: 500 });
    const changed: string[] = [];
    watcher.on("change", (p: string) => changed.push(p));
    await watcher.start();

    const filePath = join(tmpDir, "rapid-changes.txt");
    writeFileSync(filePath, "v1", "utf-8");
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(filePath, "v2", "utf-8");
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(filePath, "v3", "utf-8");
    await new Promise((r) => setTimeout(r, 700));
    await watcher.stop();

    // Multiple changes within debounce window should coalesce into one event
    expect(changed.length).toBe(1);
  });
});