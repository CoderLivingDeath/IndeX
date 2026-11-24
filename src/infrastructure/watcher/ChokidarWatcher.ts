import { watch } from "chokidar";
import type { FileWatcher } from "../../domain/ports/FileWatcher";
import { matchesAny } from "../../shared/globMatcher";

/**
 * Build a chokidar-compatible ignore predicate from glob patterns.
 *
 * chokidar 4+ removed glob support, so resolving glob strings itself would
 * silently ignore nothing. The predicate keeps the project's glob syntax
 * while matching chokidar's current API.
 */
export function createIgnoreMatcher(
  patterns: string[],
): ((path: string) => boolean) | undefined {
  if (patterns.length === 0) return undefined;
  return (path: string) => matchesAny(patterns, path);
}

export interface ChokidarWatcherOptions {
  /** Debounce interval in milliseconds (default: 500). */
  debounceMs?: number;
  /** Glob patterns to ignore (translated to a chokidar predicate). */
  ignored?: string[];
  /** Injectable watch factory (tests only). */
  watchFactory?: typeof watch;
}

/**
 * FileWatcher implementation using chokidar with per-path debounced emission.
 */
export class ChokidarWatcher implements FileWatcher {
  private watcher: ReturnType<typeof watch> | null = null;
  private handlers = {
    add: new Set<(path: string) => void>(),
    change: new Set<(path: string) => void>(),
    unlink: new Set<(path: string) => void>(),
  };
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly debounceMs: number;
  private readonly paths: string[];
  private readonly ignored: string[];
  private readonly watchFactory: typeof watch;

  constructor(paths: string | string[], options?: ChokidarWatcherOptions) {
    this.paths = Array.isArray(paths) ? paths : [paths];
    this.debounceMs = options?.debounceMs ?? 500;
    this.ignored = options?.ignored ?? [];
    this.watchFactory = options?.watchFactory ?? watch;
  }

  on(event: "add" | "change" | "unlink", cb: (path: string) => void): void {
    this.handlers[event].add(cb);
  }

  async start(): Promise<void> {
    if (this.watcher) return;

    const ignored = createIgnoreMatcher(this.ignored);
    this.watcher = this.watchFactory(this.paths, {
      ignoreInitial: true,
      persistent: true,
      ...(ignored ? { ignored } : {}),
    });

    return new Promise<void>((resolve) => {
      if (!this.watcher) { resolve(); return; }

      this.watcher.on("ready", () => resolve());

      this.watcher.on("add", (path: string) => {
        this.debounceEmit("add", path);
      });
      this.watcher.on("change", (path: string) => {
        this.debounceEmit("change", path);
      });
      this.watcher.on("unlink", (path: string) => {
        this.debounceEmit("unlink", path);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.watcher) return;

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    await this.watcher.close();
    this.watcher = null;
  }

  private debounceEmit(event: "add" | "change" | "unlink", path: string): void {
    const key = `${event}:${path}`;
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      for (const cb of this.handlers[event]) {
        cb(path);
      }
    }, this.debounceMs);

    this.debounceTimers.set(key, timer);
  }
}