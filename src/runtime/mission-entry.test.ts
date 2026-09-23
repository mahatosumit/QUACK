import test from "node:test";
import assert from "node:assert/strict";
import { ok } from "../core/types.js";
import { createQuackSystem } from "../system/create-system.js";
import { createIsolatedQuackSystem } from "../test-support/isolated-system.js";

test("canonical mission entry rejects empty objectives and unavailable engines", async () => {
  const system = createQuackSystem();

  const empty = await system.runtime.submitMission({ objective: "   " });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.error.code, "mission.objective_empty");

  const unavailable = await system.runtime.submitMission({
    objective: "Inspect the workspace",
    engine: "governed",
  });
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.error.code, "mission.engine_unavailable");
});

test("canonical runtime normalizes and dispatches a registered governed engine", async () => {
  const system = createQuackSystem();
  let observedMissionId = "";

  system.runtime.registerMissionEngine({
    engine: "governed",
    execute: async (request) => {
      observedMissionId = request.missionId;
      assert.equal(request.objective, "Inspect the workspace");
      assert.equal(request.actor, "operator");
      assert.equal(request.origin, "api");
      assert.equal(request.mode, "mission");
      assert.deepEqual(request.permissions, ["workspace.read"]);
      assert.deepEqual(request.constraints, ["read only"]);
      assert.ok(Object.isFrozen(request.permissions));
      assert.ok(Object.isFrozen(request.constraints));
      return ok({
        missionId: request.missionId,
        executionId: "run-1",
        engine: "governed",
        mode: request.mode,
        state: "COMPLETED",
        iterations: 2,
      });
    },
  });

  const result = await system.runtime.submitMission({
    objective: "  Inspect the workspace  ",
    actor: " operator ",
    origin: "api",
    engine: "governed",
    permissions: ["workspace.read"],
    constraints: ["read only"],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.missionId, observedMissionId);
  assert.match(result.data.missionId, /^mission_/);
  assert.equal(result.data.executionId, "run-1");
  assert.equal(result.data.state, "COMPLETED");
  assert.throws(() => system.runtime.registerMissionEngine({
    engine: "governed",
    execute: async () => result,
  }), /already registered/);
});

test("canonical runtime rejects engine identity substitution", async () => {
  const system = createQuackSystem();
  system.runtime.registerMissionEngine({
    engine: "governed",
    execute: async (request) => ok({
      missionId: `${request.missionId}-forged`,
      executionId: "run-forged",
      engine: "governed",
      mode: request.mode,
      state: "COMPLETED",
      iterations: 1,
    }),
  });

  const result = await system.runtime.submitMission({
    missionId: "mission-trusted",
    objective: "Inspect the workspace",
    engine: "governed",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "mission.engine_contract_violation");
});

test("legacy submitGoal is an adapter over the canonical DAG entry", async () => {
  const system = createQuackSystem();
  const canonical = await system.runtime.submitMission({ objective: "No planner configured", engine: "dag" });
  const legacy = await system.runtime.submitGoal("No planner configured");

  assert.equal(canonical.ok, true);
  assert.equal(legacy.ok, true);
  if (!canonical.ok || !legacy.ok) return;
  assert.equal(canonical.data.engine, "dag");
  assert.equal(canonical.data.task?.status, "failed");
  assert.equal(legacy.data.status, "failed");
  assert.equal(canonical.data.task?.error?.code, legacy.data.error?.code);
});

test("legacy submitGoal preserves delegated agent and skill identity", async () => {
  const fixture = await createIsolatedQuackSystem();
  try {
    const result = await fixture.system.runtime.submitGoal("Inspect identity", "delegate", {
      missionId: "mission-identity",
      agentId: "agent-specialist",
      skillId: "skill-inspection",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.execution?.missionId, "mission-identity");
    assert.equal(result.data.execution?.agentId, "agent-specialist");
    assert.equal(result.data.execution?.skillId, "skill-inspection");
  } finally {
    await fixture.cleanup();
  }
});
