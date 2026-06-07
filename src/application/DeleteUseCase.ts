// ---------------------------------------------------------------------------
// DeleteUseCase — Phase 9
//
// Removes indexed data by file path via SourceRepository.deleteByPath.
// Clears entire index via SourceRepository.dropAll.
// ---------------------------------------------------------------------------

import type { SourceRepository } from "../domain/ports/SourceRepository";
import type { SourceData, IndexStats } from "../domain/types";

/**
 * Application-level use case for deleting indexed data.
 */
export class DeleteUseCase {
  constructor(private readonly repo: SourceRepository) {}

  /**
   * Remove all indexed chunks for the given file `path`.
   */
  async execute(path: string): Promise<void> {
    await this.repo.deleteByPath(path);
  }

  /**
   * Clear the entire index (drop all data and start fresh).
   */
  async clear(): Promise<void> {
    await this.repo.dropAll();
  }

  /**
   * Return aggregate index statistics.
   */
  async stats(): Promise<IndexStats> {
    return this.repo.stats();
  }

  /**
   * Get all chunks belonging to a source (by source_id).
   */
  async getSourceChunks(sourceId: string): Promise<SourceData[]> {
    return this.repo.getBySourceId(sourceId);
  }

  /**
   * Get all chunks for a file path.
   */
  async getPathChunks(path: string): Promise<SourceData[]> {
    return this.repo.getByPath(path);
  }
}