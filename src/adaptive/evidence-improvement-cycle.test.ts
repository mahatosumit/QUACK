import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId } from "../core/types.js";
import { createQuackSystem } from "../distributions/swe-system.js";
import { DeterministicObjectiveEvaluator } from "../cos/deterministic-evaluator.js";
import { InMemoryEvidenceExperienceStore } from "../cos/evidence-experience-store.js";
import { DEFAULT_NO_REGRESSION_OBJECTIVE_ID, ObjectiveRegistry } from "../cos/objectives.js";
import { type EvidenceBackedExperience, type ExecutionVariantRole, type MetricObservation, type ObjectiveEvaluationStatus, type ObjectiveSpecification } from "../cos/types.js";
import { type Permission } from "../security/permissions.js";
import { type SkillDefinition, type SkillStatus } from "../skills/types.js";
import { SkillRegistry } from "../skills/registry.js";
import { JsonFileSkillRegistryStore, type SkillRegistryStore } from "../skills/persistence.js";
import { EchoTool, ToolRegistry } from "../tools/tool.js";
import { WorkspaceListFilesTool } from "../tools/workspace-filesystem.js";
import { TerminalTool } from "../tools/terminal.js";
import { createAdaptiveLayer } from "./adaptive-layer.js";
import { EvidenceDrivenSkillEvolution } from "./evidence-driven-skill-evolution.js";
import { ContextualSkillSelector, SkillFitnessIndex, createSkillFitnessContext } from "./skill-fitness.js";
import {
  EvidenceImprovementCycle,
  InMemoryImprovementCycleStateStore,
  JsonFileImprovementCycleStateStore,
  type ImprovementCycleStateStore,
  type SkillExperimentFixtureProvider,
} from "./evidence-improvement-cycle.js";

test("improvement cycle processes new evidence once and does not duplicate work on rerun", async () => {
  const harness = createHarness();
  registerSkill(harness.skills, "contract-impact-analysis", { tags: ["contract", "impact"] });
  await seedRegressions(harness, "contract-impact-analysis", 3);

  const first = await harness.cycle.runImprovementCycle({ minUses: 3, limits: { maxExperiences: 10, maxExperiments: 1 } });
  const second = await harness.cycle.runImprovementCycle({ minUses: 3, limits: { maxExperiences: 10, maxExperiments: 1 } });

  assert.equal(first.processedExperienceIds.length, 3);
  assert.equal(first.reviewItemsCreated.length, 1);
  assert.equal(first.decisions[0], "COLLECT_MORE_DATA");
  assert.equal(second.processedExperienceIds.length, 0);
  assert.equal(second.reviewItemsCreated.length, 0);
  assert.equal(second.checkpoint.reviewItems.length, 1);
});

test("improvement cycle advances its cursor with bounded batches", async () => {
  const harness = createHarness();
  registerSkill(harness.skills, "contract-impact-analysis", { tags: ["contract", "impact"] });
  await seedRegressions(harness, "contract-impact-analysis", 4);

  const first = await harness.cycle.runImprovementCycle({ minUses: 3, limits: { maxExperiences: 2, maxExperiments: 0 } });
  const second = await harness.cycle.runImprovementCycle({ minUses: 3, limits: { maxExperiences: 2, maxExperiments: 0 } });

  assert.equal(first.processedExperienceIds.length, 2);
  assert.equal(first.reviewItemsCreated.length, 0);
  assert.equal(second.processedExperienceIds.length, 2);
  assert.equal(second.reviewItemsCreated.length, 1);
  assert.equal(second.checkpoint.processedExperienceIds.length, 4);
});

test("repeated degradation creates one candidate revision and promotes improved evidence", async () => {
  const harness = createHarness((request) => experimentFixtures(request.candidate.manifest.id, "IMPROVED"));
  registerSkill(harness.skills, "contract-impact-analysis", { tags: ["contract", "impact", "exported", "api"] });
  await seedRegressions(harness, "contract-impact-analysis", 3);

  const result = await harness.cycle.runImprovementCycle({
    minUses: 3,
    limits: { maxExperiences: 10, maxExperiments: 1, maxCandidateRevisions: 1 },
  });

  assert.equal(result.experimentsCompleted.length, 1);
  assert.equal(result.decisions[0], "PROMOTE");
  assert.equal(harness.skills.getRecord("contract-impact-analysis", "1.1.0")?.status, "active");
  assert.equal(harness.skills.getRecord("contract-impact-analysis", "1.0.0")?.status, "review");
  assert.equal(harness.skills.getVersionSupersededBy("contract-impact-analysis", "1.0.0"), "1.1.0");
});

test("improvement cycle promotion persists native version state across restart", async () => {
  const stateDir = join(tmpdir(), createId("quack_skill_registry_state"));
  await mkdir(stateDir, { recursive: true });
  try {
    const skillStore = new JsonFileSkillRegistryStore(join(stateDir, "skills", "registry.json"));
    const harness = createHarness(
      (request) => experimentFixtures(request.candidate.manifest.id, "IMPROVED"),
      undefined,
      undefined,
      skillStore,
    );
    registerSkill(harness.skills, "contract-impact-analysis", { tags: ["contract", "impact", "exported", "api"] });
    await seedRegressions(harness, "contract-impact-analysis", 3);

    const result = await harness.cycle.runImprovementCycle({
      minUses: 3,
      limits: { maxExperiences: 10, maxExperiments: 1, maxCandidateRevisions: 1 },
    });

    const restarted = new SkillRegistry();
    registerSkill(restarted, "contract-impact-analysis", { tags: ["contract", "impact", "exported", "api"] });
    const load = skillStore.load();
    const reconciliation = restarted.loadSnapshot(load.snapshot!);

    assert.equal(result.decisions[0], "PROMOTE");
    assert.deepEqual(reconciliation.issues, []);
    assert.equal(restarted.getRecord("contract-impact-analysis", "1.1.0")?.status, "active");
    assert.equal(restarted.getRecord("contract-impact-analysis", "1.0.0")?.status, "review");
    assert.equal(restarted.get("contract-impact-analysis")?.manifest.version, "1.1.0");
    assert.equal(restarted.getVersionSupersededBy("contract-impact-analysis", "1.0.0"), "1.1.0");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("revision budget prevents recursive candidate generation in a single cycle", async () => {
  const harness = createHarness((request) => experimentFixtures(request.candidate.manifest.id, "IMPROVED"));
  registerSkill(harness.skills, "contract-a", { tags: ["contract", "impact"] });
  registerSkill(harness.skills, "contract-b", { tags: ["contract", "impact"] });
  await seedRegressions(harness, "contract-a", 3);
  await seedRegressions(harness, "contract-b", 3);

  const result = await harness.cycle.runImprovementCycle({
    minUses: 3,
    limits: { maxExperiences: 10, maxReviewItems: 5, maxExperiments: 2, maxCandidateRevisions: 1 },
  });

  assert.equal(result.experimentsCompleted.length, 1);
  assert.equal(result.checkpoint.reviewItems.filter((item) => item.decision === "PROMOTE").length, 1);
  assert.equal(result.checkpoint.reviewItems.filter((item) => item.reason.includes("revision budget")).length, 1);
});

test("failed candidate does not overwrite the active skill", async () => {
  const harness = createHarness((request) => experimentFixtures(request.candidate.manifest.id, "REGRESSED"));
  registerSkill(harness.skills, "contract-impact-analysis", { tags: ["contract", "impact"] });
  await seedRegressions(harness, "contract-impact-analysis", 3);

  const result = await harness.cycle.runImprovementCycle({ minUses: 3, limits: { maxExperiments: 1 } });

  assert.equal(result.decisions[0], "REJECT");
  assert.equal(harness.skills.getRecord("contract-impact-analysis", "1.1.0"), undefined);
  assert.equal(harness.skills.getRecord("contract-impact-analysis", "1.0.0")?.status, "review");
});

test("capability gaps collect more data when no bounded experiment is available", async () => {
  const harness = createHarness();
  await harness.store.save(experience("task_gap_1", undefined, undefined, "REGRESSED", { error: "contract-impact" }));
  await harness.store.save(experience("task_gap_2", undefined, undefined, "REGRESSED", { error: "contract-impact" }));
  await harness.store.save(experience("task_gap_3", undefined, undefined, "REGRESSED", { error: "contract-impact" }));

  const result = await harness.cycle.runImprovementCycle({
    minUses: 3,
    limits: { maxExperiences: 10, maxReviewItems: 1, maxExperiments: 1 },
  });

  assert.equal(result.reviewItemsCreated[0].kind, "capability_gap");
  assert.equal(result.decisions[0], "COLLECT_MORE_DATA");
  assert.equal(harness.skills.getAll().length, 0);
});

test("retirement requires repeated evidence and a validated replacement", async () => {
  const harness = createHarness((request) => experimentFixtures(request.candidate.manifest.id, "IMPROVED"));
  registerSkill(harness.skills, "contract-impact-analysis", { tags: ["contract", "impact", "exported", "api"] });
  await seedRegressions(harness, "contract-impact-analysis", 3);

  await harness.cycle.runImprovementCycle({
    minUses: 3,
    autoRetireReplacedSkills: true,
    limits: { maxExperiences: 10, maxExperiments: 1 },
  });

  assert.equal(harness.skills.getRecord("contract-impact-analysis", "1.0.0")?.status, "retired");
  assert.equal(harness.skills.getRecord("contract-impact-analysis", "1.1.0")?.status, "active");
  assert.equal(harness.skills.getVersionSupersededBy("contract-impact-analysis", "1.0.0"), "1.1.0");
  assert.deepEqual(harness.selector.select({ goal: "contract impact exported api review" }).selected[0], {
    skillId: "contract-impact-analysis",
    version: "1.1.0",
    source: "generated",
  });

  harness.skills.rollback("contract-impact-analysis", "1.0.0", "Manual rollback after retirement review.");
  assert.equal(harness.skills.getRecord("contract-impact-analysis", "1.0.0")?.status, "active");
});

test("regressed newer version can roll back to its parent without deleting history", async () => {
  const harness = createHarness();
  registerSkill(harness.skills, "contract-impact-analysis", { tags: ["contract", "impact"] });
  harness.skills.register({
    manifest: {
      ...harness.skills.get("contract-impact-analysis", "1.0.0")!.manifest,
      version: "1.1.0",
      entry: "skills/contract-impact-analysis-1.1.0.js",
    },
    execute: async () => ({ ok: true, durationMs: 0 }),
  }, "generated", "active", { parentVersion: "1.0.0", setDefault: true });
  const contextKey = createSkillFitnessContext("contract impact exported api review").contextKey;
  for (let index = 0; index < 3; index++) {
    await harness.store.save(experience(`task_v2_regression_${index}`, "contract-impact-analysis", "1.1.0", "REGRESSED", { contextKey }));
  }

  const result = await harness.cycle.runImprovementCycle({
    minUses: 3,
    rollbackToParentOnRegression: true,
    limits: { maxExperiences: 10, maxExperiments: 0 },
  });

  assert.equal(result.decisions.length, 0);
  assert.equal(result.reviewItemsCreated[0].decision, "REVISE");
  assert.equal(harness.skills.get("contract-impact-analysis")?.manifest.version, "1.0.0");
  assert.equal(harness.skills.getRecord("contract-impact-analysis", "1.0.0")?.status, "active");
  assert.equal(harness.skills.getRecord("contract-impact-analysis", "1.1.0")?.status, "review");
  assert.equal(harness.skills.getVersions("contract-impact-analysis").length, 2);
});

test("unsafe skill manifests are quarantined, poor performance alone is only review", async () => {
  const harness = createHarness();
  registerSkill(harness.skills, "unsafe-imported", {
    tags: ["contract"],
    requiresPermissions: ["secrets.read"],
    requiresTools: [],
  });
  registerSkill(harness.skills, "poor-performer", { tags: ["contract", "impact"] });
  await seedRegressions(harness, "poor-performer", 3);

  const result = await harness.cycle.runImprovementCycle({ minUses: 3, limits: { maxExperiences: 10, maxExperiments: 0 } });

  assert.equal(harness.skills.getRecord("unsafe-imported")?.status, "quarantined");
  assert.equal(harness.skills.getRecord("poor-performer")?.status, "review");
  assert.equal(result.checkpoint.reviewItems.some((item) => item.decision === "QUARANTINE"), true);
});

test("candidate cannot win by mutating objective/evaluator policy", async () => {
  const harness = createHarness((request) => ({
    baseline: experimentFixtures(request.candidate.manifest.id, "IMPROVED").baseline,
    control: experimentFixtures(request.candidate.manifest.id, "REGRESSED").control,
    candidateExperience: {
      ...experimentFixtures(request.candidate.manifest.id, "IMPROVED").candidateExperience,
      objective: {
        ...request.objective,
        id: "mutated.objective",
      },
    },
  }));
  registerSkill(harness.skills, "contract-impact-analysis", { tags: ["contract", "impact"] });
  await seedRegressions(harness, "contract-impact-analysis", 3);

  const result = await harness.cycle.runImprovementCycle({ minUses: 3, limits: { maxExperiments: 1 } });

  assert.equal(result.decisions[0], "REQUIRE_HUMAN_REVIEW");
  assert.equal(harness.skills.getRecord("contract-impact-analysis", "1.1.0"), undefined);
});

test("persisted checkpoint survives restart without duplicating processed work", async () => {
  const stateDir = join(tmpdir(), createId("quack_improvement_state"));
  const statePath = join(stateDir, "cycle.json");
  const store = new InMemoryEvidenceExperienceStore();
  await mkdir(stateDir, { recursive: true });
  try {
    const first = createHarness(undefined, store, new JsonFileImprovementCycleStateStore(statePath));
    registerSkill(first.skills, "contract-impact-analysis", { tags: ["contract", "impact"] });
    await seedRegressions(first, "contract-impact-analysis", 3);
    const firstRun = await first.cycle.runImprovementCycle({ minUses: 3, limits: { maxExperiments: 0 } });

    const second = createHarness(undefined, store, new JsonFileImprovementCycleStateStore(statePath));
    registerSkill(second.skills, "contract-impact-analysis", { tags: ["contract", "impact"] });
    const secondRun = await second.cycle.runImprovementCycle({ minUses: 3, limits: { maxExperiments: 0 } });

    assert.equal(firstRun.processedExperienceIds.length, 3);
    assert.equal(secondRun.processedExperienceIds.length, 0);
    assert.equal(secondRun.reviewItemsCreated.length, 0);
    assert.equal(secondRun.checkpoint.reviewItems.length, 1);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("production integration runs persisted evidence through cycle into future skill selection", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_improvement_workspace"));
  const dataDir = join(tmpdir(), createId("quack_improvement_data"));
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, "index.ts"), "export const value = 1;\n", "utf8");

  try {
    const system = createQuackSystem({ workspaceRoot, dataDir, permissions: ["workspace.read"] });
    registerSkill(system.skills, "contract-impact-analysis", { tags: ["contract", "impact", "exported", "api"] });
    const contextKey = createSkillFitnessContext("contract impact exported api review").contextKey;
    for (let index = 0; index < 3; index++) {
      await system.learningExperiences.save(experience(`task_prod_${index}`, "contract-impact-analysis", "1.0.0", "REGRESSED", { contextKey }));
    }

    const result = await system.improvementCycle.runImprovementCycle({
      minUses: 3,
      autoRetireReplacedSkills: true,
      limits: { maxExperiences: 10, maxExperiments: 1 },
      fixtures: (request) => experimentFixtures(request.candidate.manifest.id, "IMPROVED"),
    });

    assert.equal(result.decisions[0], "PROMOTE");
    assert.equal(system.skills.getRecord("contract-impact-analysis", "1.0.0")?.status, "retired");
    assert.deepEqual(system.contextualSkillSelector.select({ goal: "contract impact exported api review" }).selected[0], {
      skillId: "contract-impact-analysis",
      version: "1.1.0",
      source: "generated",
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});

function createHarness(
  fixtures?: SkillExperimentFixtureProvider,
  store = new InMemoryEvidenceExperienceStore(),
  state: ImprovementCycleStateStore = new InMemoryImprovementCycleStateStore(),
  skillStore?: SkillRegistryStore,
) {
  const tools = new ToolRegistry();
  tools.register(new EchoTool());
  tools.register(new WorkspaceListFilesTool({ workspaceRoot: process.cwd() }));
  tools.register(new TerminalTool({ workspaceRoot: process.cwd() }));
  const skills = new SkillRegistry(skillStore ? { store: skillStore } : {});
  const fitness = new SkillFitnessIndex();
  const adaptive = createAdaptiveLayer();
  const objectives = new ObjectiveRegistry();
  const skillEvolution = new EvidenceDrivenSkillEvolution({
    experiences: store,
    skills,
    tools,
    adaptiveLayer: adaptive,
    evaluator: new DeterministicObjectiveEvaluator(),
    allowedPermissions: ["workspace.read"],
  });
  return {
    store,
    tools,
    skills,
    fitness,
    adaptive,
    objectives,
    skillEvolution,
    selector: new ContextualSkillSelector({ skills, tools, fitness, allowedPermissions: ["workspace.read"] }),
    cycle: new EvidenceImprovementCycle({
      experiences: store,
      fitness,
      skillEvolution,
      skills,
      tools,
      adaptiveLayer: adaptive,
      objectives,
      state,
      fixtures,
    }),
  };
}

async function seedRegressions(harness: ReturnType<typeof createHarness>, skillId: string, count: number): Promise<void> {
  const contextKey = createSkillFitnessContext("contract impact exported api review").contextKey;
  for (let index = 0; index < count; index++) {
    await harness.store.save(experience(`task_${skillId}_${index}`, skillId, "1.0.0", "REGRESSED", { contextKey }));
  }
}

function registerSkill(
  registry: SkillRegistry,
  id: string,
  options: {
    readonly tags?: readonly string[];
    readonly requiresPermissions?: readonly Permission[];
    readonly requiresTools?: readonly string[];
  },
  status: SkillStatus = "active",
): void {
  const definition: SkillDefinition = {
    manifest: {
      id,
      name: id.replaceAll("-", " "),
      version: "1.0.0",
      description: `${id} supports contract impact exported api review.`,
      author: "test",
      category: "analysis",
      tags: options.tags ?? [],
      requiresPermissions: options.requiresPermissions ?? ["workspace.read"],
      requiresTools: options.requiresTools ?? ["core.workspace.list-files"],
      entry: `skills/${id}.js`,
    },
    execute: async () => ({ ok: true, data: { id }, durationMs: 1 }),
  };
  registry.register(definition, "generated", status);
}

function experimentFixtures(candidateSkillId: string, candidateStatus: ObjectiveEvaluationStatus) {
  return {
    baseline: experience("baseline", undefined, undefined, "UNCHANGED"),
    control: experience("control", undefined, undefined, "REGRESSED", { variantRole: "control" }),
    candidateExperience: experience("candidate", candidateSkillId, "1.1.0", candidateStatus, { variantRole: "candidate" }),
  };
}

function experience(
  runId: string,
  skillId: string | undefined,
  version: string | undefined,
  status: ObjectiveEvaluationStatus,
  options: {
    readonly contextKey?: string;
    readonly variantRole?: ExecutionVariantRole;
    readonly error?: string;
  } = {},
): EvidenceBackedExperience {
  const objective = new ObjectiveRegistry().get(DEFAULT_NO_REGRESSION_OBJECTIVE_ID)!;
  const observations = observationsFor(runId, failedStepsFor(status), objective);
  const selectedSkills = skillId ? [{ skillId, version, source: "generated" }] : [];
  const execution = {
    runtimeId: "test-runtime",
    contextKey: options.contextKey,
    contextTags: ["contract", "impact"],
    selectedSkills,
    variant: options.variantRole ? { id: `variant-${options.variantRole}`, role: options.variantRole } : undefined,
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
    outcomes: [
      "task.status:completed",
      ...(options.error ? [`task.error:${options.error}`] : []),
    ],
    metricObservations: evaluation.observations,
    evaluation,
    evidence: evaluation.evidence,
    resultStatus: status === "REGRESSED" ? "failed" : "completed",
    traceRefs: [`task-${runId}`],
    createdAt: `2026-08-05T00:00:${runId.length.toString().padStart(2, "0")}.000Z`,
  };
}

function failedStepsFor(status: ObjectiveEvaluationStatus): number {
  if (status === "IMPROVED") return 0;
  if (status === "REGRESSED") return 3;
  return 1;
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
