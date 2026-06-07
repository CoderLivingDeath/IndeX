import pino from "pino";
import type { Logger } from "../../domain/ports/Logger";

export interface PinoLoggerOptions {
  level?: string;
  module?: string;
  pretty?: boolean;
}

/**
 * Logger implementation using pino for structured JSON logging.
 * When `pretty` is true, uses pino-pretty for human-readable output.
 */
export class PinoLogger implements Logger {
  private logger: pino.Logger;

  constructor(
    opts: PinoLoggerOptions = {},
    destination?: pino.DestinationStream,
  ) {
    const { level = "info", module, pretty = false } = opts;
    const base = module ? { module } : {};

    const stream = destination ?? (pretty
      ? pino.transport({
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
        })
      : undefined);

    this.logger = pino(
      { level, base, ...(stream ? {} : {}) },
      stream ?? undefined,
    );
  }

  info(msg: string, ...args: unknown[]): void {
    if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
      this.logger.info(args[0] as Record<string, unknown>, msg);
    } else {
      this.logger.info(msg);
    }
  }

  warn(msg: string, ...args: unknown[]): void {
    if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
      this.logger.warn(args[0] as Record<string, unknown>, msg);
    } else {
      this.logger.warn(msg);
    }
  }

  error(msg: string, ...args: unknown[]): void {
    if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
      this.logger.error(args[0] as Record<string, unknown>, msg);
    } else {
      this.logger.error(msg);
    }
  }

  debug(msg: string, ...args: unknown[]): void {
    if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
      this.logger.debug(args[0] as Record<string, unknown>, msg);
    } else {
      this.logger.debug(msg);
    }
  }

  child(context: Record<string, unknown>): PinoLogger {
    const child = new PinoLogger({ pretty: true }, this.logger.stream);
    // @ts-expect-error - accessing internal pino logger for child creation
    child.logger = this.logger.child(context);
    return child;
  }
}