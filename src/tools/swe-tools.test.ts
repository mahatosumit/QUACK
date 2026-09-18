import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitCommitTool, TestRunTool, DocsGenerateTool } from "./swe-tools.js";

const dummyContext = {
  taskId: "task-fixture",
  actor: "test-actor",
};

test("GitCommitTool validates input and rejects empty messages", () => {
  const tool = new GitCommitTool({ workspaceRoot: "." });
  assert.equal(tool.validateInput({}).ok, false);
  assert.equal(tool.validateInput({ message: "" }).ok, false);
  assert.equal(tool.validateInput({ message: "   " }).ok, false);
  assert.ok(tool.validateInput({ message: "feat: initial commit" }).ok);
});

test("TestRunTool executes real bounded command", async () => {
  const tool = new TestRunTool({ workspaceRoot: "." });
  const validation = tool.validateInput({ command: "node -e 'console.log(42)'" });
  assert.ok(validation.ok);
  if (validation.ok) {
    const result = await tool.execute(validation.data, dummyContext);
    assert.equal(result.output.passed, true);
    assert.match(result.output.stdout, /42/);
  }
});

test("DocsGenerateTool generates workspace documentation file", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "quack-docs-test-"));
  try {
    await writeFile(join(tempDir, "package.json"), JSON.stringify({ name: "fixture-app", description: "A test fixture" }));
    await writeFile(join(tempDir, "index.ts"), "export const a = 1;");

    const tool = new DocsGenerateTool({ workspaceRoot: tempDir });
    const validation = tool.validateInput({ outputPath: "docs/OVERVIEW.md" });
    assert.ok(validation.ok);
    if (validation.ok) {
      const result = await tool.execute(validation.data, dummyContext);
      assert.ok(result.output.filesIndexed >= 1);
      assert.ok(result.output.byteLength > 0);
      assert.match(result.output.summary, /Successfully generated/);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
