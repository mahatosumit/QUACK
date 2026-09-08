import test from "node:test";
import assert from "node:assert/strict";
import { SessionRuntime } from "../engine/session-runtime.js";
import { Planner } from "../engine/planner.js";
import { now } from "../core/types.js";
import type { LoopToolCall } from "./contract.js";
import { DefaultLoopDriver } from "./driver.js";
import { QuackNativeHarness } from "../harness/registry.js";
import { EventBus } from "../events/event-bus.js";
import { InMemoryMemoryStore } from "../memory/memory.js";
import { PermissionBackedCapabilityBroker, type CapabilityBroker } from "../security/capability-broker.js";
import { AllowListPermissionPolicy } from "../security/permissions.js";
import { ok, type JsonObject } from "../core/types.js";
import type { LoopDependencies } from "./contract.js";

function makeDriver(harness: QuackNativeHarness, verifyExecution?: LoopDependencies["verifyExecution"], planOverride?: LoopDependencies["plan"]) {
  const sessions = SessionRuntime.create({ maxActiveSessions: 10, snapshotRetentionCount: 1, autoSnapshotIntervalMs: 0,
    schedulerConfig: { maxParallelNodes: 2, defaultTimeoutMs: 2000, queuePollIntervalMs: 1 },
    defaultRetryPolicy: { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 }, checkpointInterval: 0 });
  const planner = new Planner({ defaultRetryPolicy: { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 }, defaultTimeoutMs: 2000, maxNodesPerGraph: 10 });
  return new DefaultLoopDriver({ harness, verifyExecution, capabilityBroker: new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy([])),
    eventBus: new EventBus(), memory: new InMemoryMemoryStore(),
    plan: planOverride ?? ((goal: string) => { const plan = planner.createPlan(goal, ""); return { planId: plan.id, strategy: plan.strategy, taskGraph: plan.taskGraph,
      nodes: plan.taskGraph.nodes.map((node) => ({ ...node, toolInvocations: node.toolInvocations ?? [] })), requiredCapabilities: plan.requiresPermissions }; }),
    executeGraph: async (plan, context) => {
      const sessionId = await sessions.createSession();
      const calls: LoopToolCall[] = [];
      const workflowState = await sessions.executeWorkflow(sessionId, plan.taskGraph!, plan.planId, async (invocation, nodeContext) => {
        const startedAt = now();
        const output = await harness.send({ goal: context.goal, toolInvocations: [invocation] }, {
          missionId: context.missionId, runId: context.runId, iterationId: nodeContext.nodeId!, actor: context.actor,
          signal: nodeContext.signal, deadline: nodeContext.deadline, workspaceRoot: "", dataDir: "", capabilities: [], trustClass: "SYSTEM" });
        calls.push({ ...invocation, success: output.success, output: output.result, error: output.error, metrics: output.metrics, startedAt, completedAt: now() });
        return { toolId: invocation.toolId, success: output.success, output: output.result, error: output.error };
      }, context.signal);
      return { success: workflowState.status === "completed", workflowState, toolCalls: calls, capabilityDenied: false };
    },
  }, { maxIterations: 3 }, { enableEventWakeups: false });
}

test("driver preserves Planner arguments and cannot complete from tool success alone", async () => {
  const calls: { toolId: string; input: JsonObject }[] = [];
  const harness = new QuackNativeHarness({ runtime: { executeTool: async (toolId, input) => { calls.push({ toolId, input }); return ok({ files: ["expected.txt"] }); } } }, { harnessId: "QUACK_NATIVE" });
  await harness.start({ harnessId: "QUACK_NATIVE" });
  const result = await makeDriver(harness).start({ goal: "inspect workspace" });
  assert.deepEqual(calls, [{ toolId: "core.workspace.list-files", input: { path: ".", depth: 2 } }]);
  assert.equal(result.state, "FAILED");
  assert.equal(result.stopReason, "NEEDS_HELP");
  assert.match(result.error ?? "", /validator/);
  assert.equal(result.iterations.length, 1, "Unverified successful work must not be repeated blindly");
  assert.equal(result.totalTokens, 0);
  assert.equal(result.totalCostUsd, 0);
  await harness.dispose();
});

test("driver completes only when the configured validator checks actual result evidence", async () => {
  const harness = new QuackNativeHarness({ runtime: { executeTool: async () => ok({ files: ["expected.txt"] }) } }, { harnessId: "QUACK_NATIVE" });
  await harness.start({ harnessId: "QUACK_NATIVE" });
  let validations = 0;
  const driver = makeDriver(harness, (_action, execution) => {
    validations++;
    const calls = execution.toolCalls[0].output?.toolCalls;
    const call = Array.isArray(calls) ? calls[0] as JsonObject : undefined;
    const output = call?.output as JsonObject | undefined;
    return { success: Array.isArray(output?.files) && output.files.includes("expected.txt"), independent: true, reason: "Compared fixture output with expected file." };
  });
  const result = await driver.start({ goal: "inspect workspace" });
  assert.equal(validations, 1);
  assert.equal(result.state, "COMPLETED");
  assert.equal(result.stopReason, "GOAL_REACHED");
  await harness.dispose();
});

test("driver rejects unsupported planning without dispatch and honours pre-cancellation", async () => {
  let calls = 0;
  const harness = new QuackNativeHarness({ runtime: { executeTool: async () => { calls++; return ok({}); } } }, { harnessId: "QUACK_NATIVE" });
  await harness.start({ harnessId: "QUACK_NATIVE" });
  // A planner that produces no dispatchable invocations must fail the run
  // without executing anything. (Since the static Planner now materializes
  // safe default invocations for every goal, this is injected directly to
  // exercise the driver's rejection path.)
  const emptyPlan: LoopDependencies["plan"] = async () => ({
    planId: "plan-empty", strategy: "unsupported", taskGraph: {
      id: "graph-empty", description: "", nodes: [], edges: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), metadata: {},
    },
    nodes: [], requiredCapabilities: [],
  });
  const driver = makeDriver(harness, undefined, emptyPlan);
  assert.equal((await driver.start({ goal: "invent and deliver a new product" })).state, "FAILED");
  assert.equal((await driver.start({ goal: "inspect workspace", signal: AbortSignal.abort() })).state, "CANCELLED");
  assert.equal(calls, 0);
  await assert.rejects(() => driver.pause(), /unsupported/);
  await assert.rejects(() => driver.resume(), /unsupported/);
  await assert.rejects(() => driver.cancel(), /No active/);
  await harness.dispose();
});

test("driver rejects concurrent use and cancellation cannot become completed work", async () => {
  let release!: () => void;
  let dispatched!: () => void;
  const entered = new Promise<void>((resolve) => { dispatched = resolve; });
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const harness = new QuackNativeHarness({ runtime: { executeTool: async () => { dispatched(); await pending; return ok({}); } } }, { harnessId: "QUACK_NATIVE" });
  await harness.start({ harnessId: "QUACK_NATIVE" });
  const driver = makeDriver(harness);
  const execution = driver.start({ goal: "inspect workspace" });
  await entered;
  await assert.rejects(() => driver.start({ goal: "inspect workspace" }), /active run/);
  await driver.cancel();
  release();
  const result = await execution;
  assert.equal(result.state, "CANCELLED");
  await harness.dispose();
});
