import assert from "node:assert/strict";
import { QuackNativeHarness } from "../harness/registry.js";

async function run(): Promise<void> {
  const config = { harnessId: "QUACK_NATIVE" };
  const harness = new QuackNativeHarness({ runtime: { executeTool: async () => { throw new Error("Unexpected dispatch"); } } }, config);
  await harness.start(config);
  try {
    assert.equal(harness.capabilities().backgroundJobs, "UNSUPPORTED");
    await assert.rejects(() => harness.startBackgroundJob({ id: "fixture", missionId: "fixture", agentId: "fixture",
      type: "fixture", command: "unused", args: [], workingDirectory: process.cwd(), environment: {}, resourceLimits: {} }), /does not support backgroundJobs/);
    await assert.rejects(() => harness.getBackgroundJobStatus("unknown"), /does not support backgroundJobs/);
    console.log("PASS: unsupported background execution and status reject. No background wake/resume lifecycle is certified.");
  } finally { await harness.dispose(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
