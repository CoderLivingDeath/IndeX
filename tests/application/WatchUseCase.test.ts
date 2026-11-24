// ---------------------------------------------------------------------------
// WatchUseCase — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";

import type { FileWatcher } from "../../src/domain/ports/FileWatcher";
import type { FileFilter } from "../../src/domain/ports/FileFilter";
import type { SourceParserRegistry } from "../../src/domain/ports/SourceParserRegistry";
import { MockChunker } from "../mocks/MockChunker";
import { MockHasher } from "../mocks/MockHasher";
import { MockEmbedderRegistry } from "../mocks/MockEmbedderRegistry";
import { MockSourceRepository } from "../mocks/MockSourceRepository";
import { DiffIndexingService } from "../../src/domain/services/DiffIndexingService";
import { WatchUseCase } from "../../src/application/WatchUseCase";

// --------------------------------------------------------------------------
// Mocks
// --------------------------------------------------------------------------

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeMockParserRegistry(): SourceParserRegistry {
  const parser = {
    type: "code" as const,
    extensions: [".ts"],
    supportsFile: (p: string) => p.endsWith(".ts"),
    parse: async (path: string) => ({
      type: "code" as const,
      path,
      content: "parsed content",
      tags: [] as string[],
      metadata: { kind: "code" as const, language: "typescript" },
      file_blake3: "mock-hash",
      last_parsed: new Date().toISOString(),
    }),
  };
  return {
    getParser: () => parser,
    register: () => {},
  };
}

function makeDiffService(): DiffIndexingService {
  const filter: FileFilter = {
    formats: [".ts"],
    shouldInclude: () => true,
  };
  return new DiffIndexingService(
    new MockHasher(),
    makeMockParserRegistry(),
    new MockChunker([]),
    new MockEmbedderRegistry({}),
    new MockSourceRepository(),
    filter,
  );
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("WatchUseCase", () => {
  describe("execute — starts watcher", () => {
    test("calls watcher.start() on execute", async () => {
      let started = false;

      const watcher: FileWatcher = {
        on: () => {},
        start: async () => { started = true; },
        stop: async () => {},
      };

      const useCase = new WatchUseCase(watcher, makeDiffService(), mockLogger, new MockSourceRepository());
      await useCase.execute("./vault");

      expect(started).toBe(true);
    });

    test("calls diffService.diffIndexFile on change events", async () => {
      let diffCalled = false;
      let capturedPath = "";

      const diffService = makeDiffService();
      diffService.diffIndexFile = async (filePath: string) => {
        diffCalled = true;
        capturedPath = filePath;
        return { indexed: 1, skipped: 0, errors: 0 };
      };

      let changeHandler: ((path: string) => void) | null = null;

      const watcher: FileWatcher = {
        on: (event: string, cb: (path: string) => void) => {
          if (event === "change") changeHandler = cb;
        },
        start: async () => {},
        stop: async () => {},
      };

      const useCase = new WatchUseCase(watcher, diffService, mockLogger, new MockSourceRepository());
      await useCase.execute("./vault");

      // Simulate a file change
      const handler = changeHandler as ((path: string) => void) | null;
      if (handler) {
        await handler("/vault/file.ts");
      }

      expect(diffCalled).toBe(true);
      expect(capturedPath).toBe("/vault/file.ts");
    });

    test("calls diffService.diffIndexFile on add events", async () => {
      let diffCalled = false;

      const diffService = makeDiffService();
      diffService.diffIndexFile = async () => {
        diffCalled = true;
        return { indexed: 1, skipped: 0, errors: 0 };
      };

      let addHandler: ((path: string) => void) | null = null;

      const watcher: FileWatcher = {
        on: (event: string, cb: (path: string) => void) => {
          if (event === "add") addHandler = cb;
        },
        start: async () => {},
        stop: async () => {},
      };

      const useCase = new WatchUseCase(watcher, diffService, mockLogger, new MockSourceRepository());
      await useCase.execute("./vault");

      const handler = addHandler as ((path: string) => void) | null;
      if (handler) {
        await handler("/vault/new.ts");
      }

      expect(diffCalled).toBe(true);
    });
  });

  describe("unlink — removes from index", () => {
    test("deletes chunks and file index for the removed path", async () => {
      const repo = new MockSourceRepository();
      const filePath = "/vault/deleted.ts";
      const now = new Date().toISOString();

      await repo.upsert({
        id: "chunk-1",
        chunk_id: "chunk-1",
        source_id: "src-1",
        type: "code",
        title: filePath,
        content: "deleted content",
        tags: [],
        path: filePath,
        file_blake3: "file-hash",
        semantic_blake3: "sem-hash",
        chunk_index: 0,
        total_chunks: 1,
        embeddings: [],
        metadata: { kind: "code", language: "typescript" },
        created_at: now,
        updated_at: now,
      });
      await repo.upsertFileIndex({
        path: filePath,
        file_blake3: "file-hash",
        language: "typescript",
        imports: [],
        exports: [],
        symbols: [],
        relationships: [],
        last_parsed: now,
      });

      let unlinkHandler: ((path: string) => void) | null = null;
      const watcher: FileWatcher = {
        on: (event: string, cb: (path: string) => void) => {
          if (event === "unlink") unlinkHandler = cb;
        },
        start: async () => {},
        stop: async () => {},
      };

      const useCase = new WatchUseCase(watcher, makeDiffService(), mockLogger, repo);
      await useCase.execute("./vault");
      await unlinkHandler!(filePath);

      expect(await repo.getByPath(filePath)).toHaveLength(0);
      expect(await repo.getFileIndex(filePath)).toBeNull();
    });

    test("tolerates unlink for a path that is not indexed", async () => {
      const repo = new MockSourceRepository();
      let unlinkHandler: ((path: string) => void) | null = null;
      const watcher: FileWatcher = {
        on: (event: string, cb: (path: string) => void) => {
          if (event === "unlink") unlinkHandler = cb;
        },
        start: async () => {},
        stop: async () => {},
      };

      const useCase = new WatchUseCase(watcher, makeDiffService(), mockLogger, repo);
      await useCase.execute("./vault");

      await expect(Promise.resolve(unlinkHandler!("/vault/missing.ts"))).resolves.toBeUndefined();
    });
  });

  describe("stop — stops watcher", () => {
    test("calls watcher.stop() on stop", async () => {
      let stopped = false;

      const watcher: FileWatcher = {
        on: () => {},
        start: async () => {},
        stop: async () => { stopped = true; },
      };

      const useCase = new WatchUseCase(watcher, makeDiffService(), mockLogger, new MockSourceRepository());
      await useCase.execute("./vault");
      await useCase.stop();

      expect(stopped).toBe(true);
    });
  });
});