// ---------------------------------------------------------------------------
// Semantic search integration — real in-memory LanceDB + cosine scoring
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeEach } from "bun:test";

import type { Embedder, Embedding } from "../../src/domain/systems/EmbeddingSystem";
import type { SourceData } from "../../src/domain/types";
import { LanceDbSourceRepository } from "../../src/infrastructure/lancedb/LanceDbSourceRepository";
import { SearchService } from "../../src/domain/services/SearchService";
import { SearchUseCase } from "../../src/application/SearchUseCase";

function makeSource(
  id: string,
  path: string,
  content: string,
  embeddings: number[],
): SourceData {
  const now = new Date().toISOString();
  return {
    id,
    chunk_id: id,
    source_id: `src-${id}`,
    type: "code",
    title: path,
    content,
    tags: [],
    path,
    file_blake3: `file-${id}`,
    semantic_blake3: `sem-${id}`,
    chunk_index: 0,
    total_chunks: 1,
    embeddings,
    metadata: { kind: "code", language: "typescript" },
    created_at: now,
    updated_at: now,
  };
}

class FixedEmbedder implements Embedder {
  readonly model = "fixed";
  readonly dimensions = 3;
  calls = 0;

  constructor(private readonly vector: number[]) {}

  async embed(_text: string): Promise<Embedding> {
    this.calls++;
    return {
      vector: this.vector,
      model: this.model,
      dimensions: this.dimensions,
      tokens_in: 1,
    };
  }

  async embedBatch(texts: string[]): Promise<Embedding[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

describe("semantic search (LanceDB memory)", () => {
  let repo: LanceDbSourceRepository;
  let embedder: FixedEmbedder;
  let useCase: SearchUseCase;

  beforeEach(async () => {
    repo = new LanceDbSourceRepository("memory://");
    await repo.upsertBatch([
      makeSource("alpha", "/alpha.ts", "alpha document about indexing", [1, 0, 0]),
      makeSource("beta", "/beta.ts", "beta document about cooking", [0, 1, 0]),
    ]);

    embedder = new FixedEmbedder([1, 0, 0]);
    const ranker = new SearchService(repo, { hybrid_weight: 0.7 });
    useCase = new SearchUseCase({ embedder, ranker, logger });
  });

  test("semantic mode returns the vector-similar document", async () => {
    const results = await useCase.execute("anything", { mode: "semantic", top_k: 5 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.source.path).toBe("/alpha.ts");
    expect(results[0]!.score).toBeGreaterThan(0.9);
    expect(embedder.calls).toBe(1);
  });

  test("hybrid mode combines vector and keyword legs", async () => {
    const results = await useCase.execute("indexing", { mode: "hybrid", top_k: 5 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.source.path).toBe("/alpha.ts");
    expect(results[0]!.match_type).toBe("hybrid");
    expect(results[0]!.score).toBeGreaterThan(0);
    expect(embedder.calls).toBe(1);
  });

  test("semantic results are ordered by similarity", async () => {
    const results = await useCase.execute("anything", { mode: "semantic", top_k: 5 });

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });
});
