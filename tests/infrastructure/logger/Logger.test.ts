import { describe, expect, test, afterEach } from "bun:test";
import { PinoLogger } from "../../../src/infrastructure/logger/PinoLogger";
import { SilentLogger } from "../../../src/infrastructure/logger/SilentLogger";
import type { Logger } from "../../../src/domain/ports/Logger";

describe("PinoLogger", () => {
  let logs: unknown[] = [];
  const transport = {
    write: (obj: unknown) => {
      logs.push(obj);
    },
  };

  afterEach(() => {
    logs = [];
  });

  test("info logs structured JSON output", () => {
    const logger = new PinoLogger(
      { level: "info", module: "test" },
      transport as any
    );
    logger.info("hello world");

    expect(logs.length).toBe(1);
    const entry = JSON.parse(logs[0] as string);
    expect(entry.msg).toBe("hello world");
    expect(entry.level).toBe(30); // pino info level
    expect(entry.module).toBe("test");
  });

  test("warn logs structured JSON output", () => {
    const logger = new PinoLogger(
      { level: "warn", module: "test" },
      transport as any
    );
    logger.warn("warning message");

    expect(logs.length).toBe(1);
    const entry = JSON.parse(logs[0] as string);
    expect(entry.msg).toBe("warning message");
    expect(entry.level).toBe(40); // pino warn level
  });

  test("error logs structured JSON output", () => {
    const logger = new PinoLogger(
      { level: "error", module: "test" },
      transport as any
    );
    logger.error("error message");

    expect(logs.length).toBe(1);
    const entry = JSON.parse(logs[0] as string);
    expect(entry.msg).toBe("error message");
    expect(entry.level).toBe(50); // pino error level
  });

  test("debug logs structured JSON output", () => {
    const logger = new PinoLogger(
      { level: "debug", module: "test" },
      transport as any
    );
    logger.debug("debug message");

    expect(logs.length).toBe(1);
    const entry = JSON.parse(logs[0] as string);
    expect(entry.msg).toBe("debug message");
    expect(entry.level).toBe(20); // pino debug level
  });

  test("child() adds context to output", () => {
    const logger = new PinoLogger(
      { level: "info", module: "parent" },
      transport as any
    );
    const child = logger.child({ requestId: "abc-123" });
    child.info("child message");

    expect(logs.length).toBe(1);
    const entry = JSON.parse(logs[0] as string);
    expect(entry.msg).toBe("child message");
    expect(entry.module).toBe("parent");
    expect(entry.requestId).toBe("abc-123");
  });

  test("info with extra args includes them in log", () => {
    const logger = new PinoLogger(
      { level: "info", module: "test" },
      transport as any
    );
    logger.info("user login", { userId: 42 });

    expect(logs.length).toBe(1);
    const entry = JSON.parse(logs[0] as string);
    expect(entry.msg).toBe("user login");
    expect(entry.userId).toBe(42);
  });
});

describe("SilentLogger", () => {
  let logger: Logger;

  test("info produces no output", () => {
    logger = new SilentLogger();
    // Should not throw
    expect(() => logger.info("test")).not.toThrow();
  });

  test("warn produces no output", () => {
    logger = new SilentLogger();
    expect(() => logger.warn("test")).not.toThrow();
  });

  test("error produces no output", () => {
    logger = new SilentLogger();
    expect(() => logger.error("test")).not.toThrow();
  });

  test("debug produces no output", () => {
    logger = new SilentLogger();
    expect(() => logger.debug("test")).not.toThrow();
  });
});
