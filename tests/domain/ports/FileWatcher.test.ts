import { describe, expect, test } from "bun:test";

import type { FileWatcher } from "../../../src/domain/ports/FileWatcher";

describe("FileWatcher interface", () => {
  test("all methods are present on a mock implementation", () => {
    const mock: FileWatcher = {
      on: (event, cb) => {},
      start: async () => {},
      stop: async () => {},
    };

    expect(typeof mock.on).toBe("function");
    expect(typeof mock.start).toBe("function");
    expect(typeof mock.stop).toBe("function");
  });

  test("on accepts add, change, unlink events", () => {
    const events: string[] = [];
    const mock: FileWatcher = {
      on: (event, cb) => {
        events.push(event);
      },
      start: async () => {},
      stop: async () => {},
    };

    mock.on("add", () => {});
    mock.on("change", () => {});
    mock.on("unlink", () => {});

    expect(events).toEqual(["add", "change", "unlink"]);
  });

  test("start and stop return promises", async () => {
    let started = false;
    let stopped = false;

    const mock: FileWatcher = {
      on: () => {},
      start: async () => {
        started = true;
      },
      stop: async () => {
        stopped = true;
      },
    };

    await mock.start();
    expect(started).toBe(true);

    await mock.stop();
    expect(stopped).toBe(true);
  });

  test("on callback receives file path", () => {
    const handled: string[] = [];
    const mock: FileWatcher = {
      on: (event, cb) => {
        if (event === "add") cb("/new/file.ts");
      },
      start: async () => {},
      stop: async () => {},
    };

    mock.on("add", (path) => {
      handled.push(path);
    });

    expect(handled).toContain("/new/file.ts");
  });
});
