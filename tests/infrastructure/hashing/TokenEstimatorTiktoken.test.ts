import { describe, it, expect, beforeEach } from "bun:test";
import { TokenEstimatorTiktoken } from "../../../src/infrastructure/hashing/TokenEstimatorTiktoken";
import { TokenEstimatorSimple } from "../../../src/infrastructure/hashing/TokenEstimatorSimple";

describe("TokenEstimatorTiktoken", () => {
  let estimator: TokenEstimatorTiktoken;
  let simple: TokenEstimatorSimple;

  beforeEach(() => {
    estimator = new TokenEstimatorTiktoken();
    simple = new TokenEstimatorSimple();
  });

  it("model property is set to 'gpt-4'", () => {
    expect(estimator.model).toBe("gpt-4");
  });

  it("estimate('') returns 0", async () => {
    const result = await estimator.estimate("");
    expect(result).toBe(0);
  });

  it("estimate falls back to Simple estimator when gpt-tokenizer is unavailable", async () => {
    const result = await estimator.estimate("hello world");
    const fallback = await simple.estimate("hello world");
    expect(result).toBe(fallback);
  });

  it("estimate returns reasonable non-negative values", async () => {
    const result = await estimator.estimate("a".repeat(100));
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it("empty text returns 0 from fallback", async () => {
    const result = await estimator.estimate("");
    expect(result).toBe(0);
  });
});
