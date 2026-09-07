import test from "node:test";
import assert from "node:assert/strict";
import { TaskGraphBuilder, TaskGraphExecutor } from "./task-graph.js";

test("task terminal state cannot be overwritten by late completion or retry", () => {
  const graph = new TaskGraphBuilder({ description: "terminal guards" }).addNode("node", { description: "task" }).build();
  const executor = new TaskGraphExecutor(graph);
  executor.markRunning("node");
  executor.markCancelled("node", "cancelled after drain");
  executor.markCompleted("node", { success: true, toolCalls: [], durationMs: 1 });
  executor.markPending("node");
  executor.markReady("node");
  executor.markRetrying("node");
  executor.incrementRetry("node");
  assert.equal(executor.getStatus("node"), "cancelled");
  assert.equal(executor.getResult("node")?.success, false);
  assert.equal(executor.getGraph().nodes[0].retryCount, 0);
  assert.throws(() => executor.markReady("missing"), /Unknown task node/);
});

test("restored completed results remain available to graph dependencies", () => {
  const original = new TaskGraphBuilder({ description: "restored" }).addNode("node", { description: "task" }).build();
  const graph = { ...original, nodes: original.nodes.map(node => ({ ...node, status: "completed" as const,
    result: { success: true, output: { value: "retained" }, toolCalls: [], durationMs: 1 } })) };
  const executor = new TaskGraphExecutor(graph);
  executor.markFailed("node", { success: false, toolCalls: [], durationMs: 1 });
  assert.equal(executor.getResult("node")?.output?.value, "retained");
  assert.equal(executor.getStatus("node"), "completed");
});
