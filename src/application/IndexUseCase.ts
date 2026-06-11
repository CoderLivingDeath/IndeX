// ---------------------------------------------------------------------------
// IndexUseCase — Phase 9
//
// Orchestrates the full indexing pipeline via IndexingService.
// Accepts an IndexSystems DI bundle that provides all required dependencies.
// ---------------------------------------------------------------------------

import type { IndexSystems } from "./di/Systems";
import type { IndexStats } from "../domain/types";
import { IndexingService } from "../domain/services/IndexingService";

/**
 * Application-level use case for indexing a directory of source files.
 *
 * delegates to `IndexingService` with the dependencies injected through
 * the `IndexSystems` group interface.
 */
export class IndexUseCase {
  constructor(private readonly systems: IndexSystems) {}

  /**
   * Index all files under `directory`.
   *
   * @param directory - Path to the root directory to index.
   * @returns Aggregate stats for the indexed files.
   */
  async execute(directory: string): Promise<IndexStats> {
    this.systems.logger.info(`Indexing ${directory}`);

    const service = new IndexingService(
      this.systems.fileFilter,
      this.systems.parserRegistry,
      this.systems.chunker,
      this.systems.embedderRegistry,
      this.systems.repo,
      this.systems.hasher,
      this.systems.logger,
    );

    const stats = await service.index(directory);

    // Update database metadata
    await this.systems.repo.setDbMeta("last_indexed", stats.last_indexed);
    await this.systems.repo.setDbMeta("total_files", stats.total_files);
    await this.systems.repo.setDbMeta("total_chunks", stats.total_chunks);
    await this.systems.repo.setDbMeta("total_tokens", stats.total_tokens);

    return stats;
  }
}
