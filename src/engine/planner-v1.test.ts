import test from "node:test";
import assert from "node:assert/strict";
import { Planner } from "./planner.js";

function planner(): Planner {
  return new Planner({
    defaultRetryPolicy: { maxRetries: 1, backoff: "fixed", baseDelayMs: 1, maxDelayMs: 1 },
    defaultTimeoutMs: 1000,
    maxNodesPerGraph: 20,
  });
}

test("Planner decomposes goals into subgoals skills and tools", () => {
  const result = planner().decomposeGoal("research notes and document findings");

  assert.deepEqual(result.subgoals, ["research notes", "document findings"]);
  assert.ok(result.requiredSkills.includes("research"));
  assert.ok(result.requiredSkills.includes("filesystem-assistant"));
  assert.ok(result.expectedTools.includes("core.workspace.list-files"));
});

test("Planner validates dependencies and returns execution order", () => {
  const p = planner();
  const graph = p.createTaskGraph("implement coding change and then document it");
  const validation = p.validateDependencies(graph);
  const order = p.executionOrder(graph);

  assert.equal(validation.valid, true);
  assert.equal(order.length, graph.nodes.length);
  for (const node of graph.nodes) {
    for (const dependency of node.dependencies) {
      assert.ok(order.indexOf(dependency) < order.indexOf(node.id));
    }
  }
});

test("Planner embeds v1 mission planning metadata in plan graph", () => {
  const plan = planner().createPlan("engineering architecture analysis", "context");

  assert.ok(Array.isArray(plan.taskGraph.metadata["subgoals"]));
  assert.ok(Array.isArray(plan.taskGraph.metadata["expectedTools"]));
  assert.ok(Array.isArray(plan.taskGraph.metadata["executionOrder"]));
});
