import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionRuntime } from "./session-runtime.js";
import { graphDigest, type ExecutionRecovery } from "./execution-recovery.js";
import type { TaskGraph } from "./types.js";

const graph: TaskGraph = { id: "graph", description: "recovery", nodes: [], edges: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), metadata: {} };
const recovery: ExecutionRecovery = {
  version: 1, identity: { missionId: "mission", executionId: "execution", taskId: "task", sessionId: "session", workflowId: "workflow", actor: "test" },
  status: "CREATED", graphDigest: graphDigest(graph), deadline: new Date(Date.now() + 60000).toISOString(), nodeSkillIds: {}, invocations: [],
  budget: { maxToolCalls: 10, maxConcurrentNodes: 1, maxIterations: 10, maxDurationMs: 60000, maxTokens: 1000,
    maxCostUsd: 1, maxRetries: 0, maxConsecutiveFailures: 1, maxNoProgressIterations: 1,
    maxDelegationDepth: 0, maxAgents: 1, maxConcurrentAgents: 1 },
};
function runtime(storageDir?: string) {
  return SessionRuntime.create({ storageDir, maxActiveSessions: 5, snapshotRetentionCount: 10, autoSnapshotIntervalMs: 60000,
    schedulerConfig: { maxParallelNodes: 3, defaultTimeoutMs: 1000, queuePollIntervalMs: 0 },
    defaultRetryPolicy: { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 }, checkpointInterval: 0 });
}

it("retains the canonical execution checkpoint when reopening a session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quack-recovery-"));
  try {
    const first = runtime(dir);
    await first.createSession("session");
    const saved = await first.initializeExecution("session", graph, recovery);
    assert.equal(saved.id, "workflow");
    assert.equal(saved.workflowState.planId, "task");
    const reopened = runtime(dir);
    await reopened.createSession("session");
    assert.deepEqual(await reopened.loadExecution("session", "workflow"), saved);
    await assert.rejects(reopened.initializeExecution("session", graph, recovery), /already exists/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("serializes concurrent updates and isolates failed mutations and saves", async () => {
  const rt = runtime();
  await rt.createSession("session");
  await rt.initializeExecution("session", graph, recovery);
  await Promise.all(Array.from({ length: 20 }, () => rt.updateExecution("session", "workflow", checkpoint => ({ ...checkpoint, metadata: { count: Number(checkpoint.metadata.count ?? 0) + 1 } }))));
  const before = await rt.loadExecution("session", "workflow");
  assert.equal(before?.metadata.count, 20);
  await assert.rejects(rt.updateExecution("session", "workflow", checkpoint => { (checkpoint.metadata as Record<string, number>).count = 99; throw new Error("mutation failed"); }), /mutation failed/);
  const store = rt.getCheckpointStore("session")!;
  const save = store.save.bind(store);
  store.save = async () => { throw new Error("disk failed"); };
  await assert.rejects(rt.updateExecution("session", "workflow", checkpoint => ({ ...checkpoint, metadata: { count: 100 } })), /disk failed/);
  store.save = save;
  assert.deepEqual(await rt.loadExecution("session", "workflow"), before);
  await rt.updateExecution("session", "workflow", checkpoint => ({ ...checkpoint, metadata: { count: 21 } }));
  assert.equal((await rt.loadExecution("session", "workflow"))?.metadata.count, 21);
});

it("requires initialization and persists durable transitions under the fixed workflow identity", async () => {
  const rt = runtime();
  await rt.createSession("session");
  await assert.rejects(rt.executeWorkflow("session", graph, "task", undefined, undefined, { workflowId: "workflow", durable: true }), /initialized/);
  await rt.initializeExecution("session", graph, recovery);
  const state = await rt.executeWorkflow("session", graph, "task", undefined, undefined, { workflowId: "workflow", durable: true });
  assert.equal(state.workflowId, "workflow");
  assert.equal((await rt.loadExecution("session", "workflow"))?.workflowState.status, "completed");
  assert.equal((await rt.getCheckpointStore("session")!.list("workflow")).length, 1);
});

