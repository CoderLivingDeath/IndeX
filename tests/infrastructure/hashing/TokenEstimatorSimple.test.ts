import { describe, it, expect } from "bun:test";
import { TokenEstimatorSimple } from "../../../src/infrastructure/hashing/TokenEstimatorSimple";

describe("TokenEstimatorSimple", () => {
  const estimator = new TokenEstimatorSimple();

  it("estimate('hello') returns 2 (Math.ceil(5/4))", async () => {
    const result = await estimator.estimate("hello");
    expect(result).toBe(2);
  });

  it("estimate('') returns 0", async () => {
    const result = await estimator.estimate("");
    expect(result).toBe(0);
  });

  it("estimate('a'.repeat(100)) returns 25 (Math.ceil(100/4))", async () => {
    const result = await estimator.estimate("a".repeat(100));
    expect(result).toBe(25);
  });

  it("estimate('a'.repeat(3)) returns 1 (Math.ceil(3/4))", async () => {
    const result = await estimator.estimate("a".repeat(3));
    expect(result).toBe(1);
  });

  it("estimate('a'.repeat(4)) returns 1 (Math.ceil(4/4))", async () => {
    const result = await estimator.estimate("a".repeat(4));
    expect(result).toBe(1);
  });

  it("model property is 'simple-byte-estimate'", () => {
    expect(estimator.model).toBe("simple-byte-estimate");
  });
});
