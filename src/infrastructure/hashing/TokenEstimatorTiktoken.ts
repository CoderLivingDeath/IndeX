import type { TokenEstimator } from "../../domain/systems/HashingSystem";
import { TokenEstimatorSimple } from "./TokenEstimatorSimple";

/**
 * Token estimator that attempts to use `gpt-tokenizer` for accurate GPT-4 token counts.
 * Falls back to TokenEstimatorSimple (byte-division) if gpt-tokenizer is unavailable.
 */
export class TokenEstimatorTiktoken implements TokenEstimator {
  readonly model = "gpt-4";
  private fallback: TokenEstimatorSimple;

  constructor() {
    this.fallback = new TokenEstimatorSimple();
  }

  async estimate(text: string): Promise<number> {
    try {
      const { encode } = await import("gpt-tokenizer");
      return encode(text).length;
    } catch {
      return this.fallback.estimate(text);
    }
  }
}
