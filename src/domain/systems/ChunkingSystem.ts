import type { SourceType } from "../types";

/**
 * A single chunk produced by a chunker.
 */
export interface Chunk {
  content: string;
  core_content: string;
  chunk_index: number;
  total_chunks: number;
  strategy: string;
  size_tokens: number;
}

/**
 * A chunker capable of splitting text for a specific SourceType.
 */
export interface Chunker {
  chunk(text: string): Promise<Chunk[]>;
  readonly type: SourceType;
}

/**
 * A pipeline that dispatches text to the appropriate chunker by type.
 */
export interface ChunkerPipeline {
  chunkers: Chunker[];
  chunk(text: string, type: SourceType): Promise<Chunk[]>;
}
