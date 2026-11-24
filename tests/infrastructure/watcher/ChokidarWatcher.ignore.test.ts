import { describe, expect, test } from "bun:test";
import { ChokidarWatcher } from "../../../src/infrastructure/watcher/ChokidarWatcher";

interface CapturedOptions {
  ignored?: unknown;
}

function makeFactory(captured: CapturedOptions) {
  return ((_paths: unknown, options: CapturedOptions) => {
    captured.ignored = options.ignored;
    const emitter = {
      on(event: string, cb: (...args: unknown[]) => void) {
        if (event === "ready") queueMicrotask(() => cb());
        return emitter;
      },
      async close() {},
    };
    return emitter;
  }) as unknown as typeof import("chokidar").watch;
}

describe("ChokidarWatcher ignore wiring", () => {
  test("passes a predicate instead of glob strings to chokidar", async () => {
    const captured: CapturedOptions = {};
    const watcher = new ChokidarWatcher("/project", {
      ignored: ["**/node_modules/**", "**/.indeX/**"],
      watchFactory: makeFactory(captured),
    });
    await watcher.start();

    expect(typeof captured.ignored).toBe("function");

    const ignored = captured.ignored as (p: string) => boolean;
    expect(ignored("/project/node_modules/pkg/index.js")).toBe(true);
    expect(ignored("/project/.indeX/watch.json")).toBe(true);
    expect(ignored("/project/src/index.ts")).toBe(false);

    await watcher.stop();
  });

  test("omits the ignored option when no patterns are configured", async () => {
    const captured: CapturedOptions = { ignored: "sentinel" };
    const watcher = new ChokidarWatcher("/project", {
      watchFactory: makeFactory(captured),
    });
    await watcher.start();

    expect(captured.ignored).toBeUndefined();

    await watcher.stop();
  });
});
