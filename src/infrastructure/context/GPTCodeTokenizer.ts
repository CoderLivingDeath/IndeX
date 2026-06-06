import { countTokens } from "gpt-tokenizer";
import type { Tokenizer } from "../../domain/systems/ContextPackagingSystem";

/**
 * Tokenizer backed by `gpt-tokenizer` (o200k_base encoding, used by GPT-4o).
 *
 * - `count(text)` returns the exact GPT token count.
 * - `truncate(text, maxTokens)` performs greedy word-safe truncation:
 *   words are added one at a time until the token budget is exceeded,
 *   then the last complete prefix is returned.
 */
export class GPTCodeTokenizer implements Tokenizer {
  async count(text: string): Promise<number> {
    if (text.length === 0) return 0;
    return countTokens(text);
  }

  async truncate(text: string, maxTokens: number): Promise<string> {
    // Edge cases
    if (maxTokens <= 0 || text.length === 0) return "";

    const totalTokens = countTokens(text);
    if (totalTokens <= maxTokens) return text;

    // Greedy word-safe truncation: add words until we hit the budget
    const words = text.split(/(\s+)/);
    let result = "";
    let resultTokens = 0;

    for (const word of words) {
      const candidate = result + word;
      const candidateTokens = countTokens(candidate);

      if (candidateTokens > maxTokens) {
        // Adding this word would exceed the budget — return current prefix
        break;
      }

      result = candidate;
      resultTokens = candidateTokens;
    }

    return result;
  }
}
