import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { ExecutionScheduler } from "./scheduler.js";
import { type TaskNode, type TaskNodeResult } from "./types.js";

const makeNode = (overrides?: Partial<TaskNode>): TaskNode => ({
  id: "test-node",
  description: "Test node",
  dependencies: [],
  priority: "medium",
  estimatedCost: 1,
  estimatedDurationMs: 1000,
  requiredTools: [],
  timeoutMs: 5000,
  retryPolicy: { maxRetries: 3, backoff: "exponential", baseDelayMs: 1000, maxDelayMs: 30000 },
  status: "pending",
  retryCount: 0,
  ...overrides,
});

describe("ExecutionScheduler", () => {
  it("holds resources until settlement without blocking unrelated resources", () => {
    const scheduler = new ExecutionScheduler({ maxParallelNodes: 3, defaultTimeoutMs: 1000, queuePollIntervalMs: 0 });
    scheduler.enqueue([makeNode({ id: "a", resources: ["gpu"] }), makeNode({ id: "b", resources: ["gpu"] }), makeNode({ id: "c", resources: ["disk"] })]);
    assert.equal(scheduler.dequeue()?.id, "a");
    assert.equal(scheduler.dequeue()?.id, "c");
    assert.equal(scheduler.dequeue(), undefined);
    assert.throws(() => scheduler.reset(), /operations are running/);
    scheduler.complete("a", { success: true, toolCalls: [], durationMs: 5 });
    assert.equal(scheduler.dequeue()?.id, "b");
  });

  it("deduplicates admissions and settlement accounting", () => {
    const scheduler = new ExecutionScheduler({ maxParallelNodes: 2, defaultTimeoutMs: 1000, queuePollIntervalMs: 0 });
    const node = makeNode();
    scheduler.enqueue([node, node]);
    scheduler.dequeue();
    scheduler.enqueue([node]);
    assert.equal(scheduler.queuedCount, 0);
    scheduler.complete(node.id, { success: true, toolCalls: [], durationMs: 5 });
    scheduler.complete(node.id, { success: false, toolCalls: [], durationMs: 5 });
    scheduler.skip(node.id);
    scheduler.enqueue([node]);
    assert.equal(scheduler.getStats().completed, 1);
    assert.equal(scheduler.getStats().failed, 0);
    assert.equal(scheduler.getStats().skipped, 0);
    assert.equal(scheduler.queuedCount, 0);
  });

  it("rejects concurrency values that could remove the bound", () => {
    for (const maxParallelNodes of [NaN, Infinity, 0, -1, 1.5]) {
      assert.throws(() => new ExecutionScheduler({ maxParallelNodes, defaultTimeoutMs: 1000, queuePollIntervalMs: 0 }), /positive integer/);
    }
  });
  it("enqueues and dequeues nodes", () => {
    const s = new ExecutionScheduler({ maxParallelNodes: 3, defaultTimeoutMs: 5000, queuePollIntervalMs: 50 });
    s.enqueue([makeNode({ id: "a" }), makeNode({ id: "b" })]);
    assert.equal(s.queuedCount, 2);

    const a = s.dequeue();
    assert.equal(a?.id, "a");
    assert.equal(s.runningCount, 1);

    const b = s.dequeue();
    assert.equal(b?.id, "b");
    assert.equal(s.runningCount, 2);
  });

  it("respects maxParallelNodes", () => {
    const s = new ExecutionScheduler({ maxParallelNodes: 2, defaultTimeoutMs: 5000, queuePollIntervalMs: 50 });
    s.enqueue([makeNode({ id: "a" }), makeNode({ id: "b" }), makeNode({ id: "c" })]);
    s.dequeue();
    s.dequeue();
    assert.equal(s.dequeue(), undefined);
    assert.equal(s.runningCount, 2);
    assert.equal(s.queuedCount, 1);
  });

  it("sorts by priority on enqueue", () => {
    const s = new ExecutionScheduler({ maxParallelNodes: 3, defaultTimeoutMs: 5000, queuePollIntervalMs: 50 });
    s.enqueue([
      makeNode({ id: "low", priority: "low" }),
      makeNode({ id: "critical", priority: "critical" }),
      makeNode({ id: "medium", priority: "medium" }),
    ]);
    const n1 = s.dequeue();
    const n2 = s.dequeue();
    const n3 = s.dequeue();
    assert.equal(n1!.id, "critical");
    assert.equal(n2!.id, "medium");
    assert.equal(n3!.id, "low");
  });

  it("tracks complete and failed nodes", () => {
    const s = new ExecutionScheduler({ maxParallelNodes: 3, defaultTimeoutMs: 5000, queuePollIntervalMs: 50 });
    s.enqueue([makeNode({ id: "a" }), makeNode({ id: "b" })]);
    s.dequeue();
    s.dequeue();

    s.complete("a", { success: true, toolCalls: [], durationMs: 100 });
    s.complete("b", { success: false, error: "fail", toolCalls: [], durationMs: 50 });

    const stats = s.getStats();
    assert.equal(stats.completed, 1);
    assert.equal(stats.failed, 1);
  });

  it("skip releases a running node", () => {
    const s = new ExecutionScheduler({ maxParallelNodes: 3, defaultTimeoutMs: 5000, queuePollIntervalMs: 50 });
    s.enqueue([makeNode({ id: "a" })]);
    s.dequeue();
    assert.equal(s.runningCount, 1);
    s.skip("a");
    assert.equal(s.runningCount, 0);
  });

  it("release frees a slot", () => {
    const s = new ExecutionScheduler({ maxParallelNodes: 1, defaultTimeoutMs: 5000, queuePollIntervalMs: 50 });
    s.enqueue([makeNode({ id: "a" }), makeNode({ id: "b" })]);
    s.dequeue();
    assert.equal(s.canAccept(), false);
    s.release("a");
    assert.equal(s.canAccept(), true);
  });

  it("canAccept returns true when under limit", () => {
    const s = new ExecutionScheduler({ maxParallelNodes: 2, defaultTimeoutMs: 5000, queuePollIntervalMs: 50 });
    s.enqueue([makeNode({ id: "a" })]);
    s.dequeue();
    assert.equal(s.canAccept(), true);
  });

  it("isFull returns true when at limit", () => {
    const s = new ExecutionScheduler({ maxParallelNodes: 1, defaultTimeoutMs: 5000, queuePollIntervalMs: 50 });
    s.enqueue([makeNode({ id: "a" })]);
    s.dequeue();
    assert.equal(s.isFull(), true);
  });

  it("getStats returns correct snapshot", () => {
    const s = new ExecutionScheduler({ maxParallelNodes: 3, defaultTimeoutMs: 5000, queuePollIntervalMs: 50 });
    s.enqueue([makeNode({ id: "a" }), makeNode({ id: "b" })]);
    s.dequeue();

    const stats = s.getStats();
    assert.equal(stats.queued, 1);
    assert.equal(stats.running, 1);
    assert.equal(stats.completed, 0);
    assert.equal(stats.failed, 0);
    assert.equal(stats.skipped, 0);
    assert.ok(typeof stats.avgWaitTimeMs === "number");
    assert.ok(typeof stats.avgExecutionTimeMs === "number");
    assert.ok(typeof stats.throughput === "number");
  });

  it("reset clears all state", () => {
    const s = new ExecutionScheduler({ maxParallelNodes: 3, defaultTimeoutMs: 5000, queuePollIntervalMs: 50 });
    s.enqueue([makeNode({ id: "a" })]);
    s.dequeue();
    s.complete("a", { success: true, toolCalls: [], durationMs: 100 });
    s.reset();
    const stats = s.getStats();
    assert.equal(stats.queued, 0);
    assert.equal(stats.running, 0);
    assert.equal(stats.completed, 0);
  });
});
