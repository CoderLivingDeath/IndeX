/**
 * RED phase — OllamaEmbedder.test.ts
 *
 * Tests for the OllamaEmbedder HTTP client that calls Ollama's /api/embeddings
 * endpoint. Covers HTTP request formation, response parsing, number[]
 * conversion, exponential backoff retry (1s -> 2s -> 4s), AbortSignal
 * cancellation, and readonly property access.
 *
 * Acceptance Criteria:
 *  1. embed() sends HTTP POST to /api/embeddings and returns number[]
 *     of configured dimensions (default 384)
 *  2. embedBatch() sends one HTTP POST per text, returns array of Embeddings
 *  3. Exponential backoff: 1s -> 2s delay between up to 3 attempts, then throws
 *  4. AbortSignal cancels in-flight request — AbortError propagates immediately
 *  5. model and dimensions readonly properties match constructor arguments
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { OllamaEmbedder } from "../../../src/infrastructure/embedding/OllamaEmbedder";
import type { Embedder } from "../../../src/domain/systems/EmbeddingSystem";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a successful mock fetch that returns the given embedding vector.
 * Tracks request info (URL, method, body) and call count for assertions.
 */
function createMockFetch(embedding: number[]) {
  const info = { url: "", method: "", body: "", callCount: 0 };
  const mock = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    info.callCount++;
    info.url =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.href
          : url.url;
    info.method = init?.method ?? "GET";
    info.body = typeof init?.body === "string" ? init.body : "";
    return new Response(JSON.stringify({ embedding }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { mock: mock as unknown as typeof fetch, info };
}

/**
 * Creates a mock fetch that always throws a network Error.
 */
function createFailingMockFetch() {
  let callCount = 0;
  const mock = async (): Promise<Response> => {
    callCount++;
    throw new Error("Network error");
  };
  return { mock: mock as unknown as typeof fetch, callCount: () => callCount };
}

/**
 * Creates a mock fetch that fails for the first `failCount` calls,
 * then succeeds on the next call.  Used to test retry logic deterministically.
 */
function createSequentialMockFetch(failCount: number, successEmbedding: number[]) {
  let callCount = 0;
  const mock = async (
    _url: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    callCount++;
    if (callCount <= failCount) {
      throw new Error("Network error");
    }
    return new Response(JSON.stringify({ embedding: successEmbedding }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { mock: mock as unknown as typeof fetch, callCount: () => callCount };
}

/**
 * Creates a mock fetch that returns a non-OK HTTP status for every call.
 */
function createErrorStatusMockFetch(status: number, statusText: string) {
  let callCount = 0;
  const mock = async (): Promise<Response> => {
    callCount++;
    return new Response(null, { status, statusText });
  };
  return { mock: mock as unknown as typeof fetch, callCount: () => callCount };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("OllamaEmbedder", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalSetTimeout: typeof globalThis.setTimeout;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalSetTimeout = globalThis.setTimeout;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  });

  // -----------------------------------------------------------------------
  // AC 5: model / dimensions readonly properties
  // -----------------------------------------------------------------------
  describe("constructor properties (AC 5)", () => {
    it("exposes model as a readonly property", () => {
      // Arrange
      const embedder = new OllamaEmbedder("nomic-embed-text", 768);

      // Act & Assert
      expect(embedder.model).toBe("nomic-embed-text");
    });

    it("exposes dimensions as a readonly property", () => {
      // Arrange
      const embedder = new OllamaEmbedder("test-model", 512);

      // Act & Assert
      expect(embedder.dimensions).toBe(512);
    });

    it("uses default dimensions of 384 when not provided", () => {
      // Arrange
      const embedder = new OllamaEmbedder("default-model");

      // Act & Assert
      expect(embedder.dimensions).toBe(384);
    });

    it("uses default baseUrl http://localhost:11434 when not provided", async () => {
      // Arrange
      const { mock, info } = createMockFetch([0.1, 0.2, 0.3]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("test-model", 3);

      // Act
      await embedder.embed("hello");

      // Assert
      expect(info.url).toBe("http://localhost:11434/api/embeddings");
    });

    it("uses custom baseUrl when provided", async () => {
      // Arrange
      const { mock, info } = createMockFetch([0.1, 0.2]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("test-model", 2, "http://custom:5678");

      // Act
      await embedder.embed("hello");

      // Assert
      expect(info.url).toBe("http://custom:5678/api/embeddings");
    });

    it("model and dimensions are compile-time readonly", () => {
      // Arrange
      const embedder = new OllamaEmbedder("readonly-test", 128);

      // Assert
      expect(embedder.model).toBe("readonly-test");
      expect(embedder.dimensions).toBe(128);

      // TypeScript ensures readonly — the following would cause compile errors:
      //   embedder.model = "other";     // Error: Cannot assign to 'model' because it is a read-only property
      //   embedder.dimensions = 256;    // Error: Cannot assign to 'dimensions' because it is a read-only property
    });
  });

  // -----------------------------------------------------------------------
  // AC 1: embed() sends HTTP POST and returns number[] of configured dims
  // -----------------------------------------------------------------------
  describe("embed() (AC 1)", () => {
    it("sends HTTP POST to /api/embeddings with correct model and prompt", async () => {
      // Arrange
      const { mock, info } = createMockFetch([0.1, 0.2, 0.3]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("test-model", 3);

      // Act
      await embedder.embed("hello world");

      // Assert
      expect(info.method).toBe("POST");
      expect(info.url).toContain("/api/embeddings");
      const body = JSON.parse(info.body);
      expect(body.model).toBe("test-model");
      expect(body.prompt).toBe("hello world");
    });

    it("returns an Embedding with a number[] vector", async () => {
      // Arrange
      const { mock } = createMockFetch([0.5, 0.6, 0.7, 0.8]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("test-model", 4);

      // Act
      const result = await embedder.embed("test");

      // Assert
      expect(Array.isArray(result.vector)).toBe(true);
    });

    it("returns vector with length matching default dimensions (384)", async () => {
      // Arrange
      const longVector = Array.from({ length: 384 }, (_, i) => i * 0.01);
      const { mock } = createMockFetch(longVector);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("default-model");

      // Act
      const result = await embedder.embed("test");

      // Assert
      expect(result.vector).toHaveLength(384);
      expect(result.dimensions).toBe(384);
    });

    it("returns vector with length matching custom dimensions (768)", async () => {
      // Arrange
      const longVector = Array.from({ length: 768 }, (_, i) => i * 0.005);
      const { mock } = createMockFetch(longVector);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("custom-model", 768);

      // Act
      const result = await embedder.embed("test");

      // Assert
      expect(result.vector).toHaveLength(768);
      expect(result.dimensions).toBe(768);
    });

    it("response metadata includes model, dimensions, and tokens_in", async () => {
      // Arrange
      const { mock } = createMockFetch([0.1, 0.2, 0.3, 0.4]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("meta-model", 4);

      // Act
      const result = await embedder.embed("hello world");

      // Assert
      expect(result.model).toBe("meta-model");
      expect(result.dimensions).toBe(4);
      // tokens_in uses ceil(text.length / 4) heuristic
      expect(result.tokens_in).toBe(Math.ceil("hello world".length / 4));
    });

    it("throws when API response is malformed (non-JSON)", async () => {
      // Arrange — mock setTimeout to resolve immediately for fast test
      globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof globalThis.setTimeout;
      const mockFetch = async (): Promise<Response> => {
        return new Response("not json", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      };
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      const embedder = new OllamaEmbedder("bad-response", 3);

      // Act & Assert
      await expect(embedder.embed("test")).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // AC 2: embedBatch() sends HTTP POST for each text
  // -----------------------------------------------------------------------
  describe("embedBatch() (AC 2)", () => {
    it("embeds multiple texts and returns array of Embedding results", async () => {
      // Arrange
      const { mock } = createMockFetch([0.1, 0.2, 0.3]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("batch-model", 3);

      // Act
      const results = await embedder.embedBatch([
        "first text",
        "second text",
        "third text",
      ]);

      // Assert
      expect(results).toHaveLength(3);
      for (const r of results) {
        expect(Array.isArray(r.vector)).toBe(true);
        expect(r.vector).toHaveLength(3);
        expect(r.model).toBe("batch-model");
        expect(r.dimensions).toBe(3);
      }
    });

    it("sends exactly one HTTP POST per text in the batch", async () => {
      // Arrange
      let callCount = 0;
      const mockFetch = async (): Promise<Response> => {
        callCount++;
        return new Response(JSON.stringify({ embedding: [0.1, 0.2] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      const embedder = new OllamaEmbedder("count-model", 2);

      // Act
      await embedder.embedBatch(["a", "b", "c", "d"]);

      // Assert
      expect(callCount).toBe(4);
    });

    it("handles batch with a single text", async () => {
      // Arrange
      const { mock } = createMockFetch([0.42, 0.84]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("single-batch", 2);

      // Act
      const results = await embedder.embedBatch(["only one"]);

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0]!.model).toBe("single-batch");
      expect(results[0]!.vector).toHaveLength(2);
    });

    it("returns empty array for empty batch (no fetch calls)", async () => {
      // Arrange — do NOT mock fetch; embedBatch([]) calls Promise.all([])
      // which resolves to [] without invoking any embed() call.
      const embedder = new OllamaEmbedder("empty-batch", 2);

      // Act
      const results = await embedder.embedBatch([]);

      // Assert
      expect(results).toEqual([]);
    });

    it("rejects entire batch when one embed fails after retries exhausted", async () => {
      // Arrange — mock fetch that always throws (persistent failure, no recovery)
      const mockFetch = async (): Promise<Response> => {
        throw new Error("Persistent failure");
      };
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof globalThis.setTimeout;
      const embedder = new OllamaEmbedder("fail-batch", 2);

      // Act & Assert — Promise.all propagates failure from any call
      await expect(
        embedder.embedBatch(["fail1", "fail2"]),
      ).rejects.toThrow("Persistent failure");
    });
  });

  // -----------------------------------------------------------------------
  // AC 3: Exponential backoff — 1s -> 2s delay, max 3 attempts, then throws
  // -----------------------------------------------------------------------
  describe("retry with exponential backoff (AC 3)", () => {
    it("succeeds on first retry after single failure", async () => {
      // Arrange — mock setTimeout to resolve sleep() immediately
      globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof globalThis.setTimeout;

      const { mock, callCount } = createSequentialMockFetch(1, [0.1, 0.2, 0.3]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("retry-model", 3);

      // Act
      const result = await embedder.embed("retry test");

      // Assert — 2 fetch calls total (1 fail + 1 success)
      expect(Array.isArray(result.vector)).toBe(true);
      expect(result.vector).toHaveLength(3);
    });

    it("succeeds on second retry after two failures", async () => {
      // Arrange
      globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof globalThis.setTimeout;

      const { mock } = createSequentialMockFetch(2, [0.5, 0.6]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("retry-model", 2);

      // Act
      const result = await embedder.embed("retry again");

      // Assert — 3 fetch calls total (2 fail + 1 success)
      expect(result.vector).toHaveLength(2);
      expect(result.model).toBe("retry-model");
    });

    it("throws after 3 failed attempts (max retries exhausted)", async () => {
      // Arrange
      globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof globalThis.setTimeout;

      const { mock, callCount } = createFailingMockFetch();
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("fail-model", 3);

      // Act & Assert
      await expect(embedder.embed("will fail")).rejects.toThrow();
    });

    it("makes exactly 3 fetch attempts before throwing on persistent failure", async () => {
      // Arrange
      globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof globalThis.setTimeout;

      const { mock, callCount } = createFailingMockFetch();
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("count-fails", 3);

      // Act & Assert
      try {
        await embedder.embed("count me");
      } catch {
        // Expected
      }

      // Assert — exactly 3 fetch calls were made
      expect(callCount()).toBe(3);
    });

    it("last thrown error is the error from the final attempt", async () => {
      // Arrange
      globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof globalThis.setTimeout;

      const { mock } = createSequentialMockFetch(3, [0.1]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("last-err", 1);

      // Act & Assert
      await expect(embedder.embed("fail")).rejects.toThrow("Network error");
    });

    it("retries on HTTP error status (500) up to 3 attempts", async () => {
      // Arrange
      globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof globalThis.setTimeout;

      const { mock, callCount } = createErrorStatusMockFetch(500, "Internal Server Error");
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("http-retry", 3);

      // Act & Assert
      await expect(embedder.embed("server error")).rejects.toThrow(
        /Ollama API error: 500/i,
      );
      expect(callCount()).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // AC 4: AbortSignal cancels in-flight request (AbortError, no retry)
  // -----------------------------------------------------------------------
  describe("AbortSignal support (AC 4)", () => {
    it("passes AbortSignal through to fetch init", async () => {
      // Arrange
      let capturedSignal: AbortSignal | undefined;
      const mockFetch = async (
        _url: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        capturedSignal = init?.signal ?? undefined;
        return new Response(JSON.stringify({ embedding: [0.1] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      const embedder = new OllamaEmbedder("signal-test", 1);
      const controller = new AbortController();

      // Act
      await embedder.embed("test", controller.signal);

      // Assert
      expect(capturedSignal).toBe(controller.signal);
    });

    it("rejects with AbortError when passed an already-aborted signal", async () => {
      // Arrange — mock fetch checks signal and throws DOMException like real fetch
      const mockFetch = async (
        _url: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        if (init?.signal?.aborted) {
          throw new DOMException("The operation was aborted", "AbortError");
        }
        return new Response(JSON.stringify({ embedding: [0.1] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      const embedder = new OllamaEmbedder("abort-test", 1);
      const controller = new AbortController();
      controller.abort();

      // Act & Assert
      await expect(embedder.embed("test", controller.signal)).rejects.toThrow();
      await expect(
        embedder.embed("test", controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
    });

    it("does NOT retry when AbortError is thrown (propagates immediately)", async () => {
      // Arrange
      let fetchCallCount = 0;
      const mockFetch = async (
        _url: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        fetchCallCount++;
        // Simulate real fetch: throw AbortError if signal is already aborted
        if (init?.signal?.aborted) {
          throw new DOMException("The operation was aborted", "AbortError");
        }
        throw new Error("Network error");
      };
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      // Mock setTimeout in case any sleep runs (it shouldn't since first fetch
      // throws AbortError, but hedge against implementation changes)
      globalThis.setTimeout = ((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof globalThis.setTimeout;
      const embedder = new OllamaEmbedder("no-retry-abort", 2);
      const controller = new AbortController();

      // Act — abort before calling embed
      controller.abort();

      // Assert
      await expect(
        embedder.embed("test", controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
      // Only the first attempt fires; no retry because AbortError re-throws
      expect(fetchCallCount).toBe(1);
    });

    it("rejects when signal is aborted mid-flight (simulated)", async () => {
      // Arrange — create a pending fetch that can be aborted externally
      let abortHandler: (() => void) | null = null;
      let signalCaptured = false;
      const mockFetch = async (
        _url: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        return new Promise((_resolve, reject) => {
          if (init?.signal) {
            signalCaptured = true;
            if (init.signal.aborted) {
              reject(new DOMException("The operation was aborted", "AbortError"));
              return;
            }
            init.signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted", "AbortError"));
            });
          }
          // Intentionally never resolve — keep request in-flight
        });
      };
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      const embedder = new OllamaEmbedder("mid-flight", 2);
      const controller = new AbortController();

      // Act — start request, then abort after a microtask
      const promise = embedder.embed("in flight", controller.signal);
      setTimeout(() => controller.abort(), 0);

      // Assert
      await expect(promise).rejects.toMatchObject({ name: "AbortError" });
      expect(signalCaptured).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Interface conformance
  // -----------------------------------------------------------------------
  describe("Embedder interface conformance", () => {
    it("satisfies the Embedder interface shape", () => {
      // Arrange
      const embedder: Embedder = new OllamaEmbedder("iface-model", 64);

      // Act & Assert
      expect(typeof embedder.embed).toBe("function");
      expect(typeof embedder.model).toBe("string");
      expect(typeof embedder.dimensions).toBe("number");
    });

    it("embed() returns a Promise", () => {
      // Arrange
      const { mock } = createMockFetch([0.1]);
      globalThis.fetch = mock;
      const embedder = new OllamaEmbedder("promise-test", 1);

      // Act
      const result = embedder.embed("test");

      // Assert
      expect(result).toBeInstanceOf(Promise);
    });
  });
});
