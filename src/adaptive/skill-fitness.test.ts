import { createValidatedListingRuntime } from "../test-support/validated-listing-runtime.js";
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
import { type SkillDefinition, type SkillLoadSource, type SkillStatus } from "../skills/types.js";
import { SkillRegistry } from "../skills/registry.js";
import { EchoTool, ToolRegistry } from "../tools/tool.js";
import { WorkspaceListFilesTool } from "../tools/workspace-filesystem.js";
import { TerminalTool } from "../tools/terminal.js";
import { createAdaptiveLayer } from "./adaptive-layer.js";
import {
  ContextualSkillSelector,
  SkillFitnessIndex,
  SkillFitnessReviewLoop,
  createSkillFitnessContext,
} from "./skill-fitness.js";

test("skill fitness derives contextual, versioned records from attributed experiences only", async () => {
  const index = new SkillFitnessIndex();
  const contractContext = createSkillFitnessContext("contract impact exported api review").contextKey;
  const docsContext = createSkillFitnessContext("documentation rewrite").contextKey;

  const result = await index.updateFromExperiences([
    experience("task_contract_1", "contract-impact", "1.0.0", "IMPROVED", { contextKey: contractContext }),
    experience("task_contract_2", "contract-impact", "1.0.0", "REGRESSED", { contextKey: contractContext }),
    experience("task_contract_3", "contract-impact", "2.0.0", "IMPROVED", { contextKey: contractContext }),
    experience("task_docs_1", "contract-impact", "1.0.0", "UNCHANGED", { contextKey: docsContext }),
    experience("task_unattributed", undefined, undefined, "IMPROVED", { contextKey: contractContext }),
  ]);

  assert.equal(result.skippedExperienceIds.length, 1);
  const v1Contract = index.get("contract-impact", "1.0.0", contractContext);
  const v2Contract = index.get("contract-impact", "2.0.0", contractContext);
  const v1Docs = index.get("contract-impact", "1.0.0", docsContext);
  assert.ok(v1Contract);
  assert.ok(v2Contract);
  assert.ok(v1Docs);
  assert.equal(v1Contract.uses, 2);
  assert.equal(v1Contract.improved, 1);
  assert.equal(v1Contract.regressed, 1);
  assert.equal(v2Contract.uses, 1);
  assert.equal(v1Docs.unchanged, 1);
  assert.equal(index.list().length, 3);
});

test("fitness evidence strength ranks controlled experiments above production and passive observations", async () => {
  const index = new SkillFitnessIndex();
  const contextKey = createSkillFitnessContext("contract impact").contextKey;

  await index.updateFromExperiences([
    experience("task_prod", "contract-impact", "1.0.0", "IMPROVED", { contextKey }),
    experience("manual-passive", "contract-impact", "1.0.0", "IMPROVED", { contextKey }),
    experience("experiment-candidate", "contract-impact", "1.0.0", "IMPROVED", { contextKey, variantRole: "candidate" }),
  ]);

  const fitness = index.get("contract-impact", "1.0.0", contextKey);
  assert.ok(fitness);
  assert.equal(fitness.strengths.controlled_experiment, 1);
  assert.equal(fitness.strengths.production_outcome, 1);
  assert.equal(fitness.strengths.passive_correlation, 1);
  assert.equal(fitness.confidence > 0.75, true);
});

test("selector prefers evidence-backed fit but filters lifecycle, permissions, tools, and dependencies", async () => {
  const harness = createHarness(["workspace.read"]);
  const goal = "inspect workspace files for contract impact exported api review";
  const contextKey = createSkillFitnessContext(goal).contextKey;
  registerSkill(harness.skills, "dependency-helper", { tags: ["contract", "impact"] });
  registerSkill(harness.skills, "contract-slow", { tags: ["contract", "impact"] });
  registerSkill(harness.skills, "contract-better", { tags: ["contract", "impact"] });
  registerSkill(harness.skills, "contract-retired", { tags: ["contract", "impact"] }, "generated", "retired");
  registerSkill(harness.skills, "contract-terminal", {
    tags: ["contract", "impact"],
    requiresPermissions: ["terminal.execute"],
    requiresTools: ["core.terminal.execute"],
  });
  registerSkill(harness.skills, "contract-missing-tool", {
    tags: ["contract", "impact"],
    requiresTools: ["missing.tool"],
  });
  registerSkill(harness.skills, "contract-missing-dependency", {
    tags: ["contract", "impact"],
    dependencies: ["not-registered"],
  });

  await harness.fitness.updateFromExperiences([
    experience("task_a_1", "contract-slow", "1.0.0", "REGRESSED", { contextKey }),
    experience("task_a_2", "contract-slow", "1.0.0", "REGRESSED", { contextKey }),
    experience("task_b_1", "contract-better", "1.0.0", "IMPROVED", { contextKey }),
    experience("task_b_2", "contract-better", "1.0.0", "IMPROVED", { contextKey }),
    experience("task_retired", "contract-retired", "1.0.0", "IMPROVED", { contextKey }),
    experience("task_terminal", "contract-terminal", "1.0.0", "IMPROVED", { contextKey }),
  ]);

  const decision = harness.selector.select({ goal });
  assert.deepEqual(decision.selected.map((skill) => skill.skillId), ["contract-better"]);
  assert.equal(decision.alternatives.some((candidate) => candidate.skillId === "contract-retired"), false);
  assert.equal(decision.alternatives.some((candidate) => candidate.skillId === "contract-terminal"), false);
  assert.equal(decision.alternatives.some((candidate) => candidate.skillId === "contract-missing-tool"), false);
  assert.equal(decision.alternatives.some((candidate) => candidate.skillId === "contract-missing-dependency"), false);
});

test("selector is deterministic for equal active candidates and returns no skill for unrelated goals", () => {
  const harness = createHarness(["workspace.read"]);
  registerSkill(harness.skills, "z-contract", { tags: ["contract", "impact"] });
  registerSkill(harness.skills, "a-contract", { tags: ["contract", "impact"] });

  const decision = harness.selector.select({ goal: "contract impact review" });
  assert.deepEqual(decision.selected.map((skill) => skill.skillId), ["a-contract"]);

  const unrelated = harness.selector.select({ goal: "prepare music theory notes" });
  assert.equal(unrelated.selected.length, 0);
});

test("review policy requires repeated regressions and only proposes bounded reviews", async () => {
  const harness = createHarness(["workspace.read"]);
  const store = new InMemoryEvidenceExperienceStore();
  const reviewLoop = new SkillFitnessReviewLoop({
    experiences: store,
    fitness: harness.fitness,
    skills: harness.skills,
    adaptiveLayer: harness.adaptive,
  });
  registerSkill(harness.skills, "contract-fragile", { tags: ["contract", "impact"] });
  const contextKey = createSkillFitnessContext("contract impact review").contextKey;

  await store.save(experience("task_once", "contract-fragile", "1.0.0", "REGRESSED", { contextKey }));
  await harness.fitness.rebuildFromExperiences(await store.list());
  assert.equal(harness.fitness.review({ minUses: 3 }).find((review) => review.skillId === "contract-fragile")?.decision, "INSUFFICIENT_EVIDENCE");

  await store.save(experience("task_twice", "contract-fragile", "1.0.0", "REGRESSED", { contextKey }));
  await store.save(experience("task_thrice", "contract-fragile", "1.0.0", "REGRESSED", { contextKey }));
  const firstRun = await reviewLoop.runReview({ minUses: 3, regressionThreshold: 0.5 });
  const secondRun = await reviewLoop.runReview({ minUses: 3, regressionThreshold: 0.5 });

  assert.equal(firstRun.proposals.length, 1);
  assert.equal(firstRun.proposals[0].type, "skill");
  assert.equal(secondRun.proposals.length, 0);
  assert.equal(harness.skills.getRecord("contract-fragile")?.status, "review");
  assert.equal(harness.adaptive.improvementScheduler.getProposals("proposed").length, 1);
});

test("retirement is reversible metadata, preserves replacement history, and excludes retired skills", () => {
  const harness = createHarness(["workspace.read"]);
  registerSkill(harness.skills, "contract-old", { tags: ["contract", "impact"] });
  registerSkill(harness.skills, "contract-new", { tags: ["contract", "impact"] });

  harness.skills.retire("contract-old", "Repeated contextual regressions.", {
    evidenceRefs: ["evidence-1", "evidence-2"],
    replacementSkillId: "contract-new",
  });

  assert.equal(harness.skills.getRecord("contract-old")?.status, "retired");
  assert.equal(harness.skills.getSupersededBy("contract-old"), "contract-new");
  assert.equal(harness.skills.getLifecycleHistory("contract-old")[0].replacementSkillId, "contract-new");
  assert.deepEqual(harness.selector.select({ goal: "contract impact review" }).selected.map((skill) => skill.skillId), ["contract-new"]);

  harness.skills.transition("contract-old", "active", "Manual rollback after review.");
  assert.equal(harness.skills.getRecord("contract-old")?.status, "active");
});

test("stale evidence is marked stale but does not delete or retire a skill", () => {
  const harness = createHarness(["workspace.read"]);
  registerSkill(harness.skills, "old-contract", { tags: ["contract", "impact"] });
  const contextKey = createSkillFitnessContext("contract impact review").contextKey;

  harness.fitness.updateFromExperience(experience("task_old", "old-contract", "1.0.0", "REGRESSED", {
    contextKey,
    createdAt: "2020-01-01T00:00:00.000Z",
  }));

  const fitness = harness.fitness.get("old-contract", "1.0.0", contextKey);
  assert.ok(fitness);
  assert.equal(fitness.stale, true);
  assert.equal(harness.skills.getRecord("old-contract")?.status, "active");
});

test("runtime fixture records skill provenance and updates fitness after validated tool execution", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_skill_fitness_workspace"));
  const dataDir = join(tmpdir(), createId("quack_skill_fitness_state"));
  const previousOpenAiKey = process.env["QUACK_OPENAI_API_KEY"];
  const previousNvidiaKey = process.env["NVIDIA_API_KEY"];
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, "index.ts"), "export const quack = true;\n", "utf8");

  try {
    delete process.env["QUACK_OPENAI_API_KEY"];
    delete process.env["NVIDIA_API_KEY"];
    const system = createQuackSystem({ workspaceRoot, dataDir, permissions: ["workspace.read"] });
    const goal = "inspect workspace files for contract impact exported api review";
    const contextKey = createSkillFitnessContext(goal).contextKey;
    registerSkill(system.skills, "contract-slow", { tags: ["contract", "impact", "exported", "api"], requiresTools: ["core.workspace.list-files"] });
    registerSkill(system.skills, "contract-better", { tags: ["contract", "impact", "exported", "api"], requiresTools: ["core.workspace.list-files"] });
    await system.skillFitness.updateFromExperiences([
      experience("task_prod_bad", "contract-slow", "1.0.0", "REGRESSED", { contextKey }),
      experience("task_prod_good", "contract-better", "1.0.0", "IMPROVED", { contextKey }),
      experience("task_prod_good_2", "contract-better", "1.0.0", "IMPROVED", { contextKey }),
    ]);

    const runtime = createValidatedListingRuntime(system, "index.ts");
    const task = await runtime.submitGoal(goal, "test");
    assert.equal(task.ok, true);
    if (!task.ok) return;

    const selectedSkills = task.data.result?.selectedSkills as Array<{ readonly skillId: string; readonly version: string; readonly source: string }>;
    assert.deepEqual(selectedSkills.map((skill) => skill.skillId), ["contract-better"]);
    assert.equal(task.data.result?.contextKey, contextKey);

    const experiences = await system.learningExperiences.list({ taskId: task.data.id });
    assert.equal(experiences.length, 1);
    assert.deepEqual(experiences[0].execution.selectedSkills.map((skill) => skill.skillId), ["contract-better"]);
    assert.equal(experiences[0].execution.contextKey, contextKey);
    assert.equal(system.skillFitness.get("contract-better", "1.0.0", contextKey)?.uses, 3);
  } finally {
    if (previousOpenAiKey === undefined) delete process.env["QUACK_OPENAI_API_KEY"];
    else process.env["QUACK_OPENAI_API_KEY"] = previousOpenAiKey;
    if (previousNvidiaKey === undefined) delete process.env["NVIDIA_API_KEY"];
    else process.env["NVIDIA_API_KEY"] = previousNvidiaKey;
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});

function createHarness(allowedPermissions: readonly Permission[]) {
  const tools = new ToolRegistry();
  tools.register(new EchoTool());
  tools.register(new WorkspaceListFilesTool({ workspaceRoot: process.cwd() }));
  tools.register(new TerminalTool({ workspaceRoot: process.cwd() }));
  const skills = new SkillRegistry();
  const fitness = new SkillFitnessIndex();
  const adaptive = createAdaptiveLayer();
  return {
    tools,
    skills,
    fitness,
    adaptive,
    selector: new ContextualSkillSelector({
      skills,
      tools,
      fitness,
      allowedPermissions,
      maxSelected: 1,
      shortlistSize: 5,
    }),
  };
}

function registerSkill(
  registry: SkillRegistry,
  id: string,
  options: {
    readonly tags?: readonly string[];
    readonly requiresPermissions?: readonly Permission[];
    readonly requiresTools?: readonly string[];
    readonly dependencies?: readonly string[];
  } = {},
  source: SkillLoadSource = "generated",
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
      dependencies: options.dependencies ?? [],
      entry: `skills/${id}.js`,
    },
    execute: async () => ({ ok: true, data: { id }, durationMs: 1 }),
  };
  registry.register(definition, source, status);
}

function experience(
  runId: string,
  skillId: string | undefined,
  version: string | undefined,
  status: ObjectiveEvaluationStatus,
  options: {
    readonly contextKey?: string;
    readonly contextTags?: readonly string[];
    readonly variantRole?: ExecutionVariantRole;
    readonly createdAt?: string;
  } = {},
): EvidenceBackedExperience {
  const objective = new ObjectiveRegistry().get(DEFAULT_NO_REGRESSION_OBJECTIVE_ID)!;
  const failedSteps = failedStepsFor(status);
  const observations = observationsFor(runId, status === "REGRESSED" ? "completed" : "completed", failedSteps, objective);
  const selectedSkills = skillId ? [{ skillId, version, source: "generated" }] : [];
  const execution = {
    runtimeId: "test-runtime",
    contextKey: options.contextKey,
    contextTags: options.contextTags ?? [],
    selectedSkills,
    variant: options.variantRole ? { id: `variant-${options.variantRole}`, role: options.variantRole } : undefined,
  };
  const evaluation = new DeterministicObjectiveEvaluator().evaluate({
    objective,
    runId,
    observations: status === "INCONCLUSIVE" ? [{ ...observations[0], valid: false, value: undefined, error: "invalid" }, observations[1]] : observations,
    baselineRunId: status === "INSUFFICIENT_EVIDENCE" ? undefined : "baseline",
    baselineObservations: status === "INSUFFICIENT_EVIDENCE" ? undefined : observationsFor("baseline", "completed", 1, objective),
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
    createdAt: options.createdAt ?? "2026-08-05T00:00:00.000Z",
  };
}

function failedStepsFor(status: ObjectiveEvaluationStatus): number {
  if (status === "IMPROVED") return 0;
  if (status === "REGRESSED") return 3;
  return 1;
}

function observationsFor(
  runId: string,
  taskStatus: "completed",
  failedSteps: number,
  objective: ObjectiveSpecification,
): MetricObservation[] {
  return [
    {
      id: `obs-completed-${runId}`,
      objectiveId: objective.id,
      metricId: "runtime.task.completed",
      runId,
      source: "test",
      value: taskStatus === "completed",
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
