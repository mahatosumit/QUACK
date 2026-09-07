import assert from "node:assert/strict";
import { QuackNativeHarness } from "./registry.js";

async function run(): Promise<void> {
  const config = { harnessId: "QUACK_NATIVE" };
  const harness = new QuackNativeHarness({ runtime: { executeTool: async () => { throw new Error("Unexpected dispatch"); } } }, config);
  await harness.start(config);
  try {
    assert.equal(harness.capabilities().subagents, "UNSUPPORTED");
    assert.equal(harness.capabilities().continuableSubagents, "UNSUPPORTED");
    for (const continuation of ["ONE_SHOT", "CONTINUABLE"] as const) {
      await assert.rejects(() => harness.spawnSubagent({ taskId: "child", goal: "fixture", role: "fixture",
        capabilities: [], allowedTools: [], deniedTools: [], depth: 1, maxDepth: 2, parentId: "parent",
        missionId: "fixture", continuation }), /does not support subagents/);
    }
    console.log("PASS: both child modes reject unsupported execution. Child authority, lineage, joining and recovery are not implemented or certified.");
  } finally { await harness.dispose(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
