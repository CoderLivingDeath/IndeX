// ---------------------------------------------------------------------------
// CLI — RED tests
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { parseArgs } from "../../../src/presentation/cli/cli";

describe("CLI argument parsing", () => {
  test("parses index command", () => {
    const result = parseArgs(["index", "./vault"]);
    expect(result.command).toBe("index");
    expect(result.args).toEqual(["./vault"]);
  });

  test("parses search command with flags", () => {
    const result = parseArgs(["search", "query text", "--mode", "hybrid", "--top-k", "5"]);
    expect(result.command).toBe("search");
    expect(result.args).toEqual(["query text"]);
    expect(result.flags.mode).toBe("hybrid");
    expect(result.flags["top-k"]).toBe("5");
  });

  test("parses pack command with output flag", () => {
    const result = parseArgs(["pack", "./vault", "-o", "bundle.md"]);
    expect(result.command).toBe("pack");
    expect(result.args).toEqual(["./vault"]);
    expect(result.flags.o).toBe("bundle.md");
  });

  test("parses pack command with include/exclude flags", () => {
    const result = parseArgs(["pack", ".", "--include", "**/*.md", "--exclude", "node_modules,.git"]);
    expect(result.command).toBe("pack");
    expect(result.args).toEqual(["."]);
    expect(result.flags.include).toBe("**/*.md");
    expect(result.flags.exclude).toBe("node_modules,.git");
  });

  test("parses chunk command", () => {
    const result = parseArgs(["chunk", "./vault"]);
    expect(result.command).toBe("chunk");
    expect(result.args).toEqual(["./vault"]);
  });

  test("parses embed command", () => {
    const result = parseArgs(["embed", "./vault"]);
    expect(result.command).toBe("embed");
    expect(result.args).toEqual(["./vault"]);
  });

  test("parses watch command", () => {
    const result = parseArgs(["watch", "./vault"]);
    expect(result.command).toBe("watch");
    expect(result.args).toEqual(["./vault"]);
  });

  test("parses stats command", () => {
    const result = parseArgs(["stats"]);
    expect(result.command).toBe("stats");
    expect(result.args).toEqual([]);
  });

  test("parses clear command", () => {
    const result = parseArgs(["clear"]);
    expect(result.command).toBe("clear");
    expect(result.args).toEqual([]);
  });

  test("parses --help flag", () => {
    const result = parseArgs(["--help"]);
    expect(result.command).toBe("help");
  });

  test("unknown command returns help", () => {
    const result = parseArgs(["unknown"]);
    expect(result.command).toBe("help");
  });

  test("empty args returns help", () => {
    const result = parseArgs([]);
    expect(result.command).toBe("help");
  });
});