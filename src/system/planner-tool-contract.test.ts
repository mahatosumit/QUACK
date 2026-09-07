import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Planner } from "../engine/planner.js";
import { createQuackSystem } from "../distributions/swe-system.js";

test("planner - every required tool id is registered by the system composition root", () => {
  const system = createQuackSystem({
    workspaceRoot: process.cwd(),
    dataDir: join(tmpdir(), `quack-planner-tools-${randomUUID()}`),
  });
  const registeredToolIds = new Set(system.tools.list().map((tool) => tool.id));
  const planner = new Planner({
    defaultRetryPolicy: { maxRetries: 1, backoff: "fixed", baseDelayMs: 1, maxDelayMs: 1 },
    defaultTimeoutMs: 1_000,
    maxNodesPerGraph: 20,
  });
  const graph = planner.buildGraph("add a retry helper and run tests");
  const requiredToolIds = new Set(graph.nodes.flatMap((node) => node.requiredTools));

  for (const toolId of requiredToolIds) {
    assert.ok(registeredToolIds.has(toolId), `Planner referenced unregistered tool ${toolId}`);
  }
});
