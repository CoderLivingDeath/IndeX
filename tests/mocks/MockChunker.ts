import type { Chunk, Chunker } from "../../src/domain/systems/ChunkingSystem";
import type { SourceType } from "../../src/domain/types";

/**
 * A mock chunker that returns a pre-configured array of chunks.
 * Useful for testing chunker pipeline logic without real chunking.
 */
export class MockChunker implements Chunker {
  readonly type: SourceType = "generic";

  constructor(private readonly chunks: Chunk[]) {}

  async chunk(_text: string): Promise<Chunk[]> {
    return this.chunks;
  }
}
