// ---------------------------------------------------------------------------
// WatchUseCase — Phase 9
//
// Wraps a FileWatcher and wires file system events to DiffIndexingService.
// ---------------------------------------------------------------------------

import type { FileWatcher } from "../domain/ports/FileWatcher";
import type { Logger } from "../domain/ports/Logger";
import type { SourceRepository } from "../domain/ports/SourceRepository";
import { DiffIndexingService } from "../domain/services/DiffIndexingService";

/**
 * Application-level use case for watching a directory and running
 * diff indexing on file changes.
 */
export class WatchUseCase {
  private directory: string = "";

  constructor(
    private readonly watcher: FileWatcher,
    private readonly diffService: DiffIndexingService,
    private readonly logger: Logger,
    private readonly repo: SourceRepository,
  ) {}

  /**
   * Start watching `directory` for file changes.
   *
   * @param directory - Path to the directory to watch.
   */
  async execute(directory: string): Promise<void> {
    this.directory = directory;
    this.logger.info(`Watching ${directory}`);

    this.watcher.on("add", (path: string) => {
      this.logger.info(`File added: ${path}`);
      this.diffService.diffIndexFile(path).catch((err) => {
        this.logger.error(`Diff indexing error: ${err}`);
      });
    });

    this.watcher.on("change", (path: string) => {
      this.logger.info(`File changed: ${path}`);
      this.diffService.diffIndexFile(path).catch((err) => {
        this.logger.error(`Diff indexing error: ${err}`);
      });
    });

    this.watcher.on("unlink", async (path: string) => {
      this.logger.info(`File removed: ${path}`);
      try {
        await this.repo.deleteByPath(path);
        await this.repo.deleteFileIndex(path);
      } catch (err) {
        this.logger.error(`Failed to remove ${path} from index: ${err}`);
      }
    });

    await this.watcher.start();
    this.logger.info(`Watcher started for ${directory}`);
  }

  /**
   * Stop watching.
   */
  async stop(): Promise<void> {
    this.logger.info("Stopping watcher");
    await this.watcher.stop();
  }
}