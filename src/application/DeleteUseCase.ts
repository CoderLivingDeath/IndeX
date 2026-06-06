// ---------------------------------------------------------------------------
// DeleteUseCase — Phase 9
//
// Removes indexed data by file path via SourceRepository.deleteByPath.
// ---------------------------------------------------------------------------

import type { SourceRepository } from "../domain/ports/SourceRepository";

/**
 * Application-level use case for deleting indexed data by path.
 */
export class DeleteUseCase {
  constructor(private readonly repo: SourceRepository) {}

  /**
   * Remove all indexed chunks for the given file `path`.
   *
   * @param path - File path whose indexed data should be removed.
   */
  async execute(path: string): Promise<void> {
    await this.repo.deleteByPath(path);
  }
}