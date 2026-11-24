// ---------------------------------------------------------------------------
// DI Systems — Phase 9
//
// Group interfaces bundling the dependencies required by each application
// use case.  Every use case receives its own *Systems interface so the
// container (or manual wiring) provides exactly what it needs — no more,
// no less.
// ---------------------------------------------------------------------------

import type { FileFilter } from "../../domain/ports/FileFilter";
import type { SourceParserRegistry } from "../../domain/ports/SourceParserRegistry";
import type { Chunker } from "../../domain/systems/ChunkingSystem";
import type {
  Embedder,
  EmbedderRegistry,
} from "../../domain/systems/EmbeddingSystem";
import type { Hasher } from "../../domain/systems/HashingSystem";
import type { SourceRepository } from "../../domain/ports/SourceRepository";
import type { Logger } from "../../domain/ports/Logger";
import type { SearchService } from "../../domain/services/SearchService";

// ── IndexSystems ───────────────────────────────────────────────
// Required by IndexUseCase — full pipeline: filter → parse → chunk →
// embed → upsert.
export interface IndexSystems {
  fileFilter: FileFilter;
  parserRegistry: SourceParserRegistry;
  chunker: Chunker;
  embedderRegistry: EmbedderRegistry;
  repo: SourceRepository;
  hasher: Hasher;
  logger: Logger;
}

// ── SearchSystems ───────────────────────────────────────────────
// Required by SearchUseCase — embed the query once, then delegate ranking
// to the single SearchService pipeline.
export interface SearchSystems {
  embedder: Embedder;
  ranker: SearchService;
  logger: Logger;
}

// ── PackSystems ─────────────────────────────────────────────────
// Required by PackUseCase — scan directory, parse sources, concat into
// a single PackedContext markdown document.
export interface PackSystems {
  parserRegistry: SourceParserRegistry;
  fileFilter: FileFilter;
  logger: Logger;
}

// ── ChunkSystems ────────────────────────────────────────────────
// Required by ChunkUseCase — scan directory, parse sources, produce
// Chunk[] via the Chunker.
export interface ChunkSystems {
  parserRegistry: SourceParserRegistry;
  chunker: Chunker;
  fileFilter: FileFilter;
  logger: Logger;
}

// ── EmbedSystems ────────────────────────────────────────────────
// Required by EmbedUseCase — two modes:
//   source: "chunks"  →  read existing chunks from repo, embed each
//   source: "files"   →  re-parse files, chunk, then embed
// The optional fields (parserRegistry, chunker, fileFilter) are needed
// only for the "files" source mode.
export interface EmbedSystems {
  embedderRegistry: EmbedderRegistry;
  repo: SourceRepository;
  parserRegistry?: SourceParserRegistry;
  chunker?: Chunker;
  fileFilter?: FileFilter;
  logger: Logger;
}
