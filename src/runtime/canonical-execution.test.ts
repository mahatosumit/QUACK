import test from "node:test";
import assert from "node:assert/strict";
import { canonicalFixture, measurementGraph } from "../test-support/canonical-runtime.js";
import { TaskGraphBuilder } from "../engine/task-graph.js";
import type { JsonObject } from "../core/types.js";

test("runtime executes both branches and joins their evidence before one validation/finalization", async () => {
  const fixture = canonicalFixture();
  const eventTypes: string[] = [];
  fixture.events.onAny((event) => { eventTypes.push(event.type); });
  const result = await fixture.runtime.submitGoal(fixture.graph.description, "observer");
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.data.status, "completed");
  assert.equal(result.data.plan.filter((step) => step.status === "completed").length, 3);
  assert.deepEqual(fixture.calls.map((call) => call.input), [
    { path: "allowed/left", value: 2, extra: "preserved" }, { path: "allowed/right", value: 3 }, { path: "allowed/join", left: 2, right: 3 },
  ]);
  assert.ok(fixture.calls.every((call) => call.actor === "observer"));
  const run = fixture.runtime.getLoopResult(result.data.id)!;
  assert.equal(run.iterations.length, 1);
  assert.equal(run.totalToolCalls, 3);
  assert.equal(run.iterations[0].executionResult.workflowState?.status, "completed");
  assert.equal(eventTypes.filter((type) => type === "task.completed").length, 1);
  assert.equal(eventTypes.filter((type) => type === "task.started").length, 1);
  assert.equal(fixture.learning.length, 1);
});

test("operation success remains available without certifying the mission", async () => {
  const fixture = canonicalFixture({ omitVerifier: true });
  const state = await fixture.runtime.executeGraph(fixture.graph, "observer");
  assert.ok(state.ok);
  if (!state.ok) return;
  assert.equal(state.data.status, "completed");
  assert.equal((state.data.nodeResults.join.output?.lastToolOutput as JsonObject).value, 5);
  const tasks = await fixture.runtime.listTasks();
  assert.equal(tasks[0].status, "failed");
  assert.match(String(tasks[0].error?.message), /validator/);
  assert.equal(fixture.calls.length, 3);
});

test("canonical graph execution cannot borrow an owner grant after child authority revocation", async () => {
  const fixture = canonicalFixture({ omitGrant: true });
  const parent = fixture.grants.createGrant({ missionId: "measurement", capabilities: ["permission.workspace.read"],
    approval: { approvedBy: "fixture", reason: "Parent", approvedAt: new Date().toISOString() } });
  const child = fixture.grants.deriveGrant(parent.id, { missionId: "measurement", agentId: "observer", capabilities: ["permission.workspace.read"],
    scope: { workspacePaths: ["allowed"], toolIds: ["fixture.measure"] },
    approval: { approvedBy: "fixture", reason: "Child", approvedAt: new Date().toISOString() } });
  fixture.events.on("tool.requested", () => { fixture.grants.revokeGrant(child.id); });
  const task = await fixture.runtime.submitGoal(fixture.graph.description, "observer");
  assert.ok(task.ok);
  if (task.ok) assert.equal(task.data.status, "failed");
  assert.equal(fixture.calls.length, 0);
});

test("shutdown cancels and drains registered tools before returning", async () => {
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const fixture = canonicalFixture({ execute: async (_input, context) => {
    entered(); await wait;
    assert.equal(context.signal?.aborted, true);
    return {};
  } });
  const submission = fixture.runtime.submitGoal(fixture.graph.description, "observer");
  await started;
  let drained = false;
  const shutdown = fixture.runtime.shutdown().then(() => { drained = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(drained, false);
  release();
  await shutdown;
  const task = await submission;
  assert.ok(task.ok);
  if (task.ok) assert.equal(task.data.status, "failed");
  assert.ok(fixture.calls.every((call) => call.input.path !== "allowed/join"));
});

test("profile budgets constrain request budgets and bound actual node concurrency", async () => {
  let running = 0; let peak = 0;
  const fixture = canonicalFixture({
    execute: async (input) => { running++; peak = Math.max(peak, running); await new Promise((resolve) => setTimeout(resolve, 3)); running--;
      return { ...input, value: typeof input.left === "number" ? input.left + Number(input.right) : input.value }; },
    overrides: { budgetFor: () => ({ maxToolCalls: 2, maxConcurrentNodes: 1 }) },
  });
  const task = await fixture.runtime.submitGoal(fixture.graph.description, "observer", { budget: { maxToolCalls: 100, maxConcurrentNodes: 10 } });
  assert.ok(task.ok);
  if (task.ok) assert.equal(task.data.status, "failed");
  assert.equal(peak, 1);
  assert.equal(fixture.calls.length, 2);
});

test("planner context contains identity and no execution callback", async () => {
  let observed = false;
  const fixture = canonicalFixture({ overrides: { planGraph: async (_task, context) => {
    observed = true;
    assert.equal(context.missionId, "measurement"); assert.equal(context.agentId, "observer");
    assert.equal(context.executeTool, undefined);
    throw new Error("No planning authority to execute.");
  } } });
  const task = await fixture.runtime.submitGoal(fixture.graph.description, "observer");
  assert.ok(observed);
  assert.ok(task.ok);
  if (task.ok) assert.equal(task.data.status, "failed");
  assert.equal(fixture.calls.length, 0);
});

test("prepared graph executes every skill node before validation with trusted skill identity", async () => {
  const graph = measurementGraph();
  const extra = new TaskGraphBuilder({ description: "Skill observation" }).addNode("skill", {
    description: "Observe skill", tools: ["fixture.measure"], dependencies: ["join"],
    toolInvocations: [{ toolId: "fixture.measure", input: { path: "allowed/skill", value: 5 } }],
    timeoutMs: 2000, retryPolicy: { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 },
  }).build();
  const requestedSkills: unknown[] = [];
  const fixture = canonicalFixture({ graph, overrides: { prepareGraph: async (base) => ({
    graph: { ...base, nodes: [...base.nodes, ...extra.nodes], edges: [...base.edges, ...extra.edges] }, nodeSkillIds: new Map([["skill", "registered.skill"]]),
  }), verifyExecution: async (_task, state) => ({ success: state.completedNodes.length === 4 && state.nodeResults.skill.success, reason: "All four nodes including skill observed." }) } });
  fixture.grants.ensureGrant({ missionId: "measurement", agentId: "observer", skillId: "registered.skill", capabilities: ["permission.workspace.read"],
    scope: { workspacePaths: ["allowed/skill"], toolIds: ["fixture.measure"] },
    approval: { approvedBy: "fixture", reason: "Skill fixture", approvedAt: new Date().toISOString() } });
  fixture.events.on("capability.requested", (event) => { requestedSkills.push(event.payload.skillId); });
  const task = await fixture.runtime.submitGoal(graph.description, "observer");
  assert.ok(task.ok);
  if (task.ok) assert.equal(task.data.status, "completed");
  assert.equal(fixture.calls.length, 4);
  assert.ok(requestedSkills.includes("registered.skill"));
});
