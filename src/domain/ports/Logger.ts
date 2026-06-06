/**
 * Log severity levels.
 */
export type LogLevel = "info" | "warn" | "error" | "debug";

/**
 * Structured logger interface.
 */
export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}
