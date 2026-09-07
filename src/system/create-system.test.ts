import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createQuackSystem } from "../distributions/swe-system.js";

describe("QuackSystem with SEA", () => {
  let system: ReturnType<typeof createQuackSystem>;

  before(() => {
    system = createQuackSystem({
      workspaceRoot: process.cwd(),
      dataDir: join(tmpdir(), `test-sea-system-${randomUUID()}`),
    });
  });

  it("creates a Sea instance", () => {
    assert.ok(system.sea);
    assert.equal(typeof system.sea.ensureIndexed, "function");
  });

  it("sea exposes all subsystem instances", () => {
    assert.ok(system.sea.understanding);
    assert.ok(system.sea.architecture);
    assert.ok(system.sea.awareness);
    assert.ok(system.sea.navigator);
    assert.ok(system.sea.crossFile);
    assert.ok(system.sea.dependencyAnalyzer);
    assert.ok(system.sea.editing);
    assert.ok(system.sea.incrementalEditor);
    assert.ok(system.sea.refactoring);
    assert.ok(system.sea.review);
    assert.ok(system.sea.testIntelligence);
    assert.ok(system.sea.testAnalyzer);
    assert.ok(system.sea.reporter);
    assert.ok(system.sea.memory);
    assert.ok(system.sea.learning);
  });

  it("sea provides top-level orchestration methods", () => {
    assert.equal(typeof system.sea.understandRepository, "function");
    assert.equal(typeof system.sea.analyzeArchitecture, "function");
    assert.equal(typeof system.sea.getWorkspaceHealth, "function");
    assert.equal(typeof system.sea.goToDefinition, "function");
    assert.equal(typeof system.sea.findReferences, "function");
    assert.equal(typeof system.sea.getCallHierarchy, "function");
    assert.equal(typeof system.sea.analyzeCrossFileImpact, "function");
    assert.equal(typeof system.sea.planEdit, "function");
    assert.equal(typeof system.sea.executeEdit, "function");
    assert.equal(typeof system.sea.reviewChanges, "function");
    assert.equal(typeof system.sea.runTests, "function");
    assert.equal(typeof system.sea.generateReport, "function");
    assert.equal(typeof system.sea.learnFromFailure, "function");
    assert.equal(typeof system.sea.learnFromRepair, "function");
  });

  it("integrates with QuackSystem slot", () => {
    assert.ok(system.runtime);
    assert.ok(system.events);
    assert.ok(system.tools);
    assert.ok(system.providers);
    assert.ok(system.memory);
    assert.ok(system.auditLog);
    assert.ok(system.semanticLayer);
  });
});
