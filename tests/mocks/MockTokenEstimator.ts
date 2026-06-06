import type { TokenEstimator } from "../../src/domain/systems/HashingSystem";

/**
 * A mock token estimator that returns a fixed token count.
 * Useful for predictable testing of chunker token-boundary logic.
 */
export class MockTokenEstimator implements TokenEstimator {
  readonly model = "mock";

  constructor(private readonly count: number) {}

  async estimate(_text: string): Promise<number> {
    return this.count;
  }
}
