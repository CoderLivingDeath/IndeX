import * as lancedb from "@lancedb/lancedb";
import type { Connection, Table } from "@lancedb/lancedb";
import { Field, FixedSizeList, Float32, Int32, Schema, Utf8 } from "apache-arrow";

import type { SourceRepository } from "../../domain/ports/SourceRepository";
import type { SourceData, SearchQuery, SearchResult, IndexStats, SourceType, SourceMetadata } from "../../domain/types";
import type { FileIndex } from "../../domain/ast";

/**
 * LanceDB-backed SourceRepository implementation.
 *
 * Manages two tables:
 * - `sources` — chunk-level data with all `SourceData` fields plus optional
 *   `vect_{modelName}` columns for multi-model embeddings.
 * - `file_index` — file-level AST summaries with complex types (imports,
 *   exports, symbols, relationships) stored as JSON strings.
 *
 * Tables are created lazily on the first write operation.
 * The `embeddings` column is omitted from records that have no embeddings;
 * LanceDB evolves the schema when embeddings are added later.
 *
 * Supports in-memory mode via `connect("memory://")` for tests.
 */
export class LanceDbSourceRepository implements SourceRepository {
  private db: Connection | null = null;
  private sourcesTable: Table | null = null;
  private fileIndexTable: Table | null = null;
  private dbMetaTable: Table | null = null;
  private connected = false;

  constructor(private readonly uri: string) {}

  // ── Connection management ──────────────────────────────────

  async connect(): Promise<void> {
    if (this.connected) return;
    this.db = await lancedb.connect(this.uri);
    this.connected = true;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) await this.connect();
  }

  /** Rebuild the FTS inverted index on the content column. */
  private async ensureFtsIndex(table: Table): Promise<void> {
    try {
      await table.createIndex("content", {
        config: lancedb.Index.fts({ withPosition: true }),
        replace: true,
        waitTimeoutSeconds: 30,
      });
    } catch {
      // FTS index may not be supported in memory:// mode
    }
  }

  /** Open the sources table. Returns null if not yet created. */
  private async getSourcesTable(): Promise<Table | null> {
    await this.ensureConnected();
    if (this.sourcesTable) return this.sourcesTable;
    try {
      this.sourcesTable = await this.db!.openTable("sources");
      return this.sourcesTable;
    } catch {
      return null;
    }
  }

  /** Ensure the sources table exists, creating with a schema that includes embeddings. */
  private async ensureSourcesTable(record: Record<string, unknown>): Promise<Table> {
    const existing = await this.getSourcesTable();
    if (existing) return existing;

    // Build schema with all scalar columns + optional vector column for embeddings
    const hasEmb = record.embeddings !== undefined;
    const fields: Field[] = [
      new Field("id", new Utf8(), false),
      new Field("chunk_id", new Utf8(), true),
      new Field("source_id", new Utf8(), true),
      new Field("type", new Utf8(), true),
      new Field("title", new Utf8(), true),
      new Field("content", new Utf8(), true),
      new Field("tags", new Utf8(), true),
      new Field("path", new Utf8(), true),
      new Field("file_blake3", new Utf8(), true),
      new Field("semantic_blake3", new Utf8(), true),
      new Field("chunk_index", new Int32(), true),
      new Field("total_chunks", new Int32(), true),
      new Field("metadata", new Utf8(), true),
      new Field("created_at", new Utf8(), true),
      new Field("updated_at", new Utf8(), true),
    ];

    if (hasEmb) {
      const emb = record.embeddings as Float32Array;
      fields.push(new Field("embeddings", new FixedSizeList(emb.length, new Field("item", new Float32())), true));
    }

    const schema = new Schema(fields);
    this.sourcesTable = await this.db!.createTable("sources", [record], {
      mode: "create",
      existOk: false,
      schema,
    });

    return this.sourcesTable;
  }

  /** Open the file_index table. Returns null if not yet created. */
  private async getFileIndexTable(): Promise<Table | null> {
    await this.ensureConnected();
    if (this.fileIndexTable) return this.fileIndexTable;
    try {
      this.fileIndexTable = await this.db!.openTable("file_index");
      await this.ensureFileIndexFtsIndex(this.fileIndexTable);
      return this.fileIndexTable;
    } catch {
      return null;
    }
  }

  /** Build FTS index on ast_text column. */
  private async ensureFileIndexFtsIndex(table: Table): Promise<void> {
    try {
      await table.createIndex("ast_text", {
        config: lancedb.Index.fts({ withPosition: true }),
        replace: true,
        waitTimeoutSeconds: 30,
      });
    } catch {
      // FTS index may not be supported in memory:// mode
    }
  }

  /** Ensure the file_index table exists. */
  private async ensureFileIndexTable(record: Record<string, unknown>): Promise<Table> {
    const existing = await this.getFileIndexTable();
    if (existing) return existing;

    const fields: Field[] = [
      new Field("path", new Utf8(), false),
      new Field("file_blake3", new Utf8(), true),
      new Field("language", new Utf8(), true),
      new Field("imports", new Utf8(), true),
      new Field("exports", new Utf8(), true),
      new Field("symbols", new Utf8(), true),
      new Field("relationships", new Utf8(), true),
      new Field("last_parsed", new Utf8(), true),
      new Field("ast_text", new Utf8(), true),
    ];

    const schema = new Schema(fields);
    this.fileIndexTable = await this.db!.createTable("file_index", [record], {
      mode: "create",
      existOk: false,
      schema,
    });

    // Build FTS index on ast_text
    await this.ensureFileIndexFtsIndex(this.fileIndexTable);

    return this.fileIndexTable;
  }

  // ── Sources CRUD ───────────────────────────────────────────

  async upsert(data: SourceData): Promise<void> {
    const record = this.sourceDataToRecord(data);
    const table = await this.ensureSourcesTable(record);

    try {
      await table.delete(`id = '${escapeLanceSqlString(data.id)}'`);
    } catch {
      // Row may not exist
    }

    await table.add([record]);
    await this.ensureFtsIndex(table);
  }

  async upsertBatch(data: SourceData[]): Promise<void> {
    if (data.length === 0) return;

    const records = data.map((d) => this.sourceDataToRecord(d));
    const table = await this.ensureSourcesTable(records[0]!);

    for (const d of data) {
      try {
        await table.delete(`id = '${escapeLanceSqlString(d.id)}'`);
      } catch {
        // Row may not exist
      }
    }

    await table.add(records);
    await this.ensureFtsIndex(table);
  }

  async getById(id: string): Promise<SourceData | null> {
    const table = await this.getSourcesTable();
    if (!table) return null;

    const results = await table.query()
      .where(`id = '${escapeLanceSqlString(id)}'`)
      .limit(1)
      .toArray();

    if (results.length === 0) return null;
    return this.recordToSourceData(results[0] as Record<string, unknown>);
  }

  async getByPath(path: string): Promise<SourceData[]> {
    const table = await this.getSourcesTable();
    if (!table) return [];

    const results = await table.query()
      .where(`path = '${escapeLanceSqlString(path)}'`)
      .toArray();

    return results.map((r) => this.recordToSourceData(r as Record<string, unknown>));
  }

  async getBySourceId(sourceId: string): Promise<SourceData[]> {
    const table = await this.getSourcesTable();
    if (!table) return [];

    const results = await table.query()
      .where(`source_id = '${escapeLanceSqlString(sourceId)}'`)
      .toArray();

    return results.map((r) => this.recordToSourceData(r as Record<string, unknown>));
  }

  async delete(id: string): Promise<void> {
    const table = await this.getSourcesTable();
    if (!table) return;
    await table.delete(`id = '${escapeLanceSqlString(id)}'`);
  }

  async deleteByPath(path: string): Promise<void> {
    const table = await this.getSourcesTable();
    if (!table) return;
    await table.delete(`path = '${escapeLanceSqlString(path)}'`);
  }

  // ── Search ─────────────────────────────────────────────────

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const table = await this.getSourcesTable();
    if (!table) return [];

    const topK = query.top_k ?? 10;
    let rows: Record<string, unknown>[];

    const hasVector = query.filters?.vector && Array.isArray(query.filters.vector) && (query.filters.vector as number[]).length > 0;
    const filters: string[] = [];
    if (query.source_types && query.source_types.length > 0) {
      filters.push(buildTypeFilter(query.source_types));
    }
    if (query.tags && query.tags.length > 0) {
      filters.push(buildTagFilter(query.tags));
    }
    const filterClause = filters.length > 0 ? filters.join(" AND ") : undefined;

    if (query.mode === "hybrid" && hasVector) {
      // Hybrid: combine ANN + FTS results, then merge & re-rank
      const vec = Float32Array.from(query.filters!.vector as number[]);
      const annQuery = table.vectorSearch(vec).limit(topK * 2);
      if (filterClause) annQuery.where(filterClause);
      let annRows: Record<string, unknown>[];
      try { annRows = (await annQuery.toArray()) as Record<string, unknown>[]; } catch { annRows = []; }

      let ftsRows: Record<string, unknown>[];
      try {
        ftsRows = await this.executeKeywordSearch(table, query.text, topK * 2, query.source_types, query.tags);
      } catch { ftsRows = []; }

      // Merge by id, keep max normalised score
      const merged = new Map<string, { row: Record<string, unknown>; score: number }>();
      const maxAnn = annRows.reduce((m, r) => Math.max(m, (r._distance as number) ?? 0), 0) || 1;
      const maxFts = ftsRows.reduce((m, r) => Math.max(m, (r._score as number) ?? 0), 0) || 1;

      for (const r of annRows) {
        const id = r.id as string;
        const norm = ((r._distance as number) ?? 0) / maxAnn;
        merged.set(id, { row: r, score: norm * 0.7 }); // ANN weight 0.7
      }
      for (const r of ftsRows) {
        const id = r.id as string;
        const norm = ((r._score as number) ?? 0) / maxFts;
        const existing = merged.get(id);
        merged.set(id, { row: r, score: (existing?.score ?? 0) + norm * 0.3 }); // FTS weight 0.3
      }

      rows = Array.from(merged.entries())
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, topK)
        .map(([, v]) => v.row);
    } else if (query.mode === "semantic" && hasVector) {
      const vec = Float32Array.from(query.filters!.vector as number[]);
      const lanceQuery = table.vectorSearch(vec).limit(topK);
      if (filterClause) lanceQuery.where(filterClause);
      rows = (await lanceQuery.toArray()) as Record<string, unknown>[];
    } else if (query.mode === "ast") {
      return this.executeAstSearch(query);
    } else {
      rows = await this.executeKeywordSearch(table, query.text, topK, query.source_types, query.tags);
    }

    const results: SearchResult[] = rows.map((r) => ({
      source: this.recordToSourceData(r),
      score: (r._score as number) ?? (r._distance as number) ?? 0,
      match_type: query.mode,
    }));

    if (query.min_score !== undefined && query.min_score > 0) {
      return results.filter((r) => r.score >= query.min_score!);
    }

    return results.slice(0, topK);
  }

  private async executeKeywordSearch(
    table: Table,
    text: string,
    topK: number,
    sourceTypes?: SourceType[],
    tags?: string[],
  ): Promise<Record<string, unknown>[]> {
    try {
      let lanceQuery = table.query().limit(topK);
      if (text) {
        lanceQuery = lanceQuery.fullTextSearch(text);
      }
      const filters: string[] = [];
      if (sourceTypes && sourceTypes.length > 0) {
        filters.push(buildTypeFilter(sourceTypes));
      }
      if (tags && tags.length > 0) {
        filters.push(buildTagFilter(tags));
      }
      if (filters.length > 0) {
        lanceQuery = lanceQuery.where(filters.join(" AND "));
      }
      return (await lanceQuery.toArray()) as Record<string, unknown>[];
    } catch {
      // FTS not available — fall back to WHERE + LIKE
      return this.executeFallbackSearch(table, text, topK, sourceTypes, tags);
    }
  }

  private async executeFallbackSearch(
    table: Table,
    text: string,
    topK: number,
    sourceTypes?: SourceType[],
    tags?: string[],
  ): Promise<Record<string, unknown>[]> {
    const conditions: string[] = [];

    if (text) {
      const escaped = escapeLanceSqlString(text.toLowerCase());
      conditions.push(`LOWER(content) LIKE '%${escaped}%'`);
    }
    if (sourceTypes && sourceTypes.length > 0) {
      conditions.push(buildTypeFilter(sourceTypes));
    }
    if (tags && tags.length > 0) {
      conditions.push(buildTagFilter(tags));
    }

    let lanceQuery = table.query().limit(topK);
    if (conditions.length > 0) {
      lanceQuery = lanceQuery.where(conditions.join(" AND "));
    }

    return (await lanceQuery.toArray()) as Record<string, unknown>[];
  }

  // ── Hash / Embedding queries ───────────────────────────────

  async hasSemanticBlake3(hash: string): Promise<boolean> {
    const table = await this.getSourcesTable();
    if (!table) return false;

    const results = await table.query()
      .where(`semantic_blake3 = '${escapeLanceSqlString(hash)}'`)
      .limit(1)
      .select(["id"])
      .toArray();

    return results.length > 0;
  }

  async hasModelEmbedding(id: string): Promise<boolean> {
    const table = await this.getSourcesTable();
    if (!table) return false;

    // Check if the embeddings column exists in the schema
    const schema = await table.schema();
    const embField = schema.fields.find((f) => f.name === "embeddings");
    if (!embField) return false;

    const results = await table.query()
      .where(`id = '${escapeLanceSqlString(id)}'`)
      .limit(1)
      .select(["embeddings"])
      .toArray();

    if (results.length === 0) return false;

    const emb = (results[0] as Record<string, unknown>).embeddings;
    if (emb instanceof Float32Array) return emb.length > 0;
    if (Array.isArray(emb)) return emb.length > 0;
    return emb !== null && emb !== undefined;
  }

  async getSourceIdsByHash(hash: string): Promise<string[]> {
    const table = await this.getSourcesTable();
    if (!table) return [];

    const results = await table.query()
      .where(`semantic_blake3 = '${escapeLanceSqlString(hash)}'`)
      .select(["source_id"])
      .toArray();

    return results.map((r) => (r as Record<string, unknown>).source_id as string);
  }

  async getFileBlake3ByPath(path: string): Promise<string | null> {
    const table = await this.getSourcesTable();
    if (!table) return null;

    const results = await table.query()
      .where(`path = '${escapeLanceSqlString(path)}'`)
      .limit(1)
      .select(["file_blake3"])
      .toArray();

    if (results.length === 0) return null;
    return (results[0] as Record<string, unknown>).file_blake3 as string;
  }

  // ── AST Search ────────────────────────────────────────────

  private async executeAstSearch(query: SearchQuery): Promise<SearchResult[]> {
    const fiTable = await this.getFileIndexTable();
    if (!fiTable) return [];

    const sourcesTable = await this.getSourcesTable();
    if (!sourcesTable) return [];

    const topK = query.top_k ?? 10;

    // Search file_index ast_text via FTS
    let fiQuery = fiTable.query().limit(topK);
    if (query.text) {
      fiQuery = fiQuery.fullTextSearch(query.text);
    }

    let fiRows: Record<string, unknown>[];
    try {
      fiRows = (await fiQuery.toArray()) as Record<string, unknown>[];
    } catch {
      // FTS not available
      return [];
    }

    // For each matching file, get chunks by path from sources table
    const results: SearchResult[] = [];
    for (const fiRow of fiRows) {
      const path = fiRow.path as string;
      const astScore = ((fiRow._score as number) ?? 1);

      const chunkRows = await sourcesTable.query()
        .where(`path = '${escapeLanceSqlString(path)}'`)
        .toArray();

      for (const row of chunkRows) {
        results.push({
          source: this.recordToSourceData(row as Record<string, unknown>),
          score: astScore,
          match_type: "ast",
        });
      }
    }

    // Sort by score descending, limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  // ── Stats ──────────────────────────────────────────────────

  async stats(): Promise<IndexStats> {
    const table = await this.getSourcesTable();
    if (!table) {
      return { total_sources: 0, total_chunks: 0, total_files: 0, total_tokens: 0, last_indexed: new Date().toISOString() };
    }

    const totalChunks = await table.countRows();
    const pathRows = await table.query().select(["path", "updated_at"]).toArray();

    const uniquePaths = new Set<string>();
    let maxDate = "";

    for (const r of pathRows) {
      const rec = r as Record<string, unknown>;
      uniquePaths.add(rec.path as string);
      const dt = rec.updated_at as string;
      if (dt && dt > maxDate) maxDate = dt;
    }

    return {
      total_sources: uniquePaths.size,
      total_chunks: totalChunks,
      total_files: uniquePaths.size,
      total_tokens: 0,
      last_indexed: maxDate || new Date().toISOString(),
    };
  }

  // ── File Index CRUD ────────────────────────────────────────

  async upsertFileIndex(index: FileIndex): Promise<void> {
    const record = this.fileIndexToRecord(index);
    const table = await this.ensureFileIndexTable(record);

    try {
      await table.delete(`path = '${escapeLanceSqlString(index.path)}'`);
    } catch {
      // Row may not exist
    }

    await table.add([record]);
  }

  async getFileIndex(path: string): Promise<FileIndex | null> {
    const table = await this.getFileIndexTable();
    if (!table) return null;

    const results = await table.query()
      .where(`path = '${escapeLanceSqlString(path)}'`)
      .limit(1)
      .toArray();

    if (results.length === 0) return null;
    return this.recordToFileIndex(results[0] as Record<string, unknown>);
  }

  async deleteFileIndex(path: string): Promise<void> {
    const table = await this.getFileIndexTable();
    if (!table) return;
    await table.delete(`path = '${escapeLanceSqlString(path)}'`);
  }

  // ── DB Metadata ────────────────────────────────────────────

  /** Open the db_meta table. Returns null if not yet created. */
  private async getDbMetaTable(): Promise<Table | null> {
    await this.ensureConnected();
    if (this.dbMetaTable) return this.dbMetaTable;
    try {
      this.dbMetaTable = await this.db!.openTable("db_meta");
      return this.dbMetaTable;
    } catch {
      return null;
    }
  }

  /** Ensure the db_meta table exists. */
  private async ensureDbMetaTable(): Promise<Table> {
    const existing = await this.getDbMetaTable();
    if (existing) return existing;

    const schema = new Schema([
      new Field("key", new Utf8(), false),
      new Field("value", new Utf8(), true),
    ]);

    this.dbMetaTable = await this.db!.createTable("db_meta", [], {
      mode: "create",
      existOk: false,
      schema,
    });

    return this.dbMetaTable;
  }

  async getDbMeta(key: string): Promise<unknown | null> {
    const table = await this.getDbMetaTable();
    if (!table) return null;

    const results = await table.query()
      .where(`key = '${escapeLanceSqlString(key)}'`)
      .limit(1)
      .toArray();

    if (results.length === 0) return null;
    const raw = (results[0] as Record<string, unknown>).value as string;
    if (raw === undefined || raw === null) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  }

  async setDbMeta(key: string, value: unknown): Promise<void> {
    const table = await this.ensureDbMetaTable();
    const raw = typeof value === "string" ? value : JSON.stringify(value);

    try {
      await table.delete(`key = '${escapeLanceSqlString(key)}'`);
    } catch {
      // Row may not exist
    }

    await table.add([{ key, value: raw }]);
  }

  async getAllDbMeta(): Promise<Record<string, unknown>> {
    const table = await this.getDbMetaTable();
    if (!table) return {};

    const rows = await table.query().toArray();
    const result: Record<string, unknown> = {};
    for (const r of rows) {
      const rec = r as Record<string, unknown>;
      const k = rec.key as string;
      const raw = rec.value as string;
      if (k) {
        try { result[k] = JSON.parse(raw); } catch { result[k] = raw; }
      }
    }
    return result;
  }

  // ── Cleanup ────────────────────────────────────────────────

  async dropAll(): Promise<void> {
    await this.ensureConnected();
    try { await this.db!.dropTable("sources"); } catch { /* already gone */ }
    try { await this.db!.dropTable("file_index"); } catch { /* already gone */ }
    try { await this.db!.dropTable("db_meta"); } catch { /* already gone */ }
    this.sourcesTable = null;
    this.fileIndexTable = null;
    this.dbMetaTable = null;
  }

  // ── Serialisation helpers ──────────────────────────────────

  private sourceDataToRecord(data: SourceData): Record<string, unknown> {
    const record: Record<string, unknown> = {
      id: data.id,
      chunk_id: data.chunk_id,
      source_id: data.source_id,
      type: data.type,
      title: data.title,
      content: data.content,
      tags: JSON.stringify(data.tags),
      path: data.path,
      file_blake3: data.file_blake3,
      semantic_blake3: data.semantic_blake3,
      chunk_index: data.chunk_index,
      total_chunks: data.total_chunks,
      metadata: JSON.stringify(data.metadata),
      created_at: data.created_at,
      updated_at: data.updated_at,
    };

    // Only include embeddings when data has them — avoids schema inference issues with null
    if (data.embeddings.length > 0) {
      record.embeddings = new Float32Array(data.embeddings);
    }

    return record;
  }

  private recordToSourceData(record: Record<string, unknown>): SourceData {
    const rawEmb = (record as Record<string, unknown>).embeddings;
    let embeddings: number[];
    if (rawEmb instanceof Float32Array) {
      embeddings = Array.from(rawEmb);
    } else if (Array.isArray(rawEmb)) {
      embeddings = rawEmb as number[];
    } else {
      embeddings = [];
    }

    const rawTags = record.tags;
    let tags: string[];
    if (typeof rawTags === "string") {
      try { tags = JSON.parse(rawTags); } catch { tags = []; }
    } else if (Array.isArray(rawTags)) {
      tags = rawTags as string[];
    } else {
      tags = [];
    }

    const rawMeta = record.metadata;
    let metadata: SourceMetadata;
    if (typeof rawMeta === "string") {
      try { metadata = JSON.parse(rawMeta) as SourceMetadata; } catch { metadata = { kind: "code", language: "text" }; }
    } else if (rawMeta && typeof rawMeta === "object") {
      metadata = rawMeta as SourceMetadata;
    } else {
      metadata = { kind: "code", language: "text" };
    }

    return {
      id: record.id as string,
      chunk_id: record.chunk_id as string,
      source_id: record.source_id as string,
      type: record.type as SourceType,
      title: record.title as string,
      content: record.content as string ?? "",
      tags,
      path: record.path as string,
      file_blake3: record.file_blake3 as string,
      semantic_blake3: record.semantic_blake3 as string,
      chunk_index: (record.chunk_index as number) ?? 0,
      total_chunks: (record.total_chunks as number) ?? 1,
      embeddings,
      metadata,
      created_at: record.created_at as string,
      updated_at: record.updated_at as string,
    };
  }

  private fileIndexToRecord(index: FileIndex): Record<string, unknown> {
    return {
      path: index.path,
      file_blake3: index.file_blake3,
      language: index.language,
      imports: JSON.stringify(index.imports),
      exports: JSON.stringify(index.exports),
      symbols: JSON.stringify(index.symbols),
      relationships: JSON.stringify(index.relationships),
      last_parsed: index.last_parsed,
      ast_text: this.generateAstText(index),
    };
  }

  /** Generate flat text projection of AST data for FTS search. */
  private generateAstText(index: FileIndex): string {
    const parts: string[] = [];

    for (const imp of index.imports) {
      parts.push(`import:${imp.source}:${imp.specifiers.join(",")}`);
    }
    for (const exp of index.exports) {
      parts.push(`export:${exp.name}:${exp.kind}`);
    }
    for (const sym of index.symbols) {
      parts.push(`symbol:${sym.kind}:${sym.name}[${sym.startPosition.line}]`);
    }
    for (const rel of index.relationships) {
      parts.push(`relationship:${rel.type}:${rel.source}:${rel.target}`);
    }

    return parts.join(" ");
  }

  private recordToFileIndex(record: Record<string, unknown>): FileIndex {
    const parseJsonArray = <T>(val: unknown, fallback: T[]): T[] => {
      if (typeof val === "string") {
        try { return JSON.parse(val) as T[]; } catch { return fallback; }
      }
      if (Array.isArray(val)) return val as T[];
      return fallback;
    };

    return {
      path: record.path as string,
      file_blake3: record.file_blake3 as string,
      language: record.language as string,
      imports: parseJsonArray<import("../../domain/ast").Import>(record.imports, []),
      exports: parseJsonArray<import("../../domain/ast").Export>(record.exports, []),
      symbols: parseJsonArray<import("../../domain/ast").SymbolDetail>(record.symbols, []),
      relationships: parseJsonArray<import("../../domain/ast").Relationship>(record.relationships, []),
      last_parsed: record.last_parsed as string,
    };
  }
}

// ── SQL helpers ──────────────────────────────────────────────

/** Escape a string for use in a LanceDB SQL predicate (single-quoted). */
function escapeLanceSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/** Build a SQL IN filter for source types. */
function buildTypeFilter(types: SourceType[]): string {
  const escaped = types.map((t) => `'${escapeLanceSqlString(t)}'`).join(", ");
  return `type IN (${escaped})`;
}

/** Build a SQL filter for tags (JSON contains check). */
function buildTagFilter(tags: string[]): string {
  const conditions = tags.map((t) => `tags LIKE '%"${escapeLanceSqlString(t)}"%'`);
  return conditions.join(" OR ");
}
