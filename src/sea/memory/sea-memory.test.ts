import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { SeaMemory } from "./sea-memory.js";

describe("SeaMemory", () => {
  const mem = new SeaMemory("/tmp/test-sea-mem");

  before(() => {
    mem.clear();
  });

  it("store and retrieve a value", async () => {
    await mem.store("test-key", "workspace-pattern", { foo: "bar" });
    const data = await mem.retrieve("test-key");
    assert.deepEqual(data, { foo: "bar" });
  });

  it("retrieve returns undefined for missing key", async () => {
    const data = await mem.retrieve("nonexistent");
    assert.equal(data, undefined);
  });

  it("findByType returns matching entries", async () => {
    await mem.store("key2", "workspace-pattern", { x: 1 });
    const entries = await mem.findByType("workspace-pattern");
    assert.ok(entries.length >= 2);
  });

  it("recordEdit maintains history", async () => {
    const plan: any = { goal: "test", operations: [], affectedFiles: ["f.ts"], riskAssessment: "low", requiresReview: false, requiredPermissions: [] };
    const result: any = { patch: { id: "p1", description: "", files: [], timestamp: "", status: "pending" }, validationResults: [], applied: true, rollbackAvailable: false, summary: "ok" };
    await mem.recordEdit(plan, result);
    assert.equal(mem.getEditHistory().length, 1);
  });

  it("stats returns counts", async () => {
    const s = mem.stats();
    assert.ok(typeof s.entries === "number");
    assert.ok(typeof s.editHistory === "number");
  });

  it("retrieve returns undefined after TTL expiration", async () => {
    const shortMem = new SeaMemory("/tmp/test-ttl");
    await shortMem.store("ttl-key", "workspace-pattern", { data: "ephemeral" }, -1);
    const data = await shortMem.retrieve("ttl-key");
    assert.equal(data, undefined);
  });

  it("findByType filters expired entries", async () => {
    const shortMem = new SeaMemory("/tmp/test-ttl2");
    await shortMem.store("expired", "workspace-pattern", { x: 1 }, -1);
    await shortMem.store("valid", "workspace-pattern", { x: 2 }, 86_400_000);
    const entries = await shortMem.findByType("workspace-pattern");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].key, "valid");
  });

  it("clear removes all entries and history", async () => {
    const clearMem = new SeaMemory("/tmp/test-clear");
    await clearMem.store("k1", "workspace-pattern", { a: 1 });
    const plan: any = { goal: "test", operations: [], affectedFiles: [], riskAssessment: "low", requiresReview: false, requiredPermissions: [] };
    const result: any = { patch: { id: "p", description: "", files: [], timestamp: "", status: "pending" }, validationResults: [], applied: false, rollbackAvailable: false, summary: "" };
    await clearMem.recordEdit(plan, result);
    assert.equal(clearMem.stats().entries, 1);
    assert.equal(clearMem.stats().editHistory, 1);
    await clearMem.clear();
    assert.equal(clearMem.stats().entries, 0);
    assert.equal(clearMem.stats().editHistory, 0);
  });

  it("recordEdit limits history to 200 entries", async () => {
    const limitMem = new SeaMemory("/tmp/test-limit");
    const plan: any = { goal: "test", operations: [], affectedFiles: [], riskAssessment: "low", requiresReview: false, requiredPermissions: [] };
    const result: any = { patch: { id: "p", description: "", files: [], timestamp: "", status: "pending" }, validationResults: [], applied: false, rollbackAvailable: false, summary: "" };
    for (let i = 0; i < 250; i++) {
      await limitMem.recordEdit(plan, result);
    }
    assert.equal(limitMem.getEditHistory().length, 200);
  });

  it("recordEdit with applied result stores summary only once", async () => {
    const summaryMem = new SeaMemory("/tmp/test-summary");
    const plan: any = { goal: "test", operations: [], affectedFiles: ["f.ts"], riskAssessment: "low", requiresReview: false, requiredPermissions: [] };
    const appliedResult: any = { patch: { id: "p1", description: "", files: [], timestamp: "", status: "pending" }, validationResults: [{ type: "typecheck", passed: true, errors: [], warnings: [], durationMs: 10 }], applied: true, rollbackAvailable: false, summary: "ok" };
    await summaryMem.recordEdit(plan, appliedResult);
    const entry = await summaryMem.retrieve("last-edit-summary");
    assert.ok(entry);
    assert.equal(entry!.description, "test");
  });

  it("recordEdit does not overwrite existing last-edit-summary", async () => {
    const overwriteMem = new SeaMemory("/tmp/test-overwrite");
    await overwriteMem.store("last-edit-summary", "workspace-pattern", { description: "original", files: [], validations: 0 }, 86_400_000);
    const plan: any = { goal: "overwrite-test", operations: [], affectedFiles: ["f.ts"], riskAssessment: "low", requiresReview: false, requiredPermissions: [] };
    const result: any = { patch: { id: "p1", description: "", files: [], timestamp: "", status: "pending" }, validationResults: [], applied: true, rollbackAvailable: false, summary: "ok" };
    await overwriteMem.recordEdit(plan, result);
    const entry = await overwriteMem.retrieve("last-edit-summary");
    assert.equal(entry!.description, "original");
  });
});
