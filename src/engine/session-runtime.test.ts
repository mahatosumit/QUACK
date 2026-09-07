import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SessionRuntime } from "./session-runtime.js";
import { TaskGraphBuilder } from "./task-graph.js";
import { type WorkflowEngineConfig } from "./workflow-engine.js";
import { type TaskGraph, type WorkflowState } from "./types.js";

const makeMinimalGraph = (): TaskGraph => ({
  id: "test-graph",
  description: "Test graph",
  nodes: [],
  edges: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  metadata: {},
});

const makeWorkflowState = (graph: TaskGraph): WorkflowState => ({
  workflowId: "",
  planId: "test-plan",
  sessionId: "",
  status: "created",
  taskGraph: graph,
  nodeStates: {},
  nodeResults: {},
  readyQueue: [],
  runningNodes: [],
  completedNodes: [],
  failedNodes: [],
  skippedNodes: [],
  progress: 0,
  errors: [],
});

describe("SessionRuntime", () => {
  it("uses the owning result status even when no graph ran", async () => {
    const runtime = testRuntime();
    await runtime.createSession("result");
    for (const status of ["failed", "cancelled", "completed"] as const) {
      await runtime.run("result", async () => ({ status }), result => result.status);
      assert.equal(runtime.getSession("result")?.status, status);
    }
  });
  it("rejects overlapping runs, deletion, eviction and history restoration until drain", async () => {
    const runtime = testRuntime({}, 1);
    await runtime.createSession("active");
    const started = deferred(), release = deferred();
    const execution = runtime.run("active", async () => { started.resolve(); await release.promise; return "done"; });
    await started.promise;
    await assert.rejects(() => runtime.run("active", async () => "duplicate"), /active execution/);
    assert.throws(() => runtime.deleteSession("active"), /cancel and drain/);
    await assert.rejects(() => runtime.createSession("other"), /capacity.*active/);
    await assert.rejects(() => runtime.undo("active"), /execution is active/);
    await assert.rejects(() => runtime.redo("active"), /execution is active/);
    release.resolve();
    assert.equal(await execution, "done");
    assert.equal(runtime.getSession("active")?.status, "completed");
    assert.equal(runtime.deleteSession("active"), true);
  });

  it("cancelAndWait holds the session until callback cleanup finishes", async () => {
    const runtime = testRuntime();
    await runtime.createSession("cancel");
    const started = deferred(), aborted = deferred(), cleanup = deferred();
    const execution = runtime.run("cancel", async signal => {
      signal.addEventListener("abort", aborted.resolve, { once: true });
      started.resolve();
      await cleanup.promise;
      signal.throwIfAborted();
    });
    const rejected = assert.rejects(execution, /Session cancelled/);
    await started.promise;
    let settled = false;
    const cancellation = runtime.cancelAndWait("cancel").then(() => { settled = true; });
    await aborted.promise;
    assert.equal(settled, false);
    assert.throws(() => runtime.deleteSession("cancel"), /cancel and drain/);
    cleanup.resolve();
    await Promise.all([cancellation, rejected]);
    assert.equal(runtime.getSession("cancel")?.status, "cancelled");
    assert.equal(runtime.deleteSession("cancel"), true);
  });

  it("runs sequential graphs in one owned session and prevents workflow overlap", async () => {
    const started = deferred(), cleanup = deferred();
    const calls: string[] = [];
    const runtime = testRuntime({ executeNode: async node => {
      calls.push(node.id);
      if (node.id === "first") { started.resolve(); await cleanup.promise; }
      return { success: true, toolCalls: [], durationMs: 0 };
    } });
    await runtime.createSession("graphs");
    const first = new TaskGraphBuilder({ description: "first" }).addNode("first", { description: "first" }).build();
    const second = new TaskGraphBuilder({ description: "second" }).addNode("second", { description: "second" }).build();
    const execution = runtime.run("graphs", async signal => {
      const state = await runtime.executeWorkflow("graphs", first, "plan-1", undefined, signal);
      assert.equal(state.status, "completed");
      return runtime.executeWorkflow("graphs", second, "plan-2", undefined, signal);
    });
    await started.promise;
    await assert.rejects(() => runtime.executeWorkflow("graphs", second, "overlap"), /active workflow/);
    cleanup.resolve();
    assert.equal((await execution).status, "completed");
    assert.deepEqual(calls, ["first", "second"]);
    assert.equal(runtime.getSession("graphs")?.workflowIds.length, 2);
    assert.equal(runtime.getSession("graphs")?.status, "completed");
  });

  it("retains failed workflow status after the owning callback joins", async () => {
    const runtime = testRuntime({ executeNode: async () => ({ success: false, error: "permission denied", toolCalls: [], durationMs: 0 }) });
    await runtime.createSession("failed");
    const graph = new TaskGraphBuilder({ description: "failure" }).addNode("node", { description: "node" }).build();
    const state = await runtime.run("failed", signal => runtime.executeWorkflow("failed", graph, "plan", undefined, signal));
    assert.equal(state.status, "failed");
    assert.equal(runtime.getSession("failed")?.status, "failed");
  });

  it("confines identifiers and does not expose mutable internal state", async () => {
    const runtime = testRuntime();
    for (const id of ["../escape", "a/b", "C:\\escape", "..", ""]) await assert.rejects(() => runtime.createSession(id), /confined identifier/);
    await runtime.createSession("safe", { label: "original" });
    await assert.rejects(() => runtime.createSession("safe"), /already exists/);
    const snapshot = runtime.getSession("safe")!;
    snapshot.status = "cancelled";
    (snapshot.metadata as Record<string, string>).label = "altered";
    assert.equal(runtime.getSession("safe")?.status, "idle");
    assert.equal(runtime.getSession("safe")?.metadata.label, "original");
    assert.equal("workflowEngine" in snapshot, false);
  });
  it("creates and retrieves a session", async () => {
    const rt = SessionRuntime.create({
      maxActiveSessions: 5,
      snapshotRetentionCount: 10,
      autoSnapshotIntervalMs: 60000,
      schedulerConfig: { maxParallelNodes: 3, defaultTimeoutMs: 5000, queuePollIntervalMs: 50 },
      defaultRetryPolicy: { maxRetries: 3, backoff: "exponential", baseDelayMs: 1000, maxDelayMs: 30000 },
      checkpointInterval: 0,
    });

    const id = await rt.createSession();
    assert.ok(id.length > 0);

    const session = rt.getSession(id);
    assert.ok(session);
    assert.equal(session.sessionId, id);
    assert.equal(session.status, "idle");
  });

  it("lists sessions", async () => {
    const rt = SessionRuntime.create({
      maxActiveSessions: 5,
      snapshotRetentionCount: 10,
      autoSnapshotIntervalMs: 60000,
      schedulerConfig: { maxParallelNodes: 3, defaultTimeoutMs: 5000, queuePollIntervalMs: 50 },
      defaultRetryPolicy: { maxRetries: 3, backoff: "exponential", baseDelayMs: 1000, maxDelayMs: 30000 },
      checkpointInterval: 0,
    });

    await rt.createSession("ses-1");
    await rt.createSession("ses-2");
    const sessions = rt.listSessions();
    assert.equal(sessions.length, 2);
    assert.ok(sessions.includes("ses-1"));
    assert.ok(sessions.includes("ses-2"));
  });

  it("deletes a session", async () => {
    const rt = SessionRuntime.create({
      maxActiveSessions: 5,
      snapshotRetentionCount: 10,
      autoSnapshotIntervalMs: 60000,
      schedulerConfig: { maxParallelNodes: 3, defaultTimeoutMs: 5000, queuePollIntervalMs: 50 },
      defaultRetryPolicy: { maxRetries: 3, backoff: "exponential", baseDelayMs: 1000, maxDelayMs: 30000 },
      checkpointInterval: 0,
    });

    const id = await rt.createSession("to-delete");
    assert.ok(rt.deleteSession("to-delete"));
    assert.equal(rt.getSession("to-delete"), undefined);
  });

  it("snapshot, undo, redo cycle", async () => {
    const rt = SessionRuntime.create({
      maxActiveSessions: 5,
      snapshotRetentionCount: 10,
      autoSnapshotIntervalMs: 60000,
      schedulerConfig: { maxParallelNodes: 3, defaultTimeoutMs: 5000, queuePollIntervalMs: 50 },
      defaultRetryPolicy: { maxRetries: 3, backoff: "exponential", baseDelayMs: 1000, maxDelayMs: 30000 },
      checkpointInterval: 0,
    });

    const id = await rt.createSession("cycle-ses");
    await rt.snapshot(id);

    const session = rt.getSession(id);
    assert.ok(session);
    assert.equal(session.status, "idle");

    // undo
    const undone = await rt.undo(id);
    assert.equal(undone, true);

    // redo
    const redone = await rt.redo(id);
    assert.equal(redone, true);
  });

  it("returns journal and checkpoint stores", async () => {
    const rt = SessionRuntime.create({
      maxActiveSessions: 5,
      snapshotRetentionCount: 10,
      autoSnapshotIntervalMs: 60000,
      schedulerConfig: { maxParallelNodes: 3, defaultTimeoutMs: 5000, queuePollIntervalMs: 50 },
      defaultRetryPolicy: { maxRetries: 3, backoff: "exponential", baseDelayMs: 1000, maxDelayMs: 30000 },
      checkpointInterval: 0,
    });

    const id = await rt.createSession("stores");
    assert.ok(rt.getJournal(id));
    assert.ok(rt.getCheckpointStore(id));
  });
});

function testRuntime(config: Partial<WorkflowEngineConfig> = {}, maxActiveSessions = 5): SessionRuntime {
  return SessionRuntime.create({ maxActiveSessions, snapshotRetentionCount: 10, autoSnapshotIntervalMs: 60000,
    schedulerConfig: { maxParallelNodes: 3, defaultTimeoutMs: 1000, queuePollIntervalMs: 0 },
    defaultRetryPolicy: { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 }, checkpointInterval: 0, ...config });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
