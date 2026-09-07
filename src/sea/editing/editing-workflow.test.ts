import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { EditingWorkflow } from "./editing-workflow.js";

describe("EditingWorkflow", () => {
  it("execute returns result with applied=false when patches fail", async () => {
    const mockSl = {
      patches: {
        createFullPatch: mock.fn(() => ({ id: "patch-1", description: "", files: [], timestamp: "", status: "pending" })),
        validatePatch: mock.fn(() => ({ valid: false, errors: ["unknown language"], warnings: [], compileErrors: [], lintErrors: [], typeErrors: [], testFailures: [], durationMs: 0 })),
        applyPatch: mock.fn(() => ({ success: false, errors: [] })),
      },
      validator: {
        typeCheck: mock.fn(async () => []),
        lint: mock.fn(async () => []),
      },
      getFiles: mock.fn(() => []),
    } as any;

    const mockBrain = { requestPermission: mock.fn(async () => true), getMemory: mock.fn(() => ({ write: mock.fn() })) } as any;
    const mockEventBus = { emit: mock.fn() } as any;
    const mockConfig = { dataDir: "/tmp", maxParallelValidations: 2 } as any;

    const wf = new EditingWorkflow(mockBrain, mockSl, mockEventBus, mockConfig);
    const plan = {
      goal: "Test",
      operations: [{ path: "f.ts", originalContent: "a", newContent: "b", description: "e" }],
      affectedFiles: ["f.ts"],
      riskAssessment: "low" as const,
      requiresReview: false,
      requiredPermissions: ["workspace.read", "workspace.write"],
    };
    const result = await wf.execute(plan);
    assert.equal(result.applied, false);
    assert.ok(typeof result.summary === "string");
  });
});
