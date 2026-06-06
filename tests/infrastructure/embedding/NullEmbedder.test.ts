/**
 * RED phase — NullEmbedder.test.ts
 *
 * Tests for the null embedder that always throws.
 * NullEmbedder implements Embedder interface and always throws
 * "no embedder available" on any call to embed().
 *
 * Acceptance Criteria:
 *  1. embed() always throws an error
 *  2. Error message includes "no embedder available"
 *  3. model and dimensions properties exist (return "null" or "0")
 */

import { describe, it, expect } from "bun:test";
import { NullEmbedder } from "../../../src/infrastructure/embedding/NullEmbedder";
import type { Embedder } from "../../../src/domain/systems/EmbeddingSystem";

// ---------------------------------------------------------------------------
// NullEmbedder
// ---------------------------------------------------------------------------
describe("NullEmbedder", () => {
  // -----------------------------------------------------------------------
  // AC 1 & 2: embed() always throws with matching message
  // -----------------------------------------------------------------------
  it("embed rejects with 'no embedder available'", async () => {
    // Arrange
    const embedder = new NullEmbedder();

    // Act & Assert
    await expect(embedder.embed("anything")).rejects.toThrow("no embedder available");
  });

  it("embed rejects for empty string input", async () => {
    // Arrange
    const embedder = new NullEmbedder();

    // Act & Assert
    await expect(embedder.embed("")).rejects.toThrow("no embedder available");
  });

  it("embed rejects for special character input", async () => {
    // Arrange
    const embedder = new NullEmbedder();

    // Act & Assert
    await expect(embedder.embed("!@#$%^&*()_+\n\t\r")).rejects.toThrow("no embedder available");
  });

  it("embed rejects consistently on multiple calls", async () => {
    // Arrange
    const embedder = new NullEmbedder();

    // Act & Assert — first call
    await expect(embedder.embed("first")).rejects.toThrow("no embedder available");

    // Assert — second call (consistency)
    await expect(embedder.embed("second")).rejects.toThrow("no embedder available");

    // Assert — third call
    await expect(embedder.embed("third")).rejects.toThrow("no embedder available");
  });

  it("embed error message includes exactly 'no embedder available'", async () => {
    // Arrange
    const embedder = new NullEmbedder();

    // Act & Assert — verify the full error message
    await expect(embedder.embed("test")).rejects.toThrow("no embedder available");
  });

  // -----------------------------------------------------------------------
  // AC 3: model and dimensions properties
  // -----------------------------------------------------------------------
  it("exposes model as a readonly property returning 'null'", () => {
    // Arrange
    const embedder = new NullEmbedder();

    // Act & Assert
    expect(embedder.model).toBe("null");
  });

  it("exposes dimensions as a readonly property returning 0", () => {
    // Arrange
    const embedder = new NullEmbedder();

    // Act & Assert
    expect(embedder.dimensions).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Interface conformance
  // -----------------------------------------------------------------------
  it("satisfies the Embedder interface shape", () => {
    // Arrange
    const embedder: Embedder = new NullEmbedder();

    // Act & Assert — structural type check: all required members present
    expect(typeof embedder.embed).toBe("function");
    expect(typeof embedder.model).toBe("string");
    expect(typeof embedder.dimensions).toBe("number");
  });
});
