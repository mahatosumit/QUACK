import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckpointManager, InMemoryCheckpointStore, JsonFileCheckpointStore } from "./checkpoint-system.js";
import { type Checkpoint } from "./types.js";

function fixture(id: string): Checkpoint {
  return {
    id, workflowId: "w", sessionId: "s", planId: "p", timestamp: "2026-09-05T00:00:00.000Z",
    workflowState: { workflowId: "w", sessionId: "s", planId: "p", status: "paused",
      taskGraph: { id: "g", description: "test", nodes: [], edges: [], createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z", metadata: {} },
      nodeStates: {}, nodeResults: {}, readyQueue: [], runningNodes: [], completedNodes: [], failedNodes: [], skippedNodes: [], progress: 0, errors: [] },
    nodeResults: {}, journalSinceLastCheckpoint: [], metadata: { nested: { value: 1 } },
  };
}

test("checkpoint concurrent reads and mutations preserve legacy data and serialize writes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "quack-checkpoint-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "checkpoints.json");
  await writeFile(path, JSON.stringify({ checkpoints: [fixture("old")] }));
  const store = new JsonFileCheckpointStore(path);
  const [old] = await Promise.all([store.load("old"), store.list("w"), ...Array.from({ length: 20 }, (_, i) => store.save(fixture(`new-${i}`)))]);
  assert.deepEqual(old, fixture("old"));
  await Promise.all([store.delete("old"), store.prune("w", 10), store.save(fixture("last"))]);
  const restored = await new JsonFileCheckpointStore(path).list("w");
  assert.equal(restored.length, 11);
  assert.ok(restored.some((c) => c.id === "last"));
  assert.equal(JSON.parse(await readFile(path, "utf8")).version, 1);
});

for (const kind of ["memory", "file"] as const) {
  test(`${kind} checkpoint store isolates snapshots`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "quack-checkpoint-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const store = kind === "memory" ? new InMemoryCheckpointStore() : new JsonFileCheckpointStore(join(dir, "state.json"));
    const checkpoint = fixture("one");
    const pending = store.save(checkpoint);
    (checkpoint.metadata.nested as { value: number }).value = 2;
    await pending;
    const loaded = (await store.load("one"))!;
    (loaded.metadata.nested as { value: number }).value = 3;
    const listed = await store.list("w");
    listed[0].workflowState.errors.push("mutated");
    assert.deepEqual(await store.load("one"), fixture("one"));
  });
}

for (const raw of ["{", "{}", JSON.stringify({ version: 2, checkpoints: [] }), JSON.stringify({ checkpoints: [{ id: "bad" }] }), JSON.stringify({ checkpoints: [fixture("one"), fixture("one")] }), JSON.stringify({ checkpoints: [{ ...fixture("bad"), workflowState: {} }] })]) {
  test(`checkpoint invalid data repeatedly rejects: ${raw.slice(0, 40)}`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "quack-checkpoint-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, "state.json");
    await writeFile(path, raw);
    const store = new JsonFileCheckpointStore(path);
    await assert.rejects(store.list("w"));
    await assert.rejects(store.load("bad"));
    await assert.rejects(store.save(fixture("new")));
    await assert.rejects(store.delete("bad"));
    await assert.rejects(store.prune("w", 0));
    assert.equal(await readFile(path, "utf8"), raw);
  });
}

test("failed checkpoint save delete and prune preserve cached state and queue recovers", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "quack-checkpoint-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "state.json");
  const store = new JsonFileCheckpointStore(path);
  await store.save(fixture("old"));
  await unlink(path);
  await mkdir(path);
  await assert.rejects(store.save(fixture("new")));
  await assert.rejects(store.delete("old"));
  await assert.rejects(store.prune("w", 0));
  assert.deepEqual(await store.list("w"), [fixture("old")]);
  await rmdir(path);
  await store.save(fixture("new"));
  assert.equal((await new JsonFileCheckpointStore(path).list("w")).length, 2);
});

test("checkpoint manager saves before pruning retained checkpoints", async () => {
  const store = new InMemoryCheckpointStore();
  await store.save(fixture("old"));
  store.save = async () => { throw new Error("disk failed"); };
  const manager = new CheckpointManager(store, 1);
  await assert.rejects(manager.create("w", "s", "p", fixture("x").workflowState, {}, []));
  assert.ok(await store.load("old"));
});

test("checkpoint store preserves extension fields across loading and mutation", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "quack-checkpoint-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "state.json");
  const checkpoint = { ...fixture("old"), recovery: { version: 1, nested: { value: true } } };
  await writeFile(path, JSON.stringify({ version: 1, checkpoints: [checkpoint] }));
  const store = new JsonFileCheckpointStore(path);
  await store.save(fixture("new"));
  assert.deepEqual(await new JsonFileCheckpointStore(path).load("old"), checkpoint);
});
