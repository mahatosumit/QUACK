import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId } from "../core/types.js";
import { createQuackSystem } from "../distributions/swe-system.js";
import { QuackApi } from "./index.js";
import { canonicalFixture } from "../test-support/canonical-runtime.js";

test("QuackApi exposes mission submission status traces and evaluations", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_api_workspace"));
  const dataDir = join(tmpdir(), createId("quack_api_state"));
  await mkdir(workspaceRoot, { recursive: true });
  try {
    const system = createQuackSystem({
      workspaceRoot,
      dataDir,
      permissions: ["workspace.read", "memory.read", "memory.write"],
    });
    const status = await system.api.submitMission({ goal: "inspect workspace", actor: "test-api" });

    // Mission should complete (not stay in IDLE/OBSERVING) - may pass or fail verification
    // Key is that the API call works, trace is created, evaluation happens
    assert.ok(status.state !== "IDLE" && status.state !== "OBSERVING", `Mission should have run, got state: ${status.state}`);
    assert.ok(status.iterations > 0, "Should have at least one iteration");
    assert.ok(system.api.getStatus(status.loopId) !== undefined, "Status should be retrievable");
    assert.ok(system.api.getTrace(status.loopId) !== undefined, "Trace should be retrievable");
    assert.ok(system.api.getEvaluation(status.loopId) !== undefined, "Evaluation should be retrievable");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("API uses canonical run evidence and records mission learning only once", async () => {
  const workspaceRoot = join(tmpdir(), createId("api_canonical"));
  const dataDir = join(workspaceRoot, "state");
  await mkdir(workspaceRoot, { recursive: true });
  const fixture = canonicalFixture();
  try {
    const system = createQuackSystem({ workspaceRoot, dataDir });
    const api = new QuackApi({ ...system, runtime: fixture.runtime });
    const status = await api.submitMission({ goal: fixture.graph.description, actor: "observer", missionId: "measurement" });
    assert.equal(status.state, "COMPLETED");
    assert.equal(fixture.runtime.getLoopResult(status.loopId)?.totalToolCalls, 3);
    assert.equal(api.getTrace(status.loopId)?.toolsExecuted.length, 3);
    assert.equal(fixture.learning.length, 1);
    assert.equal((await fixture.runtime.listTasks()).length, 1);
  } finally {
    await fixture.runtime.shutdown();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
