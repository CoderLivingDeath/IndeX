import type { TokenEstimator } from "../../domain/systems/HashingSystem";

/**
 * A simple token estimator that counts bytes and divides by 4.
 * Provides a rough estimate without needing a model-specific tokenizer.
 */
export class TokenEstimatorSimple implements TokenEstimator {
  readonly model = "simple-byte-estimate";

  async estimate(text: string): Promise<number> {
    if (text.length === 0) return 0;
    return Math.ceil(text.length / 4);
  }
}
