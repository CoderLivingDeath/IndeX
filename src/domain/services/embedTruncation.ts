// ---------------------------------------------------------------------------
// Embed Content Truncation
//
// Ensures content sent to the embedder fits within the model's context window
// (qllama/multilingual-e5-small, context_length=512).
//
// Uses gpt-tokenizer (cl100k) as the estimation proxy. For BERT-based models
// (SentencePiece/WordPiece) the observed token-density ratio vs cl100k can
// reach up to ~1.7× for certain content (long import chains, type annotations,
// template literals). MAX_EMBED_TOKENS is therefore set conservatively to
// 200, which maps to ≤~350 BERT tokens — well within the 512 limit.
// ---------------------------------------------------------------------------

/** Maximum embed tokens (gpt-tokenizer cl100k). ~200 cl100k = ≤350 BERT tokens. */
const MAX_EMBED_TOKENS = 150;

/**
 * Estimate token count using gpt-tokenizer (cl100k_base).
 * Falls back to a conservative heuristic that distinguishes ASCII vs non-ASCII.
 */
async function estimateEmbedTokens(text: string): Promise<number> {
  try {
    const { encode } = await import("gpt-tokenizer");
    return encode(text).length;
  } catch {
    // Heuristic: ASCII ~4 chars/token, non-ASCII ~1 token per char
    let ascii = 0;
    let nonAscii = 0;
    for (const ch of text) {
      if (ch.charCodeAt(0) <= 127) ascii++;
      else nonAscii++;
    }
    return Math.round(ascii / 4 + nonAscii);
  }
}

/**
 * Truncate embed content to fit within the model's context window.
 * The AST summary is prepended first, then the core_content is truncated if needed.
 *
 * Uses binary search to find the longest content string that stays within
 * the token budget.
 */
export async function truncateEmbedContent(
  astSummary: string,
  coreContent: string,
): Promise<string> {
  const prefix = astSummary ? `${astSummary}\n\n` : "";

  // If even the prefix alone exceeds the budget, truncate the prefix
  if ((await estimateEmbedTokens(prefix)) >= MAX_EMBED_TOKENS) {
    return prefix.slice(0, MAX_EMBED_TOKENS * 2);
  }

  // Binary search for the longest suffix that fits within the budget
  let lo = 0;
  let hi = coreContent.length;
  let best = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const total = prefix + coreContent.slice(0, mid);
    const tokens = await estimateEmbedTokens(total);
    if (tokens <= MAX_EMBED_TOKENS) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return prefix + coreContent.slice(0, best);
}
