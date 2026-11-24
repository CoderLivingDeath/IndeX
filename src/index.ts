// ---------------------------------------------------------------------------
// IndeX — DI Container / Composition Root
//
// Wires together all modules into a single `createApp()` entry point.
// Supports test-mode injection of mock dependencies.
// ---------------------------------------------------------------------------

// ── Config ──────────────────────────────────────────────────────────
import { loadOrDefault as loadConfig } from "./config/ConfigLoader";
import type { Config } from "./config/ConfigLoader";

// ── Domain types ────────────────────────────────────────────────────
import { matchesAny } from "./shared/globMatcher";
import type { SourceType, SearchQuery } from "./domain/types";
import type { Chunk } from "./domain/systems/ChunkingSystem";
import type { ChunkerPipeline } from "./domain/systems/ChunkingSystem";
import type { Chunker } from "./domain/systems/ChunkingSystem";
import type { EmbedderRegistry } from "./domain/systems/EmbeddingSystem";
import type { SearchResult } from "./domain/types";

// ── Ports ───────────────────────────────────────────────────────────
import type { FileFilter } from "./domain/ports/FileFilter";
import type { SourceParserRegistry } from "./domain/ports/SourceParserRegistry";
import type { SourceRepository } from "./domain/ports/SourceRepository";
import type { Logger } from "./domain/ports/Logger";

// ── Infrastructure: Logger ──────────────────────────────────────────
import { PinoLogger } from "./infrastructure/logger/PinoLogger";
import { SilentLogger } from "./infrastructure/logger/SilentLogger";

// ── Infrastructure: Hashing ─────────────────────────────────────────
import { BLAKE3Hasher } from "./infrastructure/hashing/BLAKE3Hasher";
import { TokenEstimatorSimple } from "./infrastructure/hashing/TokenEstimatorSimple";

// ── Infrastructure: Parsers ─────────────────────────────────────────
import { MarkdownParser } from "./infrastructure/parser/MarkdownParser";
import { ObsidianParser } from "./infrastructure/parser/ObsidianParser";
import { AstGrepParser } from "./infrastructure/parser/AstGrepParser";
import { ParserRegistry } from "./infrastructure/parser/ParserRegistry";

// ── Infrastructure: Chunking ────────────────────────────────────────
import { ChunkerFactory } from "./infrastructure/chunking/ChunkerFactory";

// ── Infrastructure: Embedding ───────────────────────────────────────
import { EmbedderRegistryImpl } from "./infrastructure/embedding/EmbedderRegistryImpl";
import { EmbedderCacheLRU } from "./infrastructure/embedding/EmbedderCacheLRU";
import { CachedEmbedder } from "./infrastructure/embedding/CachedEmbedder";
import { OllamaEmbedder } from "./infrastructure/embedding/OllamaEmbedder";

// ── Infrastructure: Repository ──────────────────────────────────────
import { LanceDbSourceRepository } from "./infrastructure/lancedb/LanceDbSourceRepository";

// ── Infrastructure: Watcher ─────────────────────────────────────────
import { ChokidarWatcher } from "./infrastructure/watcher/ChokidarWatcher";

// ── MCP Server ──────────────────────────────────────────────────────
import { IndeXMcpServer } from "./presentation/mcp/IndeXMcpServer";

// ── Domain Services ─────────────────────────────────────────────────
import { IndexingService } from "./domain/services/IndexingService";
import { SearchService } from "./domain/services/SearchService";
import { DiffIndexingService } from "./domain/services/DiffIndexingService";

// ── DI Group Interfaces ─────────────────────────────────────────────
import type {
  IndexSystems,
  SearchSystems,
  PackSystems,
  ChunkSystems,
  EmbedSystems,
} from "./application/di/Systems";

// ── Application Use Cases ───────────────────────────────────────────
import { IndexUseCase } from "./application/IndexUseCase";
import { SearchUseCase } from "./application/SearchUseCase";
import { PackUseCase } from "./application/PackUseCase";
import { ChunkUseCase } from "./application/ChunkUseCase";
import { EmbedUseCase } from "./application/EmbedUseCase";
import { WatchUseCase } from "./application/WatchUseCase";
import { DeleteUseCase } from "./application/DeleteUseCase";
import { SyncUseCase } from "./application/SyncUseCase";

// ── Types ───────────────────────────────────────────────────────────

export interface AppUseCases {
  index: IndexUseCase;
  search: SearchUseCase;
  pack: PackUseCase;
  chunk: ChunkUseCase;
  embed: EmbedUseCase;
  watch: WatchUseCase;
  del: DeleteUseCase;
  sync: SyncUseCase;
  /** Current application config (live value, settable). */
  config: Config;
  /** MCP server for AI agent integration (lazy-started). */
  mcp: IndeXMcpServer;
}

export interface CreateAppOptions {
  /** Path to config file (default: .indeX/config.json). */
  configPath?: string;
  /** Inject a custom SourceRepository (for tests). */
  repository?: SourceRepository;
  /** Inject a custom Logger. */
  logger?: Logger;
  /** When true, uses SilentLogger and MockSourceRepository. */
  testMode?: boolean;
  /** Embedder for search queries (default: OllamaEmbedder from first configured model). */
  searchEmbedder?: import("./domain/systems/EmbeddingSystem").Embedder;
  /** Enable pretty-printed terminal output. */
  pretty?: boolean;
  /** Directory to watch (default: "."). */
  watchDir?: string;
  /** Glob patterns to ignore in the watcher. */
  watchIgnored?: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * FileFilter that includes files matching the configured formats/exclude patterns.
 */
function createFileFilter(config: Config): FileFilter {
  const extList = [".ts", ".tsx", ".js", ".jsx", ".md", ".json", ".cs", ".py"];
  const exclude = config.indexing?.exclude ?? [];
  const include = config.indexing?.include;
  return {
    formats: extList,
    shouldInclude: (path: string) => {
      // Exclude patterns (glob match, e.g. "node_modules/**", ".git/**")
      if (exclude.length > 0 && matchesAny(exclude, path)) return false;
      // Include patterns (if specified, path must match at least one glob)
      if (include && include.length > 0) {
        return matchesAny(include, path);
      }
      return extList.some((ext) => path.endsWith(ext));
    },
  };
}

// ── createApp — Composition Root ───────────────────────────────────

/**
 * Create the IndeX application with all dependencies wired together.
 *
 * @example
 * ```ts
 * const app = createApp();
 * const stats = await app.index.execute("./vault");
 * const results = await app.search.execute("query");
 * ```
 */
export function createApp(options?: CreateAppOptions): AppUseCases {
  // 1. Load config
  const config = loadConfig(options?.configPath);

  // 2. Logger — an explicitly injected logger always wins.
  const logger: Logger =
    options?.logger ??
    (options?.testMode
      ? new SilentLogger()
      : new PinoLogger({ level: "info", pretty: options?.pretty ?? false }));

  // 3. Hasher
  const hasher = new BLAKE3Hasher();

  // 4. Token estimator
  const tokenEstimator = new TokenEstimatorSimple();

  // 5. Parser registry
  const parserRegistry: SourceParserRegistry = new ParserRegistry();
  parserRegistry.register(new MarkdownParser());
  parserRegistry.register(new ObsidianParser());
  parserRegistry.register(new AstGrepParser());

  // 6. Chunker pipeline
  const chunkerFactory = new ChunkerFactory(
    config.chunking.max_chunk_size,
    tokenEstimator,
    config.chunking.overlap,
  );
  const strategies = [config.chunking.default_strategy, "paragraph", "sentence", "overflow"];
  const chunkerPipeline: ChunkerPipeline = chunkerFactory.createPipeline(strategies);

  // Wrap ChunkerPipeline as a Chunker (for IndexingService compatibility)
  const chunker: Chunker = {
    type: "generic" as SourceType,
    chunk: async (text: string): Promise<Chunk[]> =>
      chunkerPipeline.chunk(text, "generic"),
  };
  // Expose pipeline for tests
  (chunker as any).pipeline = chunkerPipeline;

  // 7. File filter
  const fileFilter = createFileFilter(config);

  // 8. Embedder registry
  const embedderRegistry: EmbedderRegistry = new EmbedderRegistryImpl();
  const cache = new EmbedderCacheLRU(config.embedder.cache_size);

  for (const modelCfg of config.models) {
    const baseEmbedder = new OllamaEmbedder(
      modelCfg.name,
      modelCfg.dimensions,
      modelCfg.baseUrl ?? "http://localhost:11434",
    );
    const cached = new CachedEmbedder(baseEmbedder, cache, hasher);
    embedderRegistry.register("*", cached, 10);
  }

  // 9. Source repository
  const repo: SourceRepository =
    options?.repository ??
    new LanceDbSourceRepository(
      options?.testMode ? "memory://" : ".indeX/index.lancedb",
    );

  // Connect repo eagerly (no-op for memory mode)
  if (repo instanceof LanceDbSourceRepository) {
    // LanceDbSourceRepository connects lazily — no eager init needed
  }

  // 10. Domain services
  const indexingService = new IndexingService(
    fileFilter,
    parserRegistry,
    chunker,
    embedderRegistry,
    repo,
    hasher,
    logger,
  );

  const baseSearchEmbedder =
    options?.searchEmbedder ??
    new OllamaEmbedder(
      config.models[0]!.name,
      config.models[0]!.dimensions,
      config.models[0]!.baseUrl ?? "http://localhost:11434",
    );
  const searchEmbedder = new CachedEmbedder(baseSearchEmbedder, cache, hasher);

  const searchRanker = new SearchService(repo, {
    hybrid_weight: config.search.hybrid_weight,
  });

  const diffIndexingService = new DiffIndexingService(
    hasher,
    parserRegistry,
    chunker,
    embedderRegistry,
    repo,
    fileFilter,
  );

  // 11. Use cases
  const index = new IndexUseCase({
    fileFilter,
    parserRegistry,
    chunker,
    embedderRegistry,
    repo,
    hasher,
    logger,
  } satisfies IndexSystems);

  const search = new SearchUseCase({
    embedder: searchEmbedder,
    ranker: searchRanker,
    logger,
  } satisfies SearchSystems);

  const pack = new PackUseCase({
    parserRegistry,
    fileFilter,
    logger,
  } satisfies PackSystems);

  const chunk = new ChunkUseCase({
    parserRegistry,
    chunker,
    fileFilter,
    logger,
  } satisfies ChunkSystems);

  const embed = new EmbedUseCase({
    embedderRegistry,
    repo,
    parserRegistry,
    chunker,
    fileFilter,
    logger,
  } satisfies EmbedSystems);

  const watcher = new ChokidarWatcher(options?.watchDir ?? ".", {
    ...(options?.watchIgnored ? { ignored: options.watchIgnored } : {}),
  });
  const watch = new WatchUseCase(watcher, diffIndexingService, logger, repo);

  const del = new DeleteUseCase(repo);

  // 12. Sync use case (prune stale + re-index changed via tree snapshot)
  const excludePatterns = config.indexing?.exclude ?? [];
  const sync = new SyncUseCase(repo, diffIndexingService, hasher, fileFilter, logger, excludePatterns);

  // 13. MCP server (lazy-started — call app.mcp.start() to activate)
  const mcp = new IndeXMcpServer({
    search,
    index,
    pack,
    chunk,
    del,
    config,
  });

  return { index, search, pack, chunk, embed, watch, del, sync, config, mcp };
}
