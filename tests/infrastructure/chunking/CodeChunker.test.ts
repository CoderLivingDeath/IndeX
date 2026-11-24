import { describe, it, expect } from "bun:test";
import { CodeChunker } from "../../../src/infrastructure/chunking/CodeChunker";
import { MockTokenEstimator } from "../../mocks/MockTokenEstimator";

describe("CodeChunker", () => {
  it("splits code by function boundaries (each function is one chunk)", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new CodeChunker(200, estimator);
    const code = `function foo() {
  return 1;
}

function bar() {
  return 2;
}`;

    const result = await chunker.chunk(code);

    expect(result.length).toBeGreaterThanOrEqual(2);
    // Each function should be a separate chunk
    const fnChunks = result.filter((c) => c.content.includes("function"));
    expect(fnChunks.length).toBe(2);
  });

  it("splits code by class boundaries (each class is one chunk)", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new CodeChunker(200, estimator);
    const code = `class Foo {
  bar() { return 1; }
}

class Baz {
  qux() { return 2; }
}`;

    const result = await chunker.chunk(code);

    const classChunks = result.filter((c) => c.content.includes("class"));
    expect(classChunks.length).toBe(2);
  });

  it("no overlap between code chunks", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new CodeChunker(200, estimator);
    const code = `function foo() {
  return 1;
}

function bar() {
  return 2;
}`;

    const result = await chunker.chunk(code);

    // Concatenate all chunks and verify no content is lost or duplicated
    const reconstructed = result.map((c) => c.content).join("\n");
    expect(reconstructed).toContain("function foo()");
    expect(reconstructed).toContain("function bar()");
  });

  it("non-function/class lines become interleaved chunks", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new CodeChunker(200, estimator);
    const code = `import { something } from "somewhere";

function foo() {
  return 1;
}

const x = 42;`;

    const result = await chunker.chunk(code);

    // With interleaved ordering, non-decl code before and after function
    // becomes separate chunks: [import chunk, function foo, const x chunk]
    expect(result.length).toBe(3);
    expect(result[0]!.content).toContain("import");
    expect(result[1]!.content).toContain("function foo");
    expect(result[2]!.content).toContain("const x = 42");
  });

  it("preserves source order with interleaved declarations and non-declarations", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new CodeChunker(200, estimator);
    const code = `const a = 1;
function foo() {
  return a;
}
const b = 2;
function bar() {
  return b;
}`;

    const result = await chunker.chunk(code);

    // Should have 4 chunks in order:
    // 1. "const a = 1;"
    // 2. "function foo() {...}"
    // 3. "const b = 2;"
    // 4. "function bar() {...}"
    expect(result.length).toBe(4);
    expect(result[0]!.content).toContain("const a = 1");
    expect(result[1]!.content).toContain("function foo");
    expect(result[2]!.content).toContain("const b = 2");
    expect(result[3]!.content).toContain("function bar");
  });

  it("has type 'code'", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new CodeChunker(200, estimator);
    expect(chunker.type).toBe("code");
  });

  it("handles empty text", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new CodeChunker(200, estimator);
    const result = await chunker.chunk("");
    expect(result).toHaveLength(0);
  });

  it("handles code without functions or classes as one chunk", async () => {
    const estimator = new MockTokenEstimator(10);
    const chunker = new CodeChunker(200, estimator);
    const code = `const x = 1;
const y = 2;
console.log(x + y);`;

    const result = await chunker.chunk(code);
    expect(result).toHaveLength(1);
  });
});
