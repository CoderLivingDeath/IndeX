import { watch } from "chokidar";
import type { FileWatcher } from "../../domain/ports/FileWatcher";

export interface ChokidarWatcherOptions {
  /** Debounce interval in milliseconds (default: 500). */
  debounceMs?: number;
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

  constructor(paths: string | string[], options?: ChokidarWatcherOptions) {
    this.paths = Array.isArray(paths) ? paths : [paths];
    this.debounceMs = options?.debounceMs ?? 500;
  }

  on(event: "add" | "change" | "unlink", cb: (path: string) => void): void {
    this.handlers[event].add(cb);
  }

  async start(): Promise<void> {
    if (this.watcher) return;

    this.watcher = watch(this.paths, {
      ignoreInitial: true,
      persistent: true,
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