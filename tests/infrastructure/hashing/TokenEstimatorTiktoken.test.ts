import { describe, it, expect } from "bun:test";
import { TokenEstimatorTiktoken } from "../../../src/infrastructure/hashing/TokenEstimatorTiktoken";

describe("TokenEstimatorTiktoken", () => {
  const estimator = new TokenEstimatorTiktoken();

  it("model property is set to 'gpt-4'", () => {
    expect(estimator.model).toBe("gpt-4");
  });

  it("estimate('') returns 0", async () => {
    const result = await estimator.estimate("");
    expect(result).toBe(0);
  });

  it("estimate returns reasonable non-negative values", async () => {
    const result = await estimator.estimate("a".repeat(100));
    expect(result).toBeGreaterThanOrEqual(0);
  });
});
