import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQuackSystem } from "../system/create-system.js";
import { QuackRuntime } from "./runtime.js";
import { InMemoryTaskStore } from "../storage/task-store.js";

test("neutral runtime retains failed tasks across restart without re-executing them", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "quack-task-restart-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const first = createQuackSystem({ dataDir });
  const result = await first.runtime.submitGoal("An unconfigured planner must fail.");
  assert.ok(result.ok);
  assert.equal(result.data.status, "failed");
  await first.runtime.shutdown();

  const reopened = createQuackSystem({ dataDir });
  t.after(() => reopened.runtime.shutdown());
  assert.deepEqual(await reopened.runtime.getTask(result.data.id), result);
  assert.deepEqual(await reopened.runtime.listTasks(), [result.data]);
  const another = await reopened.runtime.submitGoal("A second task after restart.");
  assert.ok(another.ok);
  assert.equal((await reopened.runtime.listTasks()).length, 2);
});

test("runtime task storage stays ephemeral without dataDir and honors an explicit store", async (t) => {
  const ephemeral = createQuackSystem();
  const result = await ephemeral.runtime.submitGoal("A temporary task.");
  assert.ok(result.ok);
  await ephemeral.runtime.shutdown();
  const next = createQuackSystem();
  t.after(() => next.runtime.shutdown());
  assert.deepEqual(await next.runtime.listTasks(), []);

  const store = new InMemoryTaskStore();
  await store.save(result.data);
  const runtime = new QuackRuntime({
    eventBus: next.events, memory: next.memory, tools: next.tools, providers: next.providers,
    permissions: { decide: async () => ({ granted: false, reason: "Test denies all permissions." }) }, taskStore: store,
    dataDir: join(tmpdir(), "quack-explicit-store-unused"),
  });
  t.after(() => runtime.shutdown());
  assert.deepEqual(await runtime.getTask(result.data.id), result);
});
