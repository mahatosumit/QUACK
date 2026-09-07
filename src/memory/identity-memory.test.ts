import test from "node:test";
import assert from "node:assert/strict";
import { IdentityMemoryStore } from "./identity-memory.js";

test("IdentityMemoryStore writes and searches records", async () => {
  const store = new IdentityMemoryStore();
  await store.write("prefers modular code", { codingStyle: "modular" });
  await store.write("long-term goal: robotics startup", { kind: "goal" });
  const hits = await store.search("modular");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].scope, "identity");
});

test("IdentityMemoryStore supports user-controlled delete", async () => {
  const store = new IdentityMemoryStore();
  const rec = await store.write("hello", { a: 1 });
  const removed = await store.delete(rec.id);
  assert.equal(removed, true);
  assert.equal(store.getAll().length, 0);
  const again = await store.delete("missing");
  assert.equal(again, false);
});

test("IdentityMemoryStore export produces a snapshot", () => {
  const store = new IdentityMemoryStore();
  const snapshot = store.export();
  assert.deepEqual(Array.isArray(snapshot.records), true);
});
