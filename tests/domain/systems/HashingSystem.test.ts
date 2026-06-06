import { describe, expect, test } from "bun:test";

import type { Hasher, TokenEstimator } from "../../../src/domain/systems/HashingSystem";

describe("Hasher interface", () => {
  test("all members are present", () => {
    const hasher: Hasher = {
      algorithm: "blake3",
      hash: async (data) => {
        if (typeof data === "string") return `hash:${data}`;
        return "hash:binary";
      },
    };

    expect(typeof hasher.hash).toBe("function");
    expect(hasher.algorithm).toBe("blake3");
  });

  test("hash accepts string", async () => {
    const hasher: Hasher = {
      algorithm: "blake3",
      hash: async (data) => `hash-${typeof data === "string" ? data : "binary"}`,
    };

    const result = await hasher.hash("hello world");
    expect(typeof result).toBe("string");
    expect(result).toContain("hello world");
  });

  test("hash accepts Uint8Array", async () => {
    const hasher: Hasher = {
      algorithm: "sha256",
      hash: async (data) => {
        if (data instanceof Uint8Array) {
          return Array.from(data)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        }
        return "string-hash";
      },
    };

    const input = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
    const result = await hasher.hash(input);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("hash returns a string", async () => {
    const hasher: Hasher = {
      algorithm: "blake3",
      hash: async () => "abc123def456",
    };

    const result = await hasher.hash("data");
    expect(typeof result).toBe("string");
    expect(result).toBe("abc123def456");
  });
});

describe("TokenEstimator interface", () => {
  test("all members are present", () => {
    const estimator: TokenEstimator = {
      model: "gpt-4",
      estimate: async (text) => Math.ceil(text.length / 4),
    };

    expect(typeof estimator.estimate).toBe("function");
    expect(estimator.model).toBe("gpt-4");
  });

  test("estimate returns a number", async () => {
    const estimator: TokenEstimator = {
      model: "claude-3",
      estimate: async (text) => text.split(" ").length,
    };

    const result = await estimator.estimate("one two three four five");
    expect(typeof result).toBe("number");
    expect(result).toBe(5);
  });

  test("empty text returns 0", async () => {
    const estimator: TokenEstimator = {
      model: "gpt-4o",
      estimate: async (text) => (text.length === 0 ? 0 : Math.ceil(text.length / 4)),
    };

    const result = await estimator.estimate("");
    expect(result).toBe(0);
  });
});
