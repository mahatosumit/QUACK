import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LearningStore } from "./learning-store.js";

describe("LearningStore", () => {
  const ls = new LearningStore("/tmp/test-ls");

  it("record adds a failure", async () => {
    await ls.record("fix the thing", "context here");
    const failures = await ls.getRecentFailures();
    assert.equal(failures.length, 1);
    assert.equal(failures[0].fix, "fix the thing");
  });

  it("record caps at 500 failures", async () => {
    const capStore = new LearningStore("/tmp/test-cap");
    for (let i = 0; i < 510; i++) {
      await capStore.record(`fix-${i}`, `ctx-${i}`);
    }
    const failures = await capStore.getRecentFailures(600);
    assert.equal(failures.length, 500);
  });

  it("recordRepair stores a repair pattern", async () => {
    await ls.recordRepair("common bug", "add null check");
    const found = await ls.findRepair("common bug pattern");
    assert.ok(found !== undefined);
    assert.equal(found!.fix, "add null check");
  });

  it("recordRepair updates existing pattern on second call", async () => {
    const repStore = new LearningStore("/tmp/test-rep");
    await repStore.recordRepair("persistent bug", "fix v1");
    const found1 = await repStore.findRepair("persistent bug");
    assert.equal(found1!.occurrences, 1);
    await repStore.recordRepair("persistent bug", "fix v2");
    const found2 = await repStore.findRepair("persistent bug");
    assert.equal(found2!.occurrences, 2);
    assert.equal(found2!.fix, "fix v1");
  });

  it("findRepair returns undefined for unknown pattern", async () => {
    const found = await ls.findRepair("nope");
    assert.equal(found, undefined);
  });

  it("getCommonFixes returns sorted repairs", async () => {
    await ls.recordRepair("rare bug", "rare fix");
    const fixes = await ls.getCommonFixes(5);
    assert.ok(fixes.length >= 1);
  });

  it("clear removes all data", async () => {
    const store = new LearningStore("/tmp/test-clear");
    await store.record("fix1", "ctx1");
    await store.recordRepair("pat1", "fix1");
    assert.equal(store.stats().repairs, 1);
    assert.equal(store.stats().failures, 1);
    await store.clear();
    assert.equal(store.stats().repairs, 0);
    assert.equal(store.stats().failures, 0);
  });
});
