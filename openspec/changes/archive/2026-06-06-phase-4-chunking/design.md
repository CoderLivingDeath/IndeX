## Context

Raw parsed content (from Phase 3) can be arbitrarily long — a 5000-word note cannot be embedded as a single vector. Chunking splits content into semantic units sized for embedding models (max 512 tokens). The pipeline design ensures graceful degradation: try heading-based first, fall through to paragraph, sentence, and finally overflow splitting.

## Goals / Non-Goals

**Goals:**
- `HeadingChunker`: Split by Markdown headings (H1/H2+). Section ≤ 512 tokens → one chunk. Section > 512 → falls through (doesn't split).
- `ParagraphChunker`: Split by blank lines. Paragraph ≤ 512 tokens → chunk. Paragraph > 512 → delegates to SentenceChunker.
- `SentenceChunker`: Split by sentence boundaries (`.!?`). Protects abbreviations (`Mr.`, `Dr.`, etc.). Never splits a sentence. Overlong sentence → OverflowChunker.
- `OverflowChunker`: Forced split at token boundary. Last resort.
- `CodeChunker`: Split by function/class boundaries. No overlap (functions are indivisible).
- `ChunkerFactory`: Builds pipeline `heading → paragraph → sentence → overflow`. Post-processing: merge chunks < 50 tokens with neighbors, apply 32-token overlap between chunks.
- `core_content` extraction: each chunk has `content` (full text with overlap) and `core_content` (semantic unit without overlap — used for BLAKE3 dedup).

**Non-Goals:**
- No parallel chunking (single-threaded processing of one file at a time is sufficient)
- No custom per-file-type strategies (delegated to ChunkerFactory strategy selection)

## Decisions

- **Fallback pipeline vs. adaptive strategy selection**: A fixed fallback chain is simpler to implement and reason about than an ML-based strategy selector. The chain covers all cases while being explicit.
- **`core_content` separate from `content`**: Overlap text aids LLM context but shouldn't affect dedup hashing. Without this separation, adding overlap would change `semantic_blake3` and break cross-file dedup.
- **50-token minimum**: Chunks smaller than 50 tokens are unlikely to carry meaningful semantic weight. Merging them reduces noise in search results.
- **32-token overlap**: Approximately 3-4 sentences of overlap provide enough context continuity without significantly inflating embedding cost.
- **No overlap for code**: Functions/classes are self-contained. Adding overlap from adjacent functions would create noisy embeddings.

## Risks / Trade-offs

- **Sentence chunker abbreviation list**: Hard-coded abbreviation exceptions (`Mr.`, `Mrs.`, `Dr.`, `e.g.`, `i.e.`) may miss domain-specific abbreviations. Mitigation: make the abbreviation list configurable.
- **Overflow chunker degrades quality**: Breaking in the middle of a sentence loses meaning. This is by design — it's the last resort, and the fallback chain makes it rare for typical content.
