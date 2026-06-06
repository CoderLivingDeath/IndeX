import { describe, it, expect } from "bun:test";
import { GPTCodeTokenizer } from "../../../src/infrastructure/context/GPTCodeTokenizer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a word of the given length by repeating a letter. */
function word(length: number): string {
  return "x".repeat(length);
}

/** Build a sentence with `count` words, each 5 chars long. */
function sentence(wordCount: number): string {
  return Array.from({ length: wordCount }, (_, i) => word(5)).join(" ");
}

/** A long-ish passage with enough tokens for truncation tests. */
const LONG_TEXT = [
  "The quick brown fox jumps over the lazy dog near the bank of the river.",
  "This is a longer paragraph that contains multiple sentences and should produce enough tokens for meaningful truncation testing with the GPT tokenizer.",
  "We need to ensure that the truncation algorithm handles boundaries correctly and does not split words in the middle.",
  "Tokenization is a critical part of preparing context for large language models and must be handled with care.",
  "The GPTCodeTokenizer should count tokens accurately using the gpt-tokenizer library and truncate text at word boundaries.",
  "This ensures that when we pack context for LLM queries, we never exceed the model's context window limit.",
].join("\n\n");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GPTCodeTokenizer", () => {
  const tokenizer = new GPTCodeTokenizer();

  // -----------------------------------------------------------------------
  // count()
  // -----------------------------------------------------------------------

  it("count(\"hello world\") returns a positive number > 0", async () => {
    const n = await tokenizer.count("hello world");
    expect(n).toBeGreaterThan(0);
  });

  it('count("") returns 0 for empty string', async () => {
    const n = await tokenizer.count("");
    expect(n).toBe(0);
  });

  it("count returns larger number for longer text", async () => {
    const short = await tokenizer.count("short text");
    const long = await tokenizer.count(LONG_TEXT);
    expect(long).toBeGreaterThan(short);
  });

  // -----------------------------------------------------------------------
  // truncate()
  // -----------------------------------------------------------------------

  it("truncate(text, 50) returns text at approximately 50 tokens (within ~20%)", async () => {
    const result = await tokenizer.truncate(LONG_TEXT, 50);
    const tokenCount = await tokenizer.count(result);

    // Allow 20% margin: between 40 and 60 tokens
    expect(tokenCount).toBeGreaterThanOrEqual(40);
    expect(tokenCount).toBeLessThanOrEqual(60);
  });

  it("truncate respects word boundaries (no mid-word truncation)", async () => {
    // Each word is exactly "xxxxx" — truncation should not leave partial words
    const words = Array.from({ length: 100 }, () => word(5));
    const text = words.join(" ");

    const result = await tokenizer.truncate(text, 25);
    const resultWords = result.split(" ");

    // Every segment should be a complete word (or empty)
    for (const w of resultWords) {
      if (w.length > 0) {
        expect(w).toBe(word(5));
      }
    }
  });

  it("truncate with maxTokens larger than text returns full text unchanged", async () => {
    const text = "This is a short piece of text.";
    const result = await tokenizer.truncate(text, 10_000);
    expect(result).toBe(text);
  });

  it("truncate with maxTokens = 0 returns empty string", async () => {
    const result = await tokenizer.truncate("some text here", 0);
    expect(result).toBe("");
  });

  it("long text gets truncated (output shorter than input)", async () => {
    const result = await tokenizer.truncate(LONG_TEXT, 20);
    expect(result.length).toBeLessThan(LONG_TEXT.length);
  });

  it("truncate on empty text returns empty string", async () => {
    const result = await tokenizer.truncate("", 100);
    expect(result).toBe("");
  });

  it("truncate preserves full sentences when possible", async () => {
    // A text where each sentence fits in the budget — should not truncate
    const shortText = "Hello world. This is fine.";
    const result = await tokenizer.truncate(shortText, 100);
    expect(result).toBe(shortText);
  });
});
