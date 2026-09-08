import { InMemoryTaskStore, JsonFileTaskStore } from "./task-store.js";
import { type Task } from "../runtime/task.js";
import { readFile, rm, mkdtemp, writeFile, unlink, mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import { createId } from "../core/types.js";
import { createQuackSystem } from "../distributions/swe-system.js";

test("runtime persists tasks and audit events to the configured data directory", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_workspace"));
  const dataDir = join(tmpdir(), createId("quack_state"));
  await mkdir(workspaceRoot, { recursive: true });

  try {
    const system = createQuackSystem({ workspaceRoot, dataDir });
    const result = await system.runtime.submitGoal("persist runtime state", "test");

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.status, "completed", "default assembly certifies via workflow evidence");

    const persisted = JSON.parse(await readFile(join(dataDir, "tasks.json"), "utf8")) as { tasks: Array<{ id: string; status: string }> };
    assert.equal(persisted.tasks.length, 1);
    assert.equal(persisted.tasks[0]?.id, result.data.id);
    assert.equal(persisted.tasks[0]?.status, "completed");

    const events = await system.auditLog.readAll();
    assert.ok(events.some((event) => event.type === "task.created"));
    assert.ok(events.some((event) => event.type === "task.completed"));
  } finally {
    // Windows briefly retains directory entries after a database close and
    // while async event sinks flush; retry removal (same pattern as
    // removeTestDirectory in test-support).
    await rm(workspaceRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
    await rm(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});


function taskFixture(id: string): Task {
  return { id, goal: "persist", status: "created", createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z", plan: [], result: { nested: { value: 1 } } };
}

test("concurrent initial reads and saves preserve persisted and new tasks", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "quack-task-store-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "tasks.json");
  const old = taskFixture("old");
  await writeFile(path, JSON.stringify({ tasks: [old] }));
  const store = new JsonFileTaskStore(path);
  const [read, listed] = await Promise.all([
    store.get("old"), store.list(),
    ...Array.from({ length: 20 }, (_, index) => store.save(taskFixture(`new-${index}`))),
  ]);
  assert.deepEqual(read, old);
  assert.ok((listed as Task[]).some((task) => task.id === "old"));
  assert.equal((await new JsonFileTaskStore(path).list()).length, 21);
  assert.equal(JSON.parse(await readFile(path, "utf8")).version, 1);
});

for (const kind of ["memory", "file"] as const) {
  test(`${kind} task store isolates input and returned objects`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "quack-task-store-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const store = kind === "memory" ? new InMemoryTaskStore() : new JsonFileTaskStore(join(dir, "tasks.json"));
    const task = taskFixture("task");
    const saving = store.save(task);
    (task.result!.nested as { value: number }).value = 2;
    const saved = await saving;
    (saved.result!.nested as { value: number }).value = 3;
    const read = (await store.get("task"))!;
    (read.result!.nested as { value: number }).value = 4;
    const listed = await store.list();
    (listed[0].result!.nested as { value: number }).value = 5;
    assert.equal(((await store.get("task"))!.result!.nested as { value: number }).value, 1);
  });
}

for (const raw of ["{", "{}", JSON.stringify({ version: 2, tasks: [] }), JSON.stringify({ tasks: [{ id: "bad" }] }), JSON.stringify({ tasks: [taskFixture("duplicate"), taskFixture("duplicate")] })]) {
  test(`invalid persisted state repeatedly rejects: ${raw.slice(0, 40)}`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "quack-task-store-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, "tasks.json");
    await writeFile(path, raw);
    const store = new JsonFileTaskStore(path);
    await assert.rejects(store.list());
    await assert.rejects(store.get("bad"));
    await assert.rejects(store.save(taskFixture("new")));
    assert.equal(await readFile(path, "utf8"), raw);
  });
}

test("failed persistence preserves visible state and subsequent saves recover", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "quack-task-store-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "tasks.json");
  const store = new JsonFileTaskStore(path);
  await store.save(taskFixture("old"));
  await unlink(path);
  await mkdir(path);
  await assert.rejects(store.save(taskFixture("new")));
  assert.deepEqual((await store.list()).map((task) => task.id), ["old"]);
  await rmdir(path);
  await store.save(taskFixture("recovered"));
  assert.deepEqual((await new JsonFileTaskStore(path).list()).map((task) => task.id), ["old", "recovered"]);
});

