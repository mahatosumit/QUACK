import test from "node:test";
import assert from "node:assert/strict";
import { DecisionMemoryStore } from "./decision-memory.js";

test("DecisionMemoryStore records decisions and rationale", async () => {
  const store = new DecisionMemoryStore();
  const dec = await store.recordDecision({
    chosen: "PostgreSQL",
    reason: "Relational consistency required",
    impact: "Backend architecture",
    tags: ["storage", "db"],
  });
  assert.equal(dec.chosen, "PostgreSQL");
  assert.ok(dec.id.startsWith("dec_"));

  const rat = await store.recordRationale({
    decisionId: dec.id,
    rationale: "Relational integrity outweighs flexibility of document stores",
    alternatives: [{ name: "MongoDB", description: "document store" }],
    evidence: ["ACID requirements", "complex joins"],
  });
  assert.equal(rat.decisionId, dec.id);
});

test("DecisionMemoryStore searches across fields", async () => {
  const store = new DecisionMemoryStore();
  await store.recordDecision({ chosen: "Vite", reason: "fast HMR", impact: "frontend build", tags: ["tooling"] });
  await store.recordDecision({ chosen: "Express", reason: "boring", impact: "API layer", tags: ["server"] });

  const hits = store.searchDecisions("frontend");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].chosen, "Vite");

  const tagHits = store.searchDecisions("tooling");
  assert.equal(tagHits.length, 1);
});

test("DecisionMemoryStore get/getRationale/delete", async () => {
  const store = new DecisionMemoryStore();
  const d = await store.recordDecision({ chosen: "X", reason: "Y", impact: "Z" });
  await store.recordRationale({ decisionId: d.id, rationale: "because" });
  assert.equal(store.getDecision(d.id)?.chosen, "X");
  assert.equal(store.getRationale(d.id)?.rationale, "because");
  const removed = await store.deleteDecision(d.id);
  assert.equal(removed, true);
});
