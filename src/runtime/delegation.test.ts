import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoveryFixture } from "../test-support/recovery-child.js";
import { DelegationRuntime, assertChildReceipt, delegateFanOut } from "./delegation.js";
import type { Task } from "./task.js";

function parentGrant(grants: ReturnType<typeof recoveryFixture>["grants"]): string {
  return grants.ensureGrant({ missionId: "measurement", capabilities: ["permission.workspace.read", "permission.memory.write"],
    approval: { approvedBy: "fixture", reason: "Parent authority", approvedAt: new Date().toISOString() } }).id;
}

test("delegation runs the child through the canonical runtime and returns a verified receipt chain", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-delegation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = recoveryFixture(dir);
  t.after(() => fixture.runtime.shutdown());
  const grants = fixture.grants;

  const delegator = new DelegationRuntime({ maxDepth: 2, parentGrantId: parentGrant(grants), grants,
    submit: (goal, actor, options) => fixture.runtime.submitGoal(goal, actor, options) });

  const result = await delegator.delegate({
    missionId: "measurement", parentExecutionId: "parent-task-1",
    goal: fixture.graph.description, actor: "observer", agentId: "child-agent",
    capabilities: ["permission.workspace.read"], reason: "Child measurement",
    approvedBy: "parent",
  });

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.data.state, "COMPLETED");
  assert.ok(result.data.childTaskId);
  assert.equal(result.data.depth, 1);
  assert.ok(result.data.childReceipt, "verified completion must expose the child receipt chain");
  assert.equal((result.data.childReceipt as Record<string, unknown>)["verificationStatus"], "PASSED");

  // The child grant is revoked after completion: no authority residue.
  assert.equal(grants.queryActiveGrants({ missionId: "measurement" }).some(g => g.agentId === "child-agent"), false);
});

test("delegation cannot widen authority: escalation fails closed at grant derivation", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-delegation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = recoveryFixture(dir);
  t.after(() => fixture.runtime.shutdown());

  const delegator = new DelegationRuntime({ maxDepth: 2, parentGrantId: parentGrant(fixture.grants), grants: fixture.grants,
    submit: (goal, actor, options) => fixture.runtime.submitGoal(goal, actor, options) });

  const result = await delegator.delegate({
    missionId: "measurement", parentExecutionId: "parent-task-1", goal: fixture.graph.description,
    actor: "observer", agentId: "child-agent",
    capabilities: ["permission.workspace.read", "permission.terminal.execute"],
    reason: "Escalation attempt", approvedBy: "parent",
  });

  assert.ok(!result.ok);
  if (!result.ok) assert.equal(result.error.code, "delegation.attenuation_denied");
  assert.equal(delegator.list().length, 0);
});

test("delegation depth ceiling fails closed", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-delegation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = recoveryFixture(dir);
  t.after(() => fixture.runtime.shutdown());

  const delegator = new DelegationRuntime({ maxDepth: 0, parentGrantId: parentGrant(fixture.grants), grants: fixture.grants,
    submit: (goal, actor, options) => fixture.runtime.submitGoal(goal, actor, options) });

  const result = await delegator.delegate({
    missionId: "measurement", parentExecutionId: "parent-task-1", goal: fixture.graph.description,
    actor: "observer", agentId: "child-agent", capabilities: ["permission.workspace.read"],
    reason: "Too deep", approvedBy: "parent",
  });
  assert.ok(!result.ok);
  if (!result.ok) assert.equal(result.error.code, "delegation.depth_exceeded");
});

test("duplicate active delegation for the same parent execution and goal fails closed", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-delegation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = recoveryFixture(dir);
  t.after(() => fixture.runtime.shutdown());

  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let firstStarted = false;
  const delegator = new DelegationRuntime({ maxDepth: 2, parentGrantId: parentGrant(fixture.grants), grants: fixture.grants,
    submit: async (goal, actor, options) => {
      if (!firstStarted) { firstStarted = true; return fixture.runtime.submitGoal(goal, actor, options); }
      await gate;
      return fixture.runtime.submitGoal(goal, actor, options);
    } });

  const first = delegator.delegate({
    missionId: "measurement", parentExecutionId: "parent-task-1", goal: fixture.graph.description,
    actor: "observer", agentId: "child-agent", capabilities: ["permission.workspace.read"],
    reason: "First", approvedBy: "parent",
  });
  // Wait for the first delegation to become RUNNING before attempting the duplicate.
  await new Promise(resolve => setTimeout(resolve, 20));

  const second = await delegator.delegate({
    missionId: "measurement", parentExecutionId: "parent-task-1", goal: fixture.graph.description,
    actor: "observer", agentId: "child-agent-2", capabilities: ["permission.workspace.read"],
    reason: "Duplicate", approvedBy: "parent",
  });
  assert.ok(!second.ok);
  if (!second.ok) assert.equal(second.error.code, "delegation.duplicate");

  release();
  const settled = await first;
  assert.ok(settled.ok);
  if (settled.ok) assert.equal(settled.data.state, "COMPLETED");
});

test("delegation with missing identity or empty capabilities fails closed", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-delegation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = recoveryFixture(dir);
  t.after(() => fixture.runtime.shutdown());
  const delegator = new DelegationRuntime({ maxDepth: 2, parentGrantId: parentGrant(fixture.grants), grants: fixture.grants,
    submit: (goal, actor, options) => fixture.runtime.submitGoal(goal, actor, options) });

  for (const bad of [
    { missionId: "", parentExecutionId: "p", goal: "g", actor: "a", agentId: "c", capabilities: ["permission.workspace.read"], reason: "r", approvedBy: "p" },
    { missionId: "m", parentExecutionId: "", goal: "g", actor: "a", agentId: "c", capabilities: ["permission.workspace.read"], reason: "r", approvedBy: "p" },
    { missionId: "m", parentExecutionId: "p", goal: "g", actor: "a", agentId: "", capabilities: ["permission.workspace.read"], reason: "r", approvedBy: "p" },
    { missionId: "m", parentExecutionId: "p", goal: "g", actor: "a", agentId: "c", capabilities: [], reason: "r", approvedBy: "p" },
  ]) {
    const result = await delegator.delegate(bad);
    assert.ok(!result.ok);
    assert.ok(["delegation.identity_incomplete", "delegation.capabilities_empty"].includes(!result.ok ? result.error.code : ""));
  }
});

test("delegation revokes the child grant and records FAILED when the child cannot start", async t => {
  const fixture = recoveryFixture(await mkdtemp(join(tmpdir(), "quack-delegation-")));
  t.after(() => fixture.runtime.shutdown());
  let revoked = 0;
  const grants = new Proxy(fixture.grants, {
    get(target, prop) {
      if (prop === "revokeGrant") return (id: string, meta: object) => { revoked += 1; return target.revokeGrant(id, meta); };
      return target[prop as keyof typeof target];
    },
  }) as typeof fixture.grants;

  const delegator = new DelegationRuntime({ maxDepth: 2, parentGrantId: parentGrant(fixture.grants), grants,
    submit: async () => ({ ok: false, error: { code: "runtime.rejected", message: "no planner", category: "runtime", recoverable: false } }) });

  const result = await delegator.delegate({
    missionId: "measurement", parentExecutionId: "parent-task-1", goal: "impossible",
    actor: "observer", agentId: "child-agent", capabilities: ["permission.workspace.read"],
    reason: "Rejected", approvedBy: "parent",
  });
  assert.ok(!result.ok);
  if (!result.ok) assert.equal(result.error.code, "delegation.child_rejected");
  assert.equal(delegator.list()[0].state, "FAILED");
  assert.ok(revoked >= 1, "child grant must be revoked on failure");
});

test("assertChildReceipt rejects forged, unverified, and incomplete child results", () => {
  const completed: Task = { id: "child-1", goal: "g", status: "completed", createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z", plan: [],
    result: { receipt: { evidenceId: "evidence-1", verificationStatus: "PASSED", verificationId: "v1" } } };
  assert.ok(assertChildReceipt(completed).ok);

  const failed: Task = { ...completed, status: "failed" };
  assert.ok(!assertChildReceipt(failed).ok);

  const noReceipt: Task = { ...completed, result: {} };
  assert.ok(!assertChildReceipt(noReceipt).ok);

  const forged: Task = { ...completed, result: { receipt: { verificationStatus: "FAILED" } } };
  assert.ok(!assertChildReceipt(forged).ok);

  const unverified: Task = { ...completed, result: { receipt: { evidenceId: "evidence-1", verificationStatus: "INCONCLUSIVE" } } };
  assert.ok(!assertChildReceipt(unverified).ok);
});

test("fan-out completes only when every child produces a verified receipt", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-fanout-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = recoveryFixture(dir);
  t.after(() => fixture.runtime.shutdown());

  const delegator = new DelegationRuntime({ maxDepth: 2, parentGrantId: parentGrant(fixture.grants), grants: fixture.grants,
    submit: (goal, actor, options) => fixture.runtime.submitGoal(goal, actor, options) });

  const result = await delegateFanOut(delegator, {
    missionId: "measurement", parentExecutionId: "parent-fanout-1", actor: "observer",
    reason: "Fan-out measurements", approvedBy: "parent",
    children: [
      { agentId: "child-a", goal: fixture.graph.description, capabilities: ["permission.workspace.read"] },
      { agentId: "child-b", goal: fixture.graph.description, capabilities: ["permission.workspace.read"] },
    ],
  });

  assert.equal(result.state, "COMPLETED");
  assert.equal(result.complete, true);
  assert.equal(result.children.length, 2);
  for (const child of result.children) {
    assert.equal(child.state, "COMPLETED");
    assert.ok(child.receipt, "each child must present a verified receipt");
    assert.equal((child.receipt as Record<string, unknown>)["verificationStatus"], "PASSED");
  }
  // All derived grants were revoked after completion.
  assert.equal(fixture.grants.queryActiveGrants({ missionId: "measurement" }).some(g => g.agentId === "child-a" || g.agentId === "child-b"), false);
});

test("fan-out with one failed child reports PARTIAL and never completes the parent", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-fanout-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = recoveryFixture(dir);
  t.after(() => fixture.runtime.shutdown());

  const delegator = new DelegationRuntime({ maxDepth: 2, parentGrantId: parentGrant(fixture.grants), grants: fixture.grants,
    submit: async (goal, actor, options) => {
      if (goal === "impossible child") return { ok: false, error: { code: "runtime.rejected", message: "child rejected", category: "runtime", recoverable: false } };
      return fixture.runtime.submitGoal(goal, actor, options);
    } });

  const result = await delegateFanOut(delegator, {
    missionId: "measurement", parentExecutionId: "parent-fanout-2", actor: "observer",
    reason: "Fan-out with failure", approvedBy: "parent",
    children: [
      { agentId: "child-good", goal: fixture.graph.description, capabilities: ["permission.workspace.read"] },
      { agentId: "child-bad", goal: "impossible child", capabilities: ["permission.workspace.read"] },
    ],
  });

  assert.equal(result.state, "PARTIAL");
  assert.equal(result.complete, false);
  assert.equal(result.children[0].state, "COMPLETED");
  assert.equal(result.children[1].state, "FAILED");
  assert.ok(result.children[1].error);
});

test("fan-out cancellation before child start records CANCELLED and reports PARTIAL", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-fanout-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = recoveryFixture(dir);
  t.after(() => fixture.runtime.shutdown());

  const delegator = new DelegationRuntime({ maxDepth: 2, parentGrantId: parentGrant(fixture.grants), grants: fixture.grants,
    submit: (goal, actor, options) => fixture.runtime.submitGoal(goal, actor, options) });
  const controller = new AbortController();
  controller.abort();

  const result = await delegateFanOut(delegator, {
    missionId: "measurement", parentExecutionId: "parent-fanout-3", actor: "observer",
    reason: "Cancelled fan-out", approvedBy: "parent", signal: controller.signal,
    children: [{ agentId: "child-x", goal: fixture.graph.description, capabilities: ["permission.workspace.read"] }],
  });

  assert.equal(result.state, "PARTIAL");
  assert.equal(result.complete, false);
  assert.equal(result.children[0].state, "CANCELLED");
});

test("empty fan-out fails deterministically", async () => {
  const delegator = new DelegationRuntime({ maxDepth: 1, parentGrantId: "grant-x", grants: {} as never,
    submit: async () => { throw new Error("unreachable"); } });
  const result = await delegateFanOut(delegator, {
    missionId: "m", parentExecutionId: "p", actor: "a", reason: "r", approvedBy: "p", children: [],
  });
  assert.equal(result.state, "FAILED");
  assert.equal(result.complete, false);
  assert.equal(result.children.length, 0);
});

test("fan-out depth exhaustion is reported per child without completing the parent", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-fanout-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = recoveryFixture(dir);
  t.after(() => fixture.runtime.shutdown());

  const delegator = new DelegationRuntime({ maxDepth: 0, parentGrantId: parentGrant(fixture.grants), grants: fixture.grants,
    submit: (goal, actor, options) => fixture.runtime.submitGoal(goal, actor, options) });

  const result = await delegateFanOut(delegator, {
    missionId: "measurement", parentExecutionId: "parent-fanout-4", actor: "observer",
    reason: "Too deep", approvedBy: "parent",
    children: [{ agentId: "child-deep", goal: fixture.graph.description, capabilities: ["permission.workspace.read"] }],
  });

  assert.equal(result.state, "PARTIAL");
  assert.equal(result.complete, false);
  assert.equal(result.children[0].state, "FAILED");
  assert.match(String(result.children[0].error), /depth/);
});