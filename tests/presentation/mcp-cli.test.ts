import { describe, expect, test } from "bun:test";
import { join } from "path";
import { createProgram } from "../../src/presentation/cli/cli";

const repoRoot = join(import.meta.dir, "..", "..");
const cliPath = join(repoRoot, "src", "presentation", "cli", "cli.ts");

describe("MCP CLI", () => {
  test("registers mcp and does not expose the removed index command", () => {
    const program = createProgram();
    const names = program.commands.map((c) => c.name());

    expect(names).toContain("mcp");
    expect(names).toContain("embed");
    expect(names).toContain("sync");
    expect(names).not.toContain("index");
  });

  test(
    "starts with a clean stdout and exits when stdin closes",
    async () => {
      const proc = Bun.spawn([process.execPath, "run", cliPath, "mcp"], {
        cwd: repoRoot,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      proc.stdin.end();
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
    },
    30_000,
  );
});
