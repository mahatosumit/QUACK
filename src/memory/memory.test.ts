import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { InMemoryMemoryStore, JsonFileMemoryStore, isProtectedMemoryRecord } from "./memory.js";

test("in-memory memory store write and search", async () => {
  const store = new InMemoryMemoryStore();

  const record = await store.write({
    scope: "task",
    content: "Test memory entry",
    metadata: { taskId: "task_1" },
  });

  assert.ok(record.id.startsWith("memory_"));
  assert.equal(record.scope, "task");
  assert.equal(record.content, "Test memory entry");

  const results = await store.search({ text: "memory" });
  assert.equal(results.length, 1);

  const noMatch = await store.search({ text: "nonexistent" });
  assert.equal(noMatch.length, 0);
});

test("in-memory memory store scope filtering", async () => {
  const store = new InMemoryMemoryStore();

  await store.write({ scope: "task", content: "task note", metadata: {} });
  await store.write({ scope: "workspace", content: "workspace note", metadata: {} });

  const tasks = await store.search({ scope: "task" });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].scope, "task");

  const all = await store.search({});
  assert.equal(all.length, 2);
});

test("json-file memory store persists across instances", async () => {
  const dir = join(tmpdir(), `quack-memory-test-${randomBytes(4).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "memory.json");

  try {
    const store1 = new JsonFileMemoryStore(filePath);
    await store1.write({ scope: "task", content: "persistent entry", metadata: {} });

    // Read with a fresh instance (simulates restart)
    const store2 = new JsonFileMemoryStore(filePath);
    const results = await store2.search({ text: "persistent" });
    assert.equal(results.length, 1);
    assert.equal(results[0].content, "persistent entry");
  } finally {
    if (existsSync(filePath)) unlinkSync(filePath);
  }
});

test("in-memory memory store compaction bounds per scope", async () => {
  const store = new InMemoryMemoryStore();
  for (let index = 0; index < 5; index += 1) {
    await store.write({ scope: "task", content: `entry ${index}`, metadata: {} });
  }

  const result = await store.compact({ maxItemsPerScope: 2 });

  assert.equal(result.removed, 3);
  assert.equal(result.kept, 2);
  const all = await store.search({});
  assert.equal(all.length, 2);
});

test("memory store compaction preserves protected records beyond the bound", async () => {
  const store = new InMemoryMemoryStore();
  for (let index = 0; index < 5; index += 1) {
    await store.write({ scope: "task", content: `entry ${index}`, metadata: {} });
  }
  await store.write({ scope: "task", content: "validated fact", metadata: { memoryClass: "validated-knowledge" } });
  await store.write({ scope: "task", content: "security decision", metadata: { protected: true } });

  const result = await store.compact({ maxItemsPerScope: 2 });

  // The two protected records survive; the remaining bound slots take the newest ordinary records.
  assert.equal(result.removed, 3);
  assert.equal(result.kept, 4);
  const contents = (await store.search({})).map(record => record.content);
  assert.ok(contents.includes("validated fact"));
  assert.ok(contents.includes("security decision"));
});

test("memory store compaction deduplicates identical content within a scope", async () => {
  const store = new InMemoryMemoryStore();
  await store.write({ scope: "task", content: "duplicate note", metadata: {} });
  await store.write({ scope: "task", content: "duplicate note", metadata: {} });
  await store.write({ scope: "task", content: "unique note", metadata: {} });

  const result = await store.compact({});

  assert.equal(result.removed, 1);
  assert.equal(result.kept, 2);
});

test("memory store compaction drops records older than the bound", async () => {
  const store = new InMemoryMemoryStore();
  await store.write({ scope: "task", content: "stale", metadata: {} });
  await new Promise(resolve => setTimeout(resolve, 5));
  const bound = new Date().toISOString();
  await store.write({ scope: "task", content: "fresh", metadata: {} });

  const result = await store.compact({ olderThan: bound });

  assert.equal(result.removed, 1);
  const all = await store.search({});
  assert.equal(all.length, 1);
  assert.equal(all[0].content, "fresh");
});

test("json-file memory store compaction persists across instances", async () => {
  const dir = join(tmpdir(), `quack-memory-test-${randomBytes(4).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "memory.json");

  try {
    const store1 = new JsonFileMemoryStore(filePath);
    for (let index = 0; index < 4; index += 1) {
      await store1.write({ scope: "task", content: `entry ${index}`, metadata: {} });
    }
    const result = await store1.compact({ maxItemsPerScope: 2 });
    assert.equal(result.removed, 2);

    const store2 = new JsonFileMemoryStore(filePath);
    const all = await store2.search({});
    assert.equal(all.length, 2);
  } finally {
    if (existsSync(filePath)) unlinkSync(filePath);
  }
});

test("isProtectedMemoryRecord recognizes validated knowledge and explicit markers", () => {
  assert.equal(isProtectedMemoryRecord({ id: "a", scope: "task", content: "x", createdAt: "2026-01-01T00:00:00.000Z",
    metadata: { memoryClass: "validated-knowledge" } }), true);
  assert.equal(isProtectedMemoryRecord({ id: "b", scope: "task", content: "x", createdAt: "2026-01-01T00:00:00.000Z",
    metadata: { protected: true } }), true);
  assert.equal(isProtectedMemoryRecord({ id: "c", scope: "task", content: "x", createdAt: "2026-01-01T00:00:00.000Z",
    metadata: { protect: true } }), true);
  assert.equal(isProtectedMemoryRecord({ id: "d", scope: "task", content: "x", createdAt: "2026-01-01T00:00:00.000Z",
    metadata: {} }), false);
});

test("protect:false disables protection for age, dedup, and bound consistently", async () => {
  const store = new InMemoryMemoryStore();
  await store.write({ scope: "task", content: "validated fact", metadata: { memoryClass: "validated-knowledge" } });
  await store.write({ scope: "task", content: "validated fact", metadata: { memoryClass: "validated-knowledge" } });
  await store.write({ scope: "task", content: "ordinary", metadata: {} });
  await new Promise(resolve => setTimeout(resolve, 5));
  const bound = new Date().toISOString();
  await store.write({ scope: "task", content: "fresh", metadata: {} });

  const result = await store.compact({ protect: false, olderThan: bound, maxItemsPerScope: 1 });

  assert.equal(result.removed, 3);
  const contents = (await store.search({})).map(record => record.content);
  assert.equal(contents.length, 1);
  assert.equal(contents[0], "fresh");
});
