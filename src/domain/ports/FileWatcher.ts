/**
 * File system watcher that emits add / change / unlink events.
 */
export interface FileWatcher {
  on(event: "add" | "change" | "unlink", cb: (path: string) => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
