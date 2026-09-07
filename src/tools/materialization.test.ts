import test from "node:test";
import assert from "node:assert/strict";
import { materializeTool, createGovernedToolExecutor, materializationSnapshot, type ToolMaterialization } from "./materialization.js";
import type { ToolInvocation, ToolInvocationExecutionContext, ToolInvocationOutcome } from "./tool.js";

const baseInput = {
  toolId: "test.tool",
  providerId: "test.provider",
  providerVersion: "1.0.0",
  capabilityId: "permission.workspace.read",
  retrySafety: "READ_ONLY" as const,
  missionId: "mission-1",
  taskId: "task-1",
  executionId: "exec-1",
  sessionId: "session-1",
  actor: "user-1",
  agentId: "agent-1",
  skillId: "skill-1",
  namespace: "test-ns",
  operationId: "op-1",
  deadline: "2099-12-31T23:59:59.000Z",
  source: "runtime" as const,
};

test("materializeTool creates a valid materialization with all identity fields", () => {
  const result = materializeTool(baseInput);
  assert.ok(result.ok);
  if (!result.ok) return;

  const m = result.data;
  assert.equal(m.contractVersion, 1);
  assert.equal(m.toolId, "test.tool");
  assert.equal(m.providerId, "test.provider");
  assert.equal(m.providerVersion, "1.0.0");
  assert.equal(m.capabilityId, "permission.workspace.read");
  assert.equal(m.retrySafety, "READ_ONLY");
  assert.equal(m.identity.missionId, "mission-1");
  assert.equal(m.identity.taskId, "task-1");
  assert.equal(m.identity.executionId, "exec-1");
  assert.equal(m.identity.sessionId, "session-1");
  assert.equal(m.identity.actor, "user-1");
  assert.equal(m.identity.agentId, "agent-1");
  assert.equal(m.identity.skillId, "skill-1");
  assert.equal(m.identity.namespace, "test-ns");
  assert.equal(m.identity.operationId, "op-1");
  assert.equal(m.deadline, "2099-12-31T23:59:59.000Z");
  assert.equal(m.provenance.toolId, "test.tool");
  assert.equal(m.provenance.providerId, "test.provider");
  assert.equal(m.provenance.source, "runtime");
});

test("materializeTool rejects invalid or missing identity", () => {
  for (const bad of [
    { ...baseInput, toolId: "" },
    { ...baseInput, capabilityId: "" },
    { ...baseInput, missionId: "" },
    { ...baseInput, taskId: "" },
    { ...baseInput, executionId: "" },
    { ...baseInput, sessionId: "" },
    { ...baseInput, actor: "" },
  ]) {
    const result = materializeTool(bad);
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.error.code, "tool.materialization_identity_incomplete");
  }
});

test("materializeTool rejects invalid retry safety", () => {
  const result = materializeTool({ ...baseInput, retrySafety: "SUPER_SAFE" as never });
  assert.ok(!result.ok);
  if (!result.ok) assert.equal(result.error.code, "tool.materialization_retry_safety_invalid");
});

test("materializeTool rejects invalid deadline", () => {
  const result = materializeTool({ ...baseInput, deadline: "not-a-date" });
  assert.ok(!result.ok);
  if (!result.ok) assert.equal(result.error.code, "tool.materialization_deadline_invalid");
});

test("materializeTool allows minimal input without optional identity", () => {
  const result = materializeTool({
    toolId: "test.tool",
    capabilityId: "permission.workspace.read",
    retrySafety: "UNKNOWN",
    missionId: "mission-1",
    taskId: "task-1",
    executionId: "exec-1",
    sessionId: "session-1",
    actor: "user-1",
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.data.providerId, undefined);
  assert.equal(result.data.identity.agentId, undefined);
  assert.equal(result.data.identity.skillId, undefined);
  assert.equal(result.data.identity.namespace, undefined);
  assert.ok(result.data.identity.operationId);
});

test("materializeTool preserves all retry safety classes", () => {
  const classes = ["READ_ONLY", "IDEMPOTENT_WRITE", "NON_IDEMPOTENT_WRITE", "DESTRUCTIVE", "UNKNOWN"] as const;
  for (const safety of classes) {
    const result = materializeTool({ ...baseInput, retrySafety: safety });
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.data.retrySafety, safety);
  }
});

function materialized(): ToolMaterialization {
  const result = materializeTool(baseInput);
  assert.ok(result.ok);
  if (!result.ok) throw new Error("unreachable");
  return result.data;
}

test("governed executor rejects mismatched tool identity at dispatch", async () => {
  const executor = async (invocation: ToolInvocation): Promise<ToolInvocationOutcome> =>
    ({ toolId: invocation.toolId, success: true, output: {} });
  const governed = createGovernedToolExecutor(materialized(), executor);
  const outcome = await governed({ toolId: "wrong.tool", input: {} }, { taskId: "task-1", actor: "user-1" });
  assert.equal(outcome.success, false);
  assert.equal(outcome.error, "Materialized tool identity mismatch at dispatch.");
});

test("governed executor rejects cancelled dispatch", async () => {
  const executor = async (invocation: ToolInvocation): Promise<ToolInvocationOutcome> =>
    ({ toolId: invocation.toolId, success: true, output: {} });
  const governed = createGovernedToolExecutor(materialized(), executor);
  const controller = new AbortController();
  controller.abort();
  const outcome = await governed({ toolId: "test.tool", input: {} }, { taskId: "task-1", actor: "user-1", signal: controller.signal });
  assert.equal(outcome.success, false);
  assert.equal(outcome.error, "Tool dispatch cancelled.");
});

test("governed executor forwards materialized identity to the executor", async () => {
  let captured: ToolInvocationExecutionContext | undefined;
  const executor = async (invocation: ToolInvocation, context: ToolInvocationExecutionContext): Promise<ToolInvocationOutcome> => {
    captured = context;
    return { toolId: invocation.toolId, success: true, output: {} };
  };
  const governed = createGovernedToolExecutor(materialized(), executor);
  await governed({ toolId: "test.tool", input: {} }, { taskId: "other-task", actor: "other-actor" });
  assert.ok(captured);
  assert.equal(captured.taskId, "task-1");
  assert.equal(captured.actor, "user-1");
  assert.equal(captured.sessionId, "session-1");
  assert.equal(captured.idempotencyKey, "op-1");
  assert.equal(captured.deadline, "2099-12-31T23:59:59.000Z");
});

test("materializationSnapshot is JSON-safe and complete", () => {
  const snapshot = materializationSnapshot(materialized()) as Record<string, unknown>;
  assert.equal(snapshot.contractVersion, 1);
  assert.equal(snapshot.toolId, "test.tool");
  assert.equal(snapshot.providerId, "test.provider");
  assert.equal(snapshot.capabilityId, "permission.workspace.read");
  assert.equal(snapshot.retrySafety, "READ_ONLY");
  const identity = snapshot.identity as Record<string, unknown>;
  assert.equal(identity.missionId, "mission-1");
  assert.equal(identity.taskId, "task-1");
  assert.equal(identity.executionId, "exec-1");
  assert.equal(identity.sessionId, "session-1");
  assert.equal(identity.actor, "user-1");
  assert.equal(identity.operationId, "op-1");
  const provenance = snapshot.provenance as Record<string, unknown>;
  assert.equal(provenance.toolId, "test.tool");
  assert.equal(provenance.providerId, "test.provider");
  assert.equal(provenance.source, "runtime");
  assert.ok(JSON.stringify(snapshot));
});