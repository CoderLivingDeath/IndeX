import { describe, expect, test } from "bun:test";

import type { Logger, LogLevel } from "../../../src/domain/ports/Logger";

describe("Logger interface", () => {
  test("all log methods are present on a mock", () => {
    const mock: Logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    expect(typeof mock.info).toBe("function");
    expect(typeof mock.warn).toBe("function");
    expect(typeof mock.error).toBe("function");
    expect(typeof mock.debug).toBe("function");
  });

  test("each method accepts a message and variadic args", () => {
    const logged: string[] = [];
    const mock: Logger = {
      info: (msg, ...args) => logged.push(`INFO: ${msg} ${args.join(", ")}`),
      warn: (msg, ...args) => logged.push(`WARN: ${msg} ${args.join(", ")}`),
      error: (msg, ...args) => logged.push(`ERROR: ${msg} ${args.join(", ")}`),
      debug: (msg, ...args) => logged.push(`DEBUG: ${msg} ${args.join(", ")}`),
    };

    mock.info("Server started", { port: 3000 });
    mock.warn("Deprecated API", "use v2 instead");
    mock.error("Connection failed", new Error("timeout"));
    mock.debug("Cache hit", "key-123", 0.5);

    expect(logged).toHaveLength(4);
    expect(logged[0]).toContain("INFO: Server started");
    expect(logged[1]).toContain("WARN: Deprecated API");
    expect(logged[2]).toContain("ERROR: Connection failed");
    expect(logged[3]).toContain("DEBUG: Cache hit");
  });

  test("LogLevel type is exported", () => {
    const levels: LogLevel[] = ["info", "warn", "error", "debug"];
    expect(levels).toHaveLength(4);
    expect(levels).toEqual(["info", "warn", "error", "debug"]);
  });

  test("methods return void", () => {
    const mock: Logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    expect(mock.info("test")).toBeUndefined();
    expect(mock.warn("test")).toBeUndefined();
    expect(mock.error("test")).toBeUndefined();
    expect(mock.debug("test")).toBeUndefined();
  });
});
