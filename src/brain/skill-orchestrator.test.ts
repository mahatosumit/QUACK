import { createBuiltinSkillCatalog } from "../skills/builtins/index.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "../skills/builtins/index.js";
import { SkillRegistry } from "../skills/registry.js";
import { SkillLoader } from "../skills/loader.js";
import { SkillOrchestrator } from "./skill-orchestrator.js";

function createTestRegistry(): SkillRegistry {
  const registry = new SkillRegistry();
  const loader = new SkillLoader(createBuiltinSkillCatalog());
  for (const skill of loader.loadBuiltins()) {
    registry.register(skill);
  }
  return registry;
}

describe("SkillOrchestrator", () => {
  it("discovers relevant skills for a goal", () => {
    const registry = createTestRegistry();
    const orch = new SkillOrchestrator(registry);
    const plan = orch.discoverRelevant("git");
    assert.ok(plan.skills.length > 0);
    const found = plan.skills.some((s) => s.skillId.includes("git"));
    assert.ok(found);
  });

  it("returns empty plan for non-matching goal", () => {
    const registry = createTestRegistry();
    const orch = new SkillOrchestrator(registry);
    const plan = orch.discoverRelevant("zzz_no_match_xyz");
    assert.ok(Array.isArray(plan.skills));
  });

  it("ranks candidates by weight descending", () => {
    const registry = createTestRegistry();
    const orch = new SkillOrchestrator(registry);
    const plan = orch.discoverRelevant("code");
    const ranked = orch.rankCandidates(plan);
    for (let i = 1; i < ranked.skills.length; i++) {
      assert.ok(
        ranked.skills[i - 1].weight >= ranked.skills[i].weight,
        `index ${i - 1} (${ranked.skills[i - 1].weight}) >= index ${i} (${ranked.skills[i].weight})`,
      );
    }
  });

  it("estimateCost returns zero when no model router", () => {
    const registry = createTestRegistry();
    const orch = new SkillOrchestrator(registry);
    const plan = orch.discoverRelevant("code");
    const cost = orch.estimateCost("test", plan);
    assert.equal(cost.totalUsd, 0);
    assert.deepEqual(cost.breakdown, []);
  });

  it("composes workflow from plan", () => {
    const registry = createTestRegistry();
    const orch = new SkillOrchestrator(registry);
    const plan = orch.discoverRelevant("testing");
    const workflow = orch.composeWorkflow(plan);
    assert.ok(Array.isArray(workflow));
    assert.ok(workflow.length > 0);
  });

  it("records execution and returns preferred skills", () => {
    const registry = createTestRegistry();
    const orch = new SkillOrchestrator(registry);
    const plan = orch.discoverRelevant("all");
    if (plan.skills.length > 0) {
      const id = plan.skills[0].skillId;
      orch.recordExecution(id, 100);
      orch.recordExecution(id, 200);
      const preferred = orch.getPreferredSkills();
      assert.ok(preferred.includes(id));
    }
  });

  it("getPreferredSkills returns empty when none used", () => {
    const registry = createTestRegistry();
    const orch = new SkillOrchestrator(registry);
    assert.deepEqual(orch.getPreferredSkills(), []);
  });

  it("estimateCost with model router returns breakdown", async () => {
    const registry = createTestRegistry();
    const { ModelRegistry, ModelRouter } = await import("../models/index.js");
    const modelRegistry = new ModelRegistry();
    const modelRouter = new ModelRouter();
    modelRegistry.register({
      id: "test-model",
      name: "Test",
      provider: "local",
      capabilities: ["balanced"],
      contextWindow: 4096,
      supportsTools: false,
      latencyMs: 10,
      costPer1kInput: 0.001,
      costPer1kOutput: 0.002,
      status: "available",
    });
    const orch = new SkillOrchestrator(registry, modelRegistry, modelRouter);
    const plan = orch.discoverRelevant("git");
    const cost = orch.estimateCost("test", plan);
    assert.ok(cost.totalUsd >= 0);
    assert.ok(cost.breakdown.length > 0);
    assert.ok(cost.breakdown.every((b) => typeof b.costUsd === "number"));
  });
});
