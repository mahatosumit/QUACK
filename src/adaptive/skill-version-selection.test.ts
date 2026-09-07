import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicObjectiveEvaluator } from "../cos/deterministic-evaluator.js";
import { DEFAULT_NO_REGRESSION_OBJECTIVE_ID, ObjectiveRegistry } from "../cos/objectives.js";
import { type EvidenceBackedExperience, type MetricObservation, type ObjectiveEvaluationStatus, type ObjectiveSpecification } from "../cos/types.js";
import { type SkillDefinition } from "../skills/types.js";
import { SkillRegistry } from "../skills/registry.js";
import { EchoTool, ToolRegistry } from "../tools/tool.js";
import { WorkspaceListFilesTool } from "../tools/workspace-filesystem.js";
import { ContextualSkillSelector, SkillFitnessIndex, createSkillFitnessContext } from "./skill-fitness.js";

test("contextual selector chooses the active version with stronger evidence for each context", async () => {
  const harness = createHarness();
  harness.skills.register(skill("contract-impact-analysis", "1.0.0"));
  harness.skills.register(skill("contract-impact-analysis", "2.0.0"), "generated", "active", {
    parentVersion: "1.0.0",
    setDefault: true,
  });
  const legacy = createSkillFitnessContext("legacy typescript contract impact").contextKey;
  const modern = createSkillFitnessContext("modern typescript contract impact").contextKey;

  await harness.fitness.updateFromExperiences([
    experience("legacy-v1-good", "1.0.0", "IMPROVED", legacy),
    experience("legacy-v2-bad", "2.0.0", "REGRESSED", legacy),
    experience("modern-v1-bad", "1.0.0", "REGRESSED", modern),
    experience("modern-v2-good", "2.0.0", "IMPROVED", modern),
  ]);

  assert.deepEqual(harness.selector.select({ goal: "legacy typescript contract impact" }).selected[0], {
    skillId: "contract-impact-analysis",
    version: "1.0.0",
    source: "builtin",
  });
  assert.deepEqual(harness.selector.select({ goal: "modern typescript contract impact" }).selected[0], {
    skillId: "contract-impact-analysis",
    version: "2.0.0",
    source: "generated",
  });
});

test("selector excludes candidate retired and quarantined versions while preserving active versions", () => {
  const harness = createHarness();
  harness.skills.register(skill("contract-impact-analysis", "1.0.0"));
  harness.skills.register(skill("contract-impact-analysis", "1.1.0"), "generated", "candidate", { parentVersion: "1.0.0" });
  harness.skills.register(skill("contract-impact-analysis", "1.2.0"), "generated", "retired", { parentVersion: "1.0.0" });
  harness.skills.register(skill("contract-impact-analysis", "1.3.0"), "generated", "quarantined", { parentVersion: "1.0.0" });

  assert.deepEqual(harness.selector.select({ goal: "contract impact review" }).selected[0], {
    skillId: "contract-impact-analysis",
    version: "1.0.0",
    source: "builtin",
  });
});

test("selector uses explicit default fallback when version fitness is missing", () => {
  const harness = createHarness();
  harness.skills.register(skill("contract-impact-analysis", "1.0.0"));
  harness.skills.register(skill("contract-impact-analysis", "9.0.0"), "generated", "active", {
    parentVersion: "1.0.0",
  });

  assert.equal(harness.skills.getDefaultVersion("contract-impact-analysis"), "1.0.0");
  assert.deepEqual(harness.selector.select({ goal: "contract impact review" }).selected[0], {
    skillId: "contract-impact-analysis",
    version: "1.0.0",
    source: "builtin",
  });
});

function createHarness() {
  const tools = new ToolRegistry();
  tools.register(new EchoTool());
  tools.register(new WorkspaceListFilesTool({ workspaceRoot: process.cwd() }));
  const skills = new SkillRegistry();
  const fitness = new SkillFitnessIndex();
  return {
    tools,
    skills,
    fitness,
    selector: new ContextualSkillSelector({ skills, tools, fitness, allowedPermissions: ["workspace.read"] }),
  };
}

function skill(id: string, version: string): SkillDefinition {
  return {
    manifest: {
      id,
      name: "Contract Impact Analysis",
      version,
      description: "Analyze contract impact for legacy and modern TypeScript projects.",
      author: "test",
      category: "analysis",
      tags: ["contract", "impact", "typescript", "legacy", "modern"],
      requiresPermissions: ["workspace.read"],
      requiresTools: ["core.workspace.list-files"],
      entry: `skills/${id}-${version}.js`,
    },
    execute: async () => ({ ok: true, durationMs: 0 }),
  };
}

function experience(
  runId: string,
  version: string,
  status: ObjectiveEvaluationStatus,
  contextKey: string,
): EvidenceBackedExperience {
  const objective = new ObjectiveRegistry().get(DEFAULT_NO_REGRESSION_OBJECTIVE_ID)!;
  const observations = observationsFor(runId, status === "IMPROVED" ? 0 : 3, objective);
  const execution = {
    runtimeId: "test-runtime",
    contextKey,
    contextTags: contextKey.split(":"),
    selectedSkills: [{ skillId: "contract-impact-analysis", version, source: version === "1.0.0" ? "builtin" : "generated" }],
  };
  const evaluation = new DeterministicObjectiveEvaluator().evaluate({
    objective,
    runId,
    observations,
    baselineRunId: "baseline",
    baselineObservations: observationsFor("baseline", 1, objective),
    execution,
  });
  assert.equal(evaluation.status, status);
  return {
    id: `exp-${runId}`,
    objective,
    execution,
    runId,
    taskId: `task-${runId}`,
    actions: ["test action"],
    outcomes: ["task.status:completed"],
    metricObservations: evaluation.observations,
    evaluation,
    evidence: evaluation.evidence,
    resultStatus: "completed",
    traceRefs: [`task-${runId}`],
    createdAt: "2026-08-05T00:00:00.000Z",
  };
}

function observationsFor(runId: string, failedSteps: number, objective: ObjectiveSpecification): MetricObservation[] {
  return [
    {
      id: `obs-completed-${runId}`,
      objectiveId: objective.id,
      metricId: "runtime.task.completed",
      runId,
      source: "test",
      value: true,
      valid: true,
      observedAt: "2026-08-05T00:00:00.000Z",
      sequence: 0,
    },
    {
      id: `obs-failed-${runId}`,
      objectiveId: objective.id,
      metricId: "runtime.failed_steps",
      runId,
      source: "test",
      value: failedSteps,
      valid: true,
      observedAt: "2026-08-05T00:00:00.000Z",
      sequence: 1,
    },
  ];
}
