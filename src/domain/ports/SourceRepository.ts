import type { SourceData, SearchQuery, SearchResult, IndexStats } from "../types";
import type { FileIndex } from "../ast";

/**
 * Repository for persisting and querying indexed source data.
 */
export interface SourceRepository {
  upsert(data: SourceData): Promise<void>;
  upsertBatch(data: SourceData[]): Promise<void>;
  getById(id: string): Promise<SourceData | null>;
  getByPath(path: string): Promise<SourceData[]>;
  getBySourceId(sourceId: string): Promise<SourceData[]>;
  delete(id: string): Promise<void>;
  deleteByPath(path: string): Promise<void>;
  search(query: SearchQuery): Promise<SearchResult[]>;
  hasSemanticBlake3(hash: string): Promise<boolean>;
  hasModelEmbedding(id: string): Promise<boolean>;
  getSourceIdsByHash(hash: string): Promise<string[]>;
  getFileBlake3ByPath(path: string): Promise<string | null>;
  stats(): Promise<IndexStats>;
  upsertFileIndex(index: FileIndex): Promise<void>;
  getFileIndex(path: string): Promise<FileIndex | null>;
  deleteFileIndex(path: string): Promise<void>;
  dropAll(): Promise<void>;
}
