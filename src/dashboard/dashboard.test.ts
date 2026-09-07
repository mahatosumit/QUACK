import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedQuackSystem } from "../test-support/isolated-system.js";

test("DeveloperDashboard renders agent skill and observability snapshot", async () => {
  const fixture = await createIsolatedQuackSystem();
  const { system } = fixture;
  try {
  await system.events.emit("capability.denied", {
    capabilityId: "permission.workspace.read",
    decision: "denied",
    resource: { kind: "workspace" },
  }, { actor: "test" });
  await system.events.emit("evaluation.completed", { success: false, score: 20 }, { actor: "test" });

  const snapshot = system.dashboard.snapshot();
  assert.ok(snapshot.agentStatus.some((agent) => agent.id === "coding-agent"));
  assert.ok(snapshot.skillExecution.length > 0);
  assert.equal(snapshot.capabilityDecisions.length, 1);
  assert.equal(snapshot.evaluations.length, 1);
  assert.match(system.dashboard.renderText(), /QUACK Developer Dashboard/);
  } finally {
    await fixture.cleanup();
  }
});
