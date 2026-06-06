import type { Tokenizer } from "../../src/domain/systems/ContextPackagingSystem";

/**
 * A mock tokenizer that splits by whitespace (1 token ≈ 1 word).
 * Deterministic and dependency-free — suitable for tests.
 */
export class MockTokenizer implements Tokenizer {
  private readonly tokensPerWord: number;

  constructor(tokensPerWord = 1) {
    this.tokensPerWord = tokensPerWord;
  }

  async count(text: string): Promise<number> {
    if (!text || text.trim().length === 0) return 0;
    const words = text.trim().split(/\s+/).length;
    return words * this.tokensPerWord;
  }

  async truncate(text: string, maxTokens: number): Promise<string> {
    if (maxTokens <= 0) return "";
    const words = text.split(/\s+/);
    const maxWords = Math.floor(maxTokens / this.tokensPerWord);
    if (words.length <= maxWords) return text;
    return words.slice(0, maxWords).join(" ");
  }
}
