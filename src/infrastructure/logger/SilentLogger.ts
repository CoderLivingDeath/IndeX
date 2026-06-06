import type { Logger } from "../../domain/ports/Logger";

/**
 * Logger implementation that discards all output.
 * Useful for testing or disabling logging entirely.
 */
export class SilentLogger implements Logger {
  info(_msg: string, ..._args: unknown[]): void {
    // no-op
  }

  warn(_msg: string, ..._args: unknown[]): void {
    // no-op
  }

  error(_msg: string, ..._args: unknown[]): void {
    // no-op
  }

  debug(_msg: string, ..._args: unknown[]): void {
    // no-op
  }
}
