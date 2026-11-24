/**
 * RED phase — MultiModelEmbedder.test.ts
 *
 * Tests for the parallel multi-model embedder.
 * MultiModelEmbedder is NOT an Embedder. It returns `Record<string, Embedding>`
 * (not a single Embedding) by running all inner embedders in parallel via
 * Promise.allSettled and tolerating partial failures.
 *
 * Acceptance Criteria:
 *  1. embedAll() calls all embedders in parallel
 *  2. Returns Record<string, Embedding> (NOT single Embedding)
 *  3. Promise.allSettled resilience: one failure doesn't break others
 *  4. Partial results returned when some embedders fail
 */

import { describe, it, expect } from "bun:test";
import { MultiModelEmbedder } from "../../../src/infrastructure/embedding/MultiModelEmbedder";
import type { Embedder, Embedding } from "../../../src/domain/systems/EmbeddingSystem";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a simple inline mock embedder that resolves with a fixed vector.
 * @param model   Model name / identifier
 * @param dimensions  Dimensionality of the returned vector
 * @param delay   Optional artificial delay (ms) to simulate async work
 */
function createSuccessEmbedder(
  model: string,
  dimensions: number,
  delay = 0,
): Embedder {
  return {
    model,
    dimensions,
    embed: async (text: string): Promise<Embedding> => {
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
      return {
        vector: Array.from({ length: dimensions }, (_, i) => i + 1),
        model,
        dimensions,
        tokens_in: text.split(/\s+/).filter(Boolean).length,
      };
    },
    embedBatch: async (texts: string[]): Promise<Embedding[]> =>
      Promise.all(texts.map(async (text) => {
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        return {
          vector: Array.from({ length: dimensions }, (_, i) => i + 1),
          model,
          dimensions,
          tokens_in: text.split(/\s+/).filter(Boolean).length,
        };
      })),
  };
}

/**
 * Creates a mock embedder that always rejects with a given error message.
 */
function createFailingEmbedder(
  model: string,
  dimensions: number,
  message = "embedder failure",
): Embedder {
  return {
    model,
    dimensions,
    embed: async (_text: string): Promise<Embedding> => {
      throw new Error(message);
    },
    embedBatch: async (): Promise<Embedding[]> => {
      throw new Error(message);
    },
  };
}

/**
 * Creates a mock embedder that records every call for later inspection.
 */
function createSpyEmbedder(
  model: string,
  dimensions: number,
  calls: Array<{ text: string; timestamp: number }>,
): Embedder {
  return {
    model,
    dimensions,
    embed: async (text: string): Promise<Embedding> => {
      calls.push({ text, timestamp: Date.now() });
      return {
        vector: Array.from({ length: dimensions }, (_, i) => i),
        model,
        dimensions,
        tokens_in: text.length,
      };
    },
    embedBatch: async (texts: string[]): Promise<Embedding[]> =>
      Promise.all(texts.map(async (text) => {
        calls.push({ text, timestamp: Date.now() });
        return {
          vector: Array.from({ length: dimensions }, (_, i) => i),
          model,
          dimensions,
          tokens_in: text.length,
        };
      })),
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("MultiModelEmbedder", () => {
  // -----------------------------------------------------------------------
  // AC 1: Returns Record<string, Embedding>
  // -----------------------------------------------------------------------
  it("embedAll returns Record<string, Embedding> with correct shape", async () => {
    // Arrange
    const embedders: Record<string, Embedder> = {
      "model-alpha": createSuccessEmbedder("model-alpha", 4),
      "model-beta": createSuccessEmbedder("model-beta", 8),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act
    const result = await multi.embedAll("hello world");

    // Assert — record has expected keys
    expect(result).toBeTruthy();
    expect(typeof result).toBe("object");
    expect(Object.keys(result).sort()).toEqual(["model-alpha", "model-beta"]);

    // Assert — each value is a valid Embedding
    for (const [model, emb] of Object.entries(result)) {
      expect(emb).toHaveProperty("vector");
      expect(emb).toHaveProperty("model");
      expect(emb).toHaveProperty("dimensions");
      expect(emb).toHaveProperty("tokens_in");

      expect(emb.model).toBe(model);
      expect(Array.isArray(emb.vector)).toBe(true);
      expect(typeof emb.dimensions).toBe("number");
      expect(typeof emb.tokens_in).toBe("number");
    }
  });

  it("embedAll returns Embedding values (not a single Embedding)", async () => {
    // Arrange
    const embedders: Record<string, Embedder> = {
      m1: createSuccessEmbedder("m1", 3),
      m2: createSuccessEmbedder("m2", 3),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act
    const result = await multi.embedAll("test");

    // Assert — result is a Record, not an Embedding
    // If someone mistakenly returns an Embedding, it will NOT have both
    // keys as model names AND Embedding fields on the same level.
    expect(result.m1).toBeTruthy();
    expect(result.m1!.vector).toBeDefined();
    expect(result.m2).toBeTruthy();
    expect(result.m2!.vector).toBeDefined();

    // Confirm it's NOT a single Embedding (no top-level vector)
    expect((result as unknown as Embedding).vector).toBeUndefined();
  });

  it("embedAll returns vector arrays with correct dimensions", async () => {
    // Arrange
    const embedders: Record<string, Embedder> = {
      small: createSuccessEmbedder("small", 2),
      large: createSuccessEmbedder("large", 384),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act
    const result = await multi.embedAll("dimensional check");

    // Assert
    expect(result.small!.vector).toHaveLength(2);
    expect(result.small!.dimensions).toBe(2);
    expect(result.large!.vector).toHaveLength(384);
    expect(result.large!.dimensions).toBe(384);
  });

  // -----------------------------------------------------------------------
  // AC 2 (parallel behaviour via timing)
  // -----------------------------------------------------------------------
  it("calls all embedders in parallel (not sequentially)", async () => {
    // Arrange — two embedders each with 50 ms artificial delay
    const embedders: Record<string, Embedder> = {
      slow1: createSuccessEmbedder("slow1", 4, 50),
      slow2: createSuccessEmbedder("slow2", 4, 50),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act — measure elapsed time
    const start = performance.now();
    const result = await multi.embedAll("parallel test");
    const elapsed = performance.now() - start;

    // Assert — if run sequentially it would take ~100 ms;
    // in parallel it should take ~50 ms (with some tolerance for scheduling).
    // We allow up to 75 ms to account for event-loop overhead.
    expect(elapsed).toBeLessThan(90);
    expect(Object.keys(result).length).toBe(2);
  });

  it("calls each embedder with the correct text", async () => {
    // Arrange
    const calls1: Array<{ text: string; timestamp: number }> = [];
    const calls2: Array<{ text: string; timestamp: number }> = [];
    const embedders: Record<string, Embedder> = {
      spy1: createSpyEmbedder("spy1", 2, calls1),
      spy2: createSpyEmbedder("spy2", 2, calls2),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act
    await multi.embedAll("specific input text");

    // Assert
    expect(calls1).toHaveLength(1);
    expect(calls1[0]!.text).toBe("specific input text");
    expect(calls2).toHaveLength(1);
    expect(calls2[0]!.text).toBe("specific input text");
  });

  // -----------------------------------------------------------------------
  // AC 3 & 4: Promise.allSettled — partial failure resilience
  // -----------------------------------------------------------------------
  it("tolerates a single failing embedder and returns partial results", async () => {
    // Arrange
    const embedders: Record<string, Embedder> = {
      good: createSuccessEmbedder("good", 4),
      bad: createFailingEmbedder("bad", 4, "oops"),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act — should NOT throw
    const result = await multi.embedAll("partial failure");

    // Assert — only the successful embedder's result is present
    expect(result.good).toBeDefined();
    expect(result.good!.model).toBe("good");
    expect(result.good!.vector).toHaveLength(4);

    // The failing embedder should be absent
    expect(result.bad).toBeUndefined();
  });

  it("tolerates multiple failing embedders (only successes returned)", async () => {
    // Arrange — 2 good, 2 bad
    const embedders: Record<string, Embedder> = {
      good1: createSuccessEmbedder("good1", 2),
      bad1: createFailingEmbedder("bad1", 2),
      good2: createSuccessEmbedder("good2", 4),
      bad2: createFailingEmbedder("bad2", 4),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act
    const result = await multi.embedAll("two good two bad");

    // Assert
    expect(result.good1).toBeDefined();
    expect(result.good2).toBeDefined();
    expect(result.bad1).toBeUndefined();
    expect(result.bad2).toBeUndefined();
    expect(Object.keys(result).length).toBe(2);
  });

  it("returns an empty record when all embedders fail", async () => {
    // Arrange
    const embedders: Record<string, Embedder> = {
      fail1: createFailingEmbedder("fail1", 4),
      fail2: createFailingEmbedder("fail2", 8),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act — should NOT throw despite all failing
    const result = await multi.embedAll("all fail");

    // Assert
    expect(result).toEqual({});
  });

  it("succeeds for all embedders when none fail", async () => {
    // Arrange
    const embedders: Record<string, Embedder> = {
      a: createSuccessEmbedder("a", 2),
      b: createSuccessEmbedder("b", 3),
      c: createSuccessEmbedder("c", 4),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act
    const result = await multi.embedAll("all good");

    // Assert
    expect(Object.keys(result).length).toBe(3);
    expect(result.a).toBeDefined();
    expect(result.b).toBeDefined();
    expect(result.c).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  it("returns empty record when no embedders are configured", async () => {
    // Arrange
    const multi = new MultiModelEmbedder({});

    // Act
    const result = await multi.embedAll("empty");

    // Assert
    expect(result).toEqual({});
  });

  it("handles a single embedder gracefully", async () => {
    // Arrange
    const embedders: Record<string, Embedder> = {
      solo: createSuccessEmbedder("solo", 1),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act
    const result = await multi.embedAll("solo artist");

    // Assert
    expect(Object.keys(result).length).toBe(1);
    expect(result.solo!.model).toBe("solo");
    expect(result.solo!.vector).toHaveLength(1);
    expect(result.solo!.tokens_in).toBe(2); // two words
  });

  it("passes empty string to each embedder", async () => {
    // Arrange
    const calls1: Array<{ text: string; timestamp: number }> = [];
    const calls2: Array<{ text: string; timestamp: number }> = [];
    const embedders: Record<string, Embedder> = {
      spy1: createSpyEmbedder("spy1", 2, calls1),
      spy2: createSpyEmbedder("spy2", 2, calls2),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act
    const result = await multi.embedAll("");

    // Assert
    expect(calls1[0]!.text).toBe("");
    expect(calls2[0]!.text).toBe("");
    expect(Object.keys(result).length).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Type safety: Record key contract
  // -----------------------------------------------------------------------
  it("uses embedder model names as result keys", async () => {
    // Arrange — model name differs from record key
    const embedders: Record<string, Embedder> = {
      key1: createSuccessEmbedder("actual-model-a", 2),
      key2: createSuccessEmbedder("actual-model-b", 4),
    };
    const multi = new MultiModelEmbedder(embedders);

    // Act
    const result = await multi.embedAll("key contract");

    // Assert — keys match the record keys (key1, key2), not the inner model names
    expect(Object.keys(result).sort()).toEqual(["key1", "key2"]);
    expect(result.key1!.model).toBe("actual-model-a");
    expect(result.key2!.model).toBe("actual-model-b");
  });
});
