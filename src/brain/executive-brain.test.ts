import test from "node:test";
import assert from "node:assert/strict";
import { SimpleBrain } from "./simple-brain.js";
import { type BrainContext } from "./brain.js";
import { createId } from "../core/types.js";
import { ExecutiveBrain } from "./executive-brain.js";
import { EventBus } from "../events/event-bus.js";
import { ToolRegistry } from "../tools/tool.js";
import { ProviderRegistry } from "../providers/provider.js";
import { InMemoryMemoryStore } from "../memory/memory.js";

function testContext(): BrainContext {
  return { actor: "test", sessionId: "test-session", workspaceId: "test-ws" };
}

test("SimpleBrain plan returns three steps", async () => {
  const brain = new SimpleBrain();
  const task = {
    id: createId("task"),
    goal: "test the system",
    status: "created" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plan: [],
  };

  const result = await brain.plan(task, testContext());
  assert.ok(result.ok);
  if (!result.ok) return;

  assert.equal(result.data.steps.length, 3);
  assert.equal(result.data.goal, "test the system");
  assert.equal(result.data.estimatedTotalComplexity, "low");
});

test("SimpleBrain refuses execution without an executor and validator", async () => {
  const brain = new SimpleBrain();
  const task = {
    id: createId("task"),
    goal: "execute test",
    status: "planned" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plan: [],
  };

  const result = await brain.execute(task, testContext());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "brain.execution_unsupported");
});

test("SimpleBrain reason returns zero confidence stub", async () => {
  const brain = new SimpleBrain();
  const result = await brain.reason("Why does the sun shine?", testContext());
  assert.ok(result.ok);
  if (!result.ok) return;

  assert.equal(result.data.question, "Why does the sun shine?");
  assert.equal(result.data.confidence, 0);
});

test("SimpleBrain reflection does not certify an unverified result", async () => {
  const brain = new SimpleBrain();
  const result = await brain.reflect("step_1", { ok: true, data: "ok" }, testContext());
  assert.ok(result.ok);
  if (!result.ok) return;

  assert.equal(result.data.outcome, "partial");
  assert.equal(result.data.shouldRetry, false);
});

test("ExecutiveBrain plans without owning sessions, executing tools, or emitting task lifecycle", async () => {
  const events = new EventBus();
  const emitted: string[] = [];
  events.onAny((event) => { emitted.push(event.type); });
  const brain = new ExecutiveBrain({ eventBus: events, tools: new ToolRegistry(), providers: new ProviderRegistry(), memory: new InMemoryMemoryStore() });
  const task = { id: "task", goal: "inspect workspace", status: "created" as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), plan: [] };
  const planned = await brain.plan(task, testContext());
  assert.ok(planned.ok);
  if (planned.ok) assert.deepEqual(planned.data.steps[0].toolInvocations?.[0].input, { path: ".", depth: 2 });
  assert.deepEqual(emitted, []);
  const result = await brain.execute(task, testContext());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "brain.execution_unsupported");
  assert.equal(brain.getCurrentSessionId(), undefined);
  assert.throws(() => brain.getSessionRuntime(), /does not own sessions/);
});
