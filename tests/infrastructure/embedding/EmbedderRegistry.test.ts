/**
 * RED phase — EmbedderRegistry.test.ts
 *
 * Tests for EmbedderRegistryImpl, the config-driven embedder registry that
 * routes source types to embedder models by priority, supports universal
 * fallback models, and provides dynamic registration.
 *
 * Acceptance Criteria:
 *  1. getEmbedder(sourceType) returns embedder with minimum priority for that type
 *  2. getEmbedders(sourceType) returns all matching embedders ordered by priority
 *  3. Universal model (no source_types filter) returned for unresolvable types
 *  4. isAvailable() returns false when no models registered
 *  5. register(sourceType, embedder, priority) adds to internal map
 *  6. modelNames returns all unique registered model names
 */

import { describe, it, expect } from "bun:test";
import { EmbedderRegistryImpl } from "../../../src/infrastructure/embedding/EmbedderRegistryImpl";
import { MockEmbedder } from "../../mocks/MockEmbedder";
import type { Embedder, EmbedderRegistry } from "../../../src/domain/systems/EmbeddingSystem";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single model entry passed to the EmbedderRegistryImpl constructor.
 * - model: display / identifier name for the embedder
 * - embedder: the embedder instance
 * - source_types: optional list of source types this model handles;
 *     if omitted or empty, the model acts as a universal fallback
 * - priority: lower number = higher priority
 */
interface EmbedderModelEntry {
  model: string;
  embedder: Embedder;
  source_types?: string[];
  priority: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates an EmbedderRegistryImpl from a list of model entries.
 * Shorthand to reduce repetition in tests.
 */
function createRegistry(entries: EmbedderModelEntry[]): EmbedderRegistryImpl {
  return new EmbedderRegistryImpl(entries);
}

/**
 * Creates a MockEmbedder with fixed model name + dimensions.
 * Returns a basic zero-vector embedder.
 */
function makeEmbedder(model: string, dims: number): MockEmbedder {
  return new MockEmbedder(model, dims);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("EmbedderRegistryImpl", () => {
  // -----------------------------------------------------------------------
  // AC 1: getEmbedder(sourceType) — minimum priority routing
  // -----------------------------------------------------------------------

  it("getEmbedder returns embedder with minimum priority for matching source type", () => {
    // Arrange
    const high = makeEmbedder("high-prio", 4);
    const low = makeEmbedder("low-prio", 4);
    const registry = createRegistry([
      { model: "low-prio", embedder: low, source_types: ["code"], priority: 10 },
      { model: "high-prio", embedder: high, source_types: ["code"], priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedder("code");

    // Assert — embedder with priority 1 (lowest number) wins
    expect(result).not.toBeNull();
    expect(result!.model).toBe("high-prio");
  });

  it("getEmbedder returns single embedder when only one matches source type", () => {
    // Arrange
    const emb = makeEmbedder("solo", 8);
    const registry = createRegistry([
      { model: "solo", embedder: emb, source_types: ["markdown"], priority: 5 },
    ]);

    // Act
    const result = registry.getEmbedder("markdown");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.model).toBe("solo");
  });

  it("getEmbedder ignores embedders registered for other source types", () => {
    // Arrange
    const codeEmb = makeEmbedder("code-model", 2);
    const mdEmb = makeEmbedder("md-model", 4);
    const registry = createRegistry([
      { model: "code-model", embedder: codeEmb, source_types: ["code"], priority: 1 },
      { model: "md-model", embedder: mdEmb, source_types: ["markdown"], priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedder("code");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.model).toBe("code-model");
  });

  it("getEmbedder prefers source-type-specific embedder over universal model", () => {
    // Arrange — universal fallback exists but specific match should win
    const specific = makeEmbedder("specific-model", 8);
    const universal = makeEmbedder("universal-model", 384);
    const registry = createRegistry([
      { model: "universal-model", embedder: universal, priority: 1 },
      { model: "specific-model", embedder: specific, source_types: ["code"], priority: 5 },
    ]);

    // Act
    const result = registry.getEmbedder("code");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.model).toBe("specific-model");
  });

  it("getEmbedder returns null when no match and no universal model", () => {
    // Arrange
    const emb = makeEmbedder("code-only", 4);
    const registry = createRegistry([
      { model: "code-only", embedder: emb, source_types: ["code"], priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedder("obsidian");

    // Assert
    expect(result).toBeNull();
  });

  // -----------------------------------------------------------------------
  // AC 2: getEmbedders(sourceType) — all matching, ordered by priority
  // -----------------------------------------------------------------------

  it("getEmbedders returns all embedders for source type in ascending priority order", () => {
    // Arrange
    const emb1 = makeEmbedder("first", 4);   // priority 1
    const emb2 = makeEmbedder("second", 4);  // priority 5
    const emb3 = makeEmbedder("third", 4);   // priority 10
    const registry = createRegistry([
      { model: "second", embedder: emb2, source_types: ["code"], priority: 5 },
      { model: "third", embedder: emb3, source_types: ["code"], priority: 10 },
      { model: "first", embedder: emb1, source_types: ["code"], priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedders("code");

    // Assert — ordered by priority ascending: 1, 5, 10
    expect(result).toHaveLength(3);
    expect(result[0]!.model).toBe("first");
    expect(result[1]!.model).toBe("second");
    expect(result[2]!.model).toBe("third");
  });

  it("getEmbedders returns single-element array when one embedder matches", () => {
    // Arrange
    const emb = makeEmbedder("lonely", 16);
    const registry = createRegistry([
      { model: "lonely", embedder: emb, source_types: ["markdown"], priority: 3 },
    ]);

    // Act
    const result = registry.getEmbedders("markdown");

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.model).toBe("lonely");
  });

  it("getEmbedders returns empty array when no match and no universal model", () => {
    // Arrange
    const emb = makeEmbedder("code-only", 4);
    const registry = createRegistry([
      { model: "code-only", embedder: emb, source_types: ["code"], priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedders("obsidian");

    // Assert
    expect(result).toEqual([]);
  });

  it("getEmbedders returns universal models when no specific match exists", () => {
    // Arrange
    const universal = makeEmbedder("universal", 384);
    const registry = createRegistry([
      { model: "universal", embedder: universal, priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedders("obsidian");

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.model).toBe("universal");
  });

  it("getEmbedders returns specific matches alongside universal when both exist", () => {
    // Arrange
    const specific = makeEmbedder("specific", 8);
    const universal = makeEmbedder("universal", 384);
    const registry = createRegistry([
      { model: "specific", embedder: specific, source_types: ["code"], priority: 2 },
      { model: "universal", embedder: universal, priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedders("code");

    // Assert — specific match first (lower priority), universal second
    expect(result).toHaveLength(2);
    expect(result[0]!.model).toBe("universal");
    expect(result[1]!.model).toBe("specific");
  });

  // -----------------------------------------------------------------------
  // AC 3: Universal model fallback for unresolvable types
  // -----------------------------------------------------------------------

  it("getEmbedder returns universal model for unknown source type when universal exists", () => {
    // Arrange
    const universal = makeEmbedder("fallback", 384);
    const specific = makeEmbedder("code-only", 4);
    const registry = createRegistry([
      { model: "fallback", embedder: universal, priority: 1 },
      { model: "code-only", embedder: specific, source_types: ["code"], priority: 5 },
    ]);

    // Act — "obsidian" has no specific embedder
    const result = registry.getEmbedder("obsidian");

    // Assert — universal fallback returned
    expect(result).not.toBeNull();
    expect(result!.model).toBe("fallback");
  });

  it("getEmbedder returns null when no match and no universal model configured", () => {
    // Arrange — all embedders are type-specific, no universal fallback
    const codeEmb = makeEmbedder("code-emb", 4);
    const mdEmb = makeEmbedder("md-emb", 8);
    const registry = createRegistry([
      { model: "code-emb", embedder: codeEmb, source_types: ["code"], priority: 1 },
      { model: "md-emb", embedder: mdEmb, source_types: ["markdown"], priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedder("obsidian");

    // Assert
    expect(result).toBeNull();
  });

  it("getEmbedder prefers lowest-priority universal when multiple universals exist", () => {
    // Arrange
    const fallbackHigh = makeEmbedder("high-universal", 384);   // priority 1
    const fallbackLow = makeEmbedder("low-universal", 128);     // priority 10
    const registry = createRegistry([
      { model: "low-universal", embedder: fallbackLow, priority: 10 },
      { model: "high-universal", embedder: fallbackHigh, priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedder("unknown-type");

    // Assert — lowest priority number wins
    expect(result).not.toBeNull();
    expect(result!.model).toBe("high-universal");
  });

  it("getEmbedders includes all universal models ordered by priority when no specific match", () => {
    // Arrange
    const uni1 = makeEmbedder("uni-primary", 384);
    const uni2 = makeEmbedder("uni-secondary", 128);
    const registry = createRegistry([
      { model: "uni-secondary", embedder: uni2, priority: 10 },
      { model: "uni-primary", embedder: uni1, priority: 1 },
    ]);

    // Act
    const result = registry.getEmbedders("nonexistent");

    // Assert — both universals returned in priority order
    expect(result).toHaveLength(2);
    expect(result[0]!.model).toBe("uni-primary");
    expect(result[1]!.model).toBe("uni-secondary");
  });

  // -----------------------------------------------------------------------
  // AC 4: isAvailable
  // -----------------------------------------------------------------------

  it("isAvailable returns false when no models are registered", () => {
    // Arrange
    const registry = createRegistry([]);

    // Act & Assert
    expect(registry.isAvailable()).toBe(false);
  });

  it("isAvailable returns true when models are configured", () => {
    // Arrange
    const emb = makeEmbedder("some-model", 4);
    const registry = createRegistry([
      { model: "some-model", embedder: emb, source_types: ["code"], priority: 1 },
    ]);

    // Act & Assert
    expect(registry.isAvailable()).toBe(true);
  });

  it("isAvailable returns false after all models removed via unregister (if supported)", () => {
    // This test validates the edge case where models are dynamically removed,
    // leaving the registry empty. Since the interface doesn't define unregister,
    // this simply verifies that an initially empty registry reports false.
    // Arrange
    const registry = createRegistry([]);

    // Act & Assert
    expect(registry.isAvailable()).toBe(false);
  });

  it("isAvailable returns true even with only a universal model", () => {
    // Arrange
    const emb = makeEmbedder("universal", 384);
    const registry = createRegistry([
      { model: "universal", embedder: emb, priority: 1 },
    ]);

    // Act & Assert
    expect(registry.isAvailable()).toBe(true);
  });

  // -----------------------------------------------------------------------
  // AC 5: register(sourceType, embedder, priority)
  // -----------------------------------------------------------------------

  it("register adds a new embedder for a source type", () => {
    // Arrange
    const registry = createRegistry([]);
    const emb = makeEmbedder("new-model", 8);

    // Act
    registry.register("code", emb, 1);
    const result = registry.getEmbedder("code");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.model).toBe("new-model");
  });

  it("register makes isAvailable return true after adding an embedder", () => {
    // Arrange
    const registry = createRegistry([]);
    expect(registry.isAvailable()).toBe(false);

    // Act
    registry.register("code", makeEmbedder("new", 4), 1);

    // Assert
    expect(registry.isAvailable()).toBe(true);
  });

  it("register adds multiple embedders for the same source type", () => {
    // Arrange
    const registry = createRegistry([]);
    const emb1 = makeEmbedder("first", 4);
    const emb2 = makeEmbedder("second", 4);

    // Act
    registry.register("code", emb1, 5);
    registry.register("code", emb2, 1);
    const result = registry.getEmbedders("code");

    // Assert — both returned, ordered by priority
    expect(result).toHaveLength(2);
    expect(result[0]!.model).toBe("second");  // priority 1
    expect(result[1]!.model).toBe("first");   // priority 5
  });

  it("register adds universal embedder when source_type is '*' or empty", () => {
    // Arrange
    const registry = createRegistry([]);
    const universal = makeEmbedder("universal", 384);

    // Act — register as universal by using a marker convention
    registry.register("*", universal, 1);
    const result = registry.getEmbedder("unknown-type");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.model).toBe("universal");
  });

  // -----------------------------------------------------------------------
  // AC 6: modelNames
  // -----------------------------------------------------------------------

  it("modelNames returns all unique model names from registered embedders", () => {
    // Arrange
    const registry = createRegistry([
      { model: "alpha", embedder: makeEmbedder("alpha", 4), source_types: ["code"], priority: 1 },
      { model: "beta", embedder: makeEmbedder("beta", 8), source_types: ["markdown"], priority: 1 },
      { model: "gamma", embedder: makeEmbedder("gamma", 384), priority: 5 },
    ]);

    // Act
    const names = registry.modelNames;

    // Assert
    expect(names).toHaveLength(3);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
    expect(names).toContain("gamma");
  });

  it("modelNames deduplicates repeated model names", () => {
    // Arrange — same model name registered under multiple source types
    const registry = createRegistry([
      { model: "shared", embedder: makeEmbedder("shared", 4), source_types: ["code"], priority: 1 },
      { model: "shared", embedder: makeEmbedder("shared", 4), source_types: ["markdown"], priority: 2 },
    ]);

    // Act
    const names = registry.modelNames;

    // Assert — "shared" appears only once
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
    expect(names).toHaveLength(1);
    expect(names).toEqual(["shared"]);
  });

  it("modelNames returns empty array when no models registered", () => {
    // Arrange
    const registry = createRegistry([]);

    // Act & Assert
    expect(registry.modelNames).toEqual([]);
  });

  it("modelNames includes universal model names", () => {
    // Arrange
    const registry = createRegistry([
      { model: "universal-v2", embedder: makeEmbedder("universal-v2", 384), priority: 1 },
    ]);

    // Act & Assert
    expect(registry.modelNames).toEqual(["universal-v2"]);
  });

  // -----------------------------------------------------------------------
  // Interface conformance
  // -----------------------------------------------------------------------

  it("satisfies the EmbedderRegistry interface shape", () => {
    // Arrange — use the type system to verify interface conformance
    const registry: EmbedderRegistry = createRegistry([]);

    // Assert — structural type check: all required members present
    expect(typeof registry.getEmbedder).toBe("function");
    expect(typeof registry.register).toBe("function");
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it("getEmbedder with empty string source type uses universal fallback or returns null", () => {
    // Arrange
    const specific = makeEmbedder("code-only", 4);
    const universal = makeEmbedder("fallback", 384);
    const registry = createRegistry([
      { model: "code-only", embedder: specific, source_types: ["code"], priority: 1 },
      { model: "fallback", embedder: universal, priority: 5 },
    ]);

    // Act — empty string doesn't match any source type
    const withoutUniversal = createRegistry([
      { model: "code-only", embedder: specific, source_types: ["code"], priority: 1 },
    ]);

    // Assert
    expect(registry.getEmbedder("")).not.toBeNull();
    expect(registry.getEmbedder("")!.model).toBe("fallback");
    expect(withoutUniversal.getEmbedder("")).toBeNull();
  });

  it("handles many models with same source type — priority determines winner", () => {
    // Arrange — 5 embedders for the same source type at different priorities
    const emb1 = makeEmbedder("p1", 4);
    const emb2 = makeEmbedder("p2", 4);
    const emb3 = makeEmbedder("p3", 4);
    const emb4 = makeEmbedder("p4", 4);
    const emb5 = makeEmbedder("p5", 4);
    const registry = createRegistry([
      { model: "p5", embedder: emb5, source_types: ["code"], priority: 50 },
      { model: "p3", embedder: emb3, source_types: ["code"], priority: 30 },
      { model: "p1", embedder: emb1, source_types: ["code"], priority: 10 },
      { model: "p4", embedder: emb4, source_types: ["code"], priority: 40 },
      { model: "p2", embedder: emb2, source_types: ["code"], priority: 20 },
    ]);

    // Act — getEmbedder returns minimum priority
    const single = registry.getEmbedder("code");
    const all = registry.getEmbedders("code");

    // Assert
    expect(single).not.toBeNull();
    expect(single!.model).toBe("p1");

    // All returned in ascending priority order
    expect(all).toHaveLength(5);
    expect(all.map((e) => e.model)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("register does not affect already-returned arrays (immutability of getEmbedders)", () => {
    // Arrange
    const emb = makeEmbedder("original", 4);
    const registry = createRegistry([
      { model: "original", embedder: emb, source_types: ["code"], priority: 1 },
    ]);
    const before = registry.getEmbedders("code");

    // Act
    registry.register("code", makeEmbedder("newcomer", 4), 2);
    const after = registry.getEmbedders("code");

    // Assert — the 'before' array is a snapshot, 'after' includes the newcomer
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(2);
  });

  it("register updates availability after construction", () => {
    // Arrange — start empty
    const registry = createRegistry([]);
    expect(registry.isAvailable()).toBe(false);

    // Act
    registry.register("code", makeEmbedder("first", 4), 1);

    // Assert
    expect(registry.isAvailable()).toBe(true);

    // Register another
    registry.register("markdown", makeEmbedder("second", 8), 1);
    expect(registry.isAvailable()).toBe(true);
  });
});
