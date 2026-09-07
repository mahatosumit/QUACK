import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { IncrementalEditor } from "./incremental-editor.js";
import { type EditOperation } from "../types.js";

describe("IncrementalEditor", () => {
  const mockSl = {
    symbolDb: {
      getByFile: mock.fn(async () => []),
    },
  } as any;

  const editor = new IncrementalEditor(mockSl);

  it("plan creates a valid editing plan", async () => {
    const ops: EditOperation[] = [
      { path: "src/test.ts", originalContent: "old", newContent: "new", description: "Update test" },
    ];
    const plan = await editor.plan("Modify test file", ops);
    assert.equal(plan.goal, "Modify test file");
    assert.equal(plan.operations.length, 1);
    assert.equal(plan.affectedFiles.length, 1);
    assert.equal(plan.affectedFiles[0], "src/test.ts");
  });

  it("plan detects low risk for single small file", async () => {
    const ops: EditOperation[] = [
      { path: "a.ts", originalContent: "x", newContent: "y", description: "a" },
    ];
    const plan = await editor.plan("Small change", ops);
    assert.equal(plan.riskAssessment, "low");
    assert.equal(plan.requiresReview, false);
  });

  it("plan detects high risk for many files", async () => {
    const ops: EditOperation[] = Array.from({ length: 6 }, (_, i) => ({
      path: `file${i}.ts`,
      originalContent: "old",
      newContent: "new" + "x".repeat(300),
      description: `Edit ${i}`,
    }));
    const plan = await editor.plan("Large change", ops);
    assert.equal(plan.riskAssessment, "high");
    assert.equal(plan.requiresReview, true);
  });

  it("generateDiff produces correct diff format", async () => {
    const diff = await editor.generateDiff("line1\nline2\nline3", "line1\nmodified\nline3");
    assert.ok(diff.includes("@@"));
    assert.ok(diff.includes("-line2"));
    assert.ok(diff.includes("+modified"));
  });

  it("generateDiff returns empty for identical content", async () => {
    const diff = await editor.generateDiff("same", "same");
    assert.equal(diff, "");
  });

  it("identifyPermissions includes workspace.write", async () => {
    const ops: EditOperation[] = [
      { path: "f.ts", originalContent: "a", newContent: "b", description: "e" },
    ];
    const plan = await editor.plan("Change", ops);
    assert.ok(plan.requiredPermissions.includes("workspace.read"));
    assert.ok(plan.requiredPermissions.includes("workspace.write"));
  });
});
