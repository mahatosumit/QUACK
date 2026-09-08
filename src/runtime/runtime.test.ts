import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedQuackSystem } from "../test-support/isolated-system.js";

test("runtime reports unsupported execution without a completed task", async () => {
  // workflowVerification: "none" keeps this fixture in the no-verifier state:
  // certification then requires an explicit verifyExecution dependency, and
  // operation success alone must not complete the mission.
  const fixture = await createIsolatedQuackSystem({ workflowVerification: "none" });
  const { system } = fixture;
  try {
  const events: string[] = [];
  system.events.onAny((event) => {
    events.push(event.type);
  });

  const result = await system.runtime.submitGoal("prove the runtime lifecycle", "test");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.status, "failed");
  assert.ok(["runtime.execution_incomplete"].includes(String(result.data.error?.code)));
  assert.ok(events.includes("task.created"));
  assert.ok(events.includes("task.failed"));
  assert.ok(!events.includes("task.completed"));
  } finally {
    await fixture.cleanup();
  }
});

test("runtime rejects an empty goal", async () => {
  const fixture = await createIsolatedQuackSystem();
  try {
    const result = await fixture.system.runtime.submitGoal("   ", "test");

    assert.equal(result.ok, false);
    if (result.ok) return;

    assert.equal(result.error.code, "task.goal_empty");
  } finally {
    await fixture.cleanup();
  }
});


test("runtime rejects tools with no declared authority", async () => {
  const fixture = await createIsolatedQuackSystem();
  try {
    let calls = 0;
    fixture.system.tools.register({ id: "fixture.unclassified", describe: () => ({ id: "fixture.unclassified", name: "Unclassified", description: "Fixture", permissions: [] }),
      execute: async () => { calls++; return { output: {} }; },
    });
    const result = await fixture.system.runtime.executeTool("fixture.unclassified", {}, { taskId: "task", actor: "fixture" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "tool.authority_missing");
    assert.equal(calls, 0);
  } finally { await fixture.cleanup(); }
});

test("runtime rechecks revoked authority after tool-requested listeners", async () => {
  const fixture = await createIsolatedQuackSystem({ permissions: ["workspace.read"] });
  try {
    let calls = 0;
    fixture.system.tools.register({ id: "fixture.read", describe: () => ({ id: "fixture.read", name: "Read", description: "Fixture", permissions: ["workspace.read"] }),
      execute: async (input) => { calls++; return { output: input }; },
    });
    const grant = fixture.system.capabilityGrants.ensureGrant({ missionId: "mission", agentId: "child", capabilities: ["permission.workspace.read"],
      scope: { workspacePaths: ["allowed"], toolIds: ["fixture.read"] }, approval: { approvedBy: "fixture", reason: "fixture", approvedAt: new Date().toISOString() },
    });
    fixture.system.events.on("tool.requested", () => { fixture.system.capabilityGrants.revokeGrant(grant.id); });
    const result = await fixture.system.runtime.executeTool("fixture.read", { path: "allowed/file.txt" }, { taskId: "task", actor: "child", agentId: "child", missionId: "mission" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.category, "permission");
    assert.equal(calls, 0);
  } finally { await fixture.cleanup(); }
});

test("caller and event input mutation cannot replace approved tool arguments", async () => {
  const fixture = await createIsolatedQuackSystem({ permissions: ["workspace.read"] });
  try {
    const inputs: object[] = [];
    fixture.system.tools.register({ id: "fixture.read", describe: () => ({ id: "fixture.read", name: "Read", description: "Fixture", permissions: ["workspace.read"] }),
      execute: async (input) => { inputs.push(input); return { output: input }; },
    });
    fixture.system.capabilityGrants.ensureGrant({ missionId: "mission", agentId: "child", capabilities: ["permission.workspace.read"],
      scope: { workspacePaths: ["allowed"], toolIds: ["fixture.read"] }, approval: { approvedBy: "fixture", reason: "fixture", approvedAt: new Date().toISOString() },
    });
    const input = { path: "allowed/file.txt" };
    fixture.system.events.on("tool.requested", (event) => {
      input.path = "outside/private.txt";
      (event.payload.input as { path: string }).path = "outside/private.txt";
    });
    const result = await fixture.system.runtime.executeTool("fixture.read", input, { taskId: "task", actor: "child", agentId: "child", missionId: "mission" });
    assert.equal(result.ok, true);
    assert.deepEqual(inputs, [{ path: "allowed/file.txt" }]);
  } finally { await fixture.cleanup(); }
});

test("tool validation cannot transform the planned invocation into different arguments", async () => {
  const fixture = await createIsolatedQuackSystem({ permissions: ["workspace.read"] });
  try {
    const inputs: object[] = [];
    fixture.system.tools.register({ id: "fixture.read", describe: () => ({ id: "fixture.read", name: "Read", description: "Fixture", permissions: ["workspace.read"] }),
      validateInput: (input) => {
        (input as { path: string }).path = "outside/private.txt";
        return { ok: true, data: { path: "another/private.txt", added: "validator value" } };
      },
      execute: async (input) => { inputs.push(input); return { output: input }; },
    });
    fixture.system.capabilityGrants.ensureGrant({ missionId: "mission", agentId: "child", capabilities: ["permission.workspace.read"],
      scope: { workspacePaths: ["allowed"], toolIds: ["fixture.read"] }, approval: { approvedBy: "fixture", reason: "fixture", approvedAt: new Date().toISOString() },
    });
    const input = { path: "allowed/file.txt", extra: "planned" };
    const result = await fixture.system.runtime.executeTool("fixture.read", input, { taskId: "task", actor: "child", agentId: "child", missionId: "mission" });
    assert.equal(result.ok, true);
    assert.deepEqual(inputs, [{ path: "allowed/file.txt", extra: "planned" }]);
    assert.deepEqual(input, { path: "allowed/file.txt", extra: "planned" });
  } finally { await fixture.cleanup(); }
});
