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

test("Planner general graph materializes executable tool invocations", () => {
  const graph = planner().createTaskGraph("improve the authentication module");

  // Every node must be executable: any node declaring requiredTools must
  // carry toolInvocations, and at least one invocation must exist so the
  // agent loop accepts the plan ("No actionable tools in plan" regression).
  const allInvocations = graph.nodes.flatMap((node) => node.toolInvocations ?? []);
  assert.ok(allInvocations.length > 0, "General graph must contain at least one tool invocation");
  for (const node of graph.nodes) {
    if (node.requiredTools.length > 0) {
      assert.ok(
        (node.toolInvocations ?? []).length > 0,
        `Node "${node.description}" declares tools [${node.requiredTools.join(", ")}] without invocations`,
      );
      for (const invocation of node.toolInvocations ?? []) {
        assert.ok(
          node.requiredTools.includes(invocation.toolId),
          `Invocation ${invocation.toolId} not declared in node requiredTools`,
        );
      }
    }
  }
  // Only tools whose inputs the planner can derive safely may be invoked.
  const invoked = new Set(allInvocations.map((invocation) => invocation.toolId));
  for (const forbidden of ["core.workspace.read-file", "core.workspace.write-file", "core.terminal.execute", "core.git.status"]) {
    assert.ok(!invoked.has(forbidden), `Static planner must not auto-invoke ${forbidden}`);
  }
});
