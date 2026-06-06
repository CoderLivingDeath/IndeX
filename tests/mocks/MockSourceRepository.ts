import type { SourceRepository } from "../../src/domain/ports/SourceRepository";
import type { SourceData, SearchQuery, SearchResult, IndexStats } from "../../src/domain/types";
import type { FileIndex } from "../../src/domain/ast";

/**
 * In-memory SourceRepository implementation for unit tests.
 * Uses Map<string, SourceData> for chunk storage and Map<string, FileIndex> for file index storage.
 * All search operations are linear scans — optimized for test correctness, not performance.
 */
export class MockSourceRepository implements SourceRepository {
  private sources = new Map<string, SourceData>();
  private fileIndices = new Map<string, FileIndex>();
  private lastIndexed: string = new Date().toISOString();

  // ── Source CRUD ────────────────────────────────────────────

  async upsert(data: SourceData): Promise<void> {
    this.sources.set(data.id, data);
  }

  async upsertBatch(data: SourceData[]): Promise<void> {
    for (const d of data) {
      this.sources.set(d.id, d);
    }
  }

  async getById(id: string): Promise<SourceData | null> {
    return this.sources.get(id) ?? null;
  }

  async getByPath(path: string): Promise<SourceData[]> {
    const results: SourceData[] = [];
    for (const source of this.sources.values()) {
      if (source.path === path) {
        results.push(source);
      }
    }
    return results;
  }

  async delete(id: string): Promise<void> {
    this.sources.delete(id);
  }

  async deleteByPath(path: string): Promise<void> {
    for (const [id, source] of this.sources.entries()) {
      if (source.path === path) {
        this.sources.delete(id);
      }
    }
  }

  // ── Search ─────────────────────────────────────────────────

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (const source of this.sources.values()) {
      // Filter by source_types if specified
      if (query.source_types && query.source_types.length > 0) {
        if (!query.source_types.includes(source.type)) {
          continue;
        }
      }

      // Compute a mock TF-like score
      const score = this.computeScore(source.content, query.text);
      if (query.min_score !== undefined && score < query.min_score) {
        continue;
      }

      results.push({
        source,
        score,
        match_type: query.mode,
      });
    }

    // Sort by score descending, limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, query.top_k);
  }

  /**
   * Simple TF-like scoring: count of query words that appear in content / total words in content.
   */
  private computeScore(content: string, queryText: string): number {
    if (!queryText) return 0;
    const contentLower = content.toLowerCase();
    const queryWords = queryText.toLowerCase().split(/\s+/).filter(Boolean);
    if (queryWords.length === 0) return 0;
    const contentWords = contentLower.split(/\s+/).filter(Boolean);
    if (contentWords.length === 0) return 0;

    const matches = queryWords.filter((w) => contentLower.includes(w)).length;
    return matches / contentWords.length;
  }

  // ── Hash / Embedding queries ───────────────────────────────

  async hasSemanticBlake3(hash: string): Promise<boolean> {
    for (const source of this.sources.values()) {
      if (source.semantic_blake3 === hash) return true;
    }
    return false;
  }

  async hasModelEmbedding(id: string): Promise<boolean> {
    const source = this.sources.get(id);
    if (!source) return false;
    return source.embeddings.length > 0;
  }

  async getSourceIdsByHash(hash: string): Promise<string[]> {
    const ids: string[] = [];
    for (const source of this.sources.values()) {
      if (source.semantic_blake3 === hash) {
        ids.push(source.source_id);
      }
    }
    return ids;
  }

  async getFileBlake3ByPath(path: string): Promise<string | null> {
    for (const source of this.sources.values()) {
      if (source.path === path) return source.file_blake3;
    }
    return null;
  }

  // ── Stats ──────────────────────────────────────────────────

  async stats(): Promise<IndexStats> {
    const uniquePaths = new Set<string>();
    for (const source of this.sources.values()) {
      uniquePaths.add(source.path);
    }
    return {
      total_sources: uniquePaths.size,
      total_chunks: this.sources.size,
      total_files: uniquePaths.size,
      last_indexed: this.lastIndexed,
    };
  }

  // ── File Index CRUD ────────────────────────────────────────

  async upsertFileIndex(index: FileIndex): Promise<void> {
    this.fileIndices.set(index.path, index);
  }

  async getFileIndex(path: string): Promise<FileIndex | null> {
    return this.fileIndices.get(path) ?? null;
  }

  async deleteFileIndex(path: string): Promise<void> {
    this.fileIndices.delete(path);
  }

  // ── Cleanup ────────────────────────────────────────────────

  async dropAll(): Promise<void> {
    this.sources.clear();
    this.fileIndices.clear();
  }
}
