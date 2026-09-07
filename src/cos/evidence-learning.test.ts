import { createValidatedListingRuntime } from "../test-support/validated-listing-runtime.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId } from "../core/types.js";
import { createQuackSystem } from "../distributions/swe-system.js";
import { DeterministicObjectiveEvaluator } from "./deterministic-evaluator.js";
import { InMemoryEvidenceExperienceStore, JsonFileEvidenceExperienceStore } from "./evidence-experience-store.js";
import { DEFAULT_NO_REGRESSION_OBJECTIVE_ID, ObjectiveRegistry } from "./objectives.js";
import { RuntimeLearningRecorder, observeRuntimeTask } from "./runtime-learning.js";
import { MissionManager } from "./mission-manager.js";
import {
  type EvidenceBackedExperience,
  type MetricObservation,
  type ObjectiveSpecification,
} from "./types.js";

test("objective registry exposes immutable objective specs with multiple metrics", () => {
  const registry = new ObjectiveRegistry();
  const objective = registry.get(DEFAULT_NO_REGRESSION_OBJECTIVE_ID);

  assert.ok(objective);
  assert.equal(objective.metrics.length, 2);
  assert.equal(objective.metrics[0].direction, "target");
  assert.equal(objective.metrics[1].direction, "minimize");

  (objective.metrics as unknown as Array<typeof objective.metrics[number]>)[0] = { ...objective.metrics[0], threshold: false };
  assert.equal(registry.get(DEFAULT_NO_REGRESSION_OBJECTIVE_ID)?.metrics[0].threshold, true);
  assert.throws(() => registry.register(objective), /already registered/);
});

test("deterministic evaluator handles improved, regressed, and unchanged outcomes", () => {
  const objective = testObjective();
  const evaluator = new DeterministicObjectiveEvaluator();

  assert.equal(evaluator.evaluate({
    objective,
    runId: "current",
    observations: [observation("score", "current", 2)],
    baselineRunId: "baseline",
    baselineObservations: [observation("score", "baseline", 1)],
  }).status, "IMPROVED");

  assert.equal(evaluator.evaluate({
    objective,
    runId: "current",
    observations: [observation("score", "current", 0)],
    baselineRunId: "baseline",
    baselineObservations: [observation("score", "baseline", 1)],
  }).status, "REGRESSED");

  assert.equal(evaluator.evaluate({
    objective,
    runId: "current",
    observations: [observation("score", "current", 1)],
    baselineRunId: "baseline",
    baselineObservations: [observation("score", "baseline", 1)],
  }).status, "UNCHANGED");
});

test("deterministic evaluator returns insufficient evidence without a comparable baseline", () => {
  const evaluation = new DeterministicObjectiveEvaluator().evaluate({
    objective: testObjective(),
    runId: "current",
    observations: [observation("score", "current", 2)],
  });

  assert.equal(evaluation.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(evaluation.evidence[0].conclusion, "INSUFFICIENT_EVIDENCE");
});

test("deterministic evaluator returns inconclusive for invalid, missing, or incompatible observations", () => {
  const objective = testObjective();
  const evaluator = new DeterministicObjectiveEvaluator();

  assert.equal(evaluator.evaluate({
    objective,
    runId: "invalid",
    observations: [{ ...observation("score", "invalid", 2), valid: false, error: "invalid measurement" }],
    baselineRunId: "baseline",
    baselineObservations: [observation("score", "baseline", 1)],
  }).status, "INCONCLUSIVE");

  assert.equal(evaluator.evaluate({
    objective,
    runId: "missing",
    observations: [],
    baselineRunId: "baseline",
    baselineObservations: [observation("score", "baseline", 1)],
  }).status, "INCONCLUSIVE");

  assert.equal(evaluator.evaluate({
    objective,
    runId: "bad-baseline",
    observations: [observation("score", "bad-baseline", 2)],
    baselineRunId: "baseline",
    baselineObservations: [observation("score", "baseline", "not-a-number")],
  }).status, "INCONCLUSIVE");
});

test("evidence experience store persists cloned machine-readable evidence", async () => {
  const dataDir = join(tmpdir(), createId("quack_evidence_store"));
  const filePath = join(dataDir, "experiences.json");
  const store = new JsonFileEvidenceExperienceStore(filePath);
  const experience = sampleExperience("run-1", "task-1");

  try {
    const saved = await store.save(experience);
    (saved.metricObservations as MetricObservation[])[0] = { ...saved.metricObservations[0], value: false };

    const reloaded = new JsonFileEvidenceExperienceStore(filePath);
    const records = await reloaded.list({ objectiveId: DEFAULT_NO_REGRESSION_OBJECTIVE_ID });
    assert.equal(records.length, 1);
    assert.equal(records[0].metricObservations[0].value, true);
    assert.equal(records[0].evidence[0].runId, "run-1");
    assert.equal((records[0].evidence[0].observedValue), true);
    assert.equal(records[0].execution.workflowId, "workflow-run-1");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("evidence experience store filters execution attribution references", async () => {
  const store = new InMemoryEvidenceExperienceStore();
  await store.save({
    ...sampleExperience("run-control", "task-control"),
    strategyId: "strategy.repo",
    execution: {
      strategyId: "strategy.repo",
      workflowId: "workflow-control",
      runtimeId: "core.quack-runtime",
      selectedSkills: [{ skillId: "skill.repo-audit", version: "1.2.3", source: "builtin" }],
      variant: { id: "variant-control", role: "control" },
    },
  });

  assert.equal((await store.list({ strategyId: "strategy.repo" })).length, 1);
  assert.equal((await store.list({ workflowId: "workflow-control" })).length, 1);
  assert.equal((await store.list({ skillId: "skill.repo-audit" })).length, 1);
  assert.equal((await store.list({ skillVersion: "1.2.3" })).length, 1);
  assert.equal((await store.list({ variantId: "variant-control" })).length, 1);
  assert.equal((await store.list({ skillId: "skill.missing" })).length, 0);
});

test("runtime learning recorder links completed tasks to missions and baseline comparison", async () => {
  const objectives = new ObjectiveRegistry();
  const evaluator = new DeterministicObjectiveEvaluator();
  const experiences = new InMemoryEvidenceExperienceStore();
  const missionManager = new MissionManager();
  const recorder = new RuntimeLearningRecorder({ objectives, evaluator, experiences, missionManager });
  const objective = objectives.get(DEFAULT_NO_REGRESSION_OBJECTIVE_ID)!;

  await experiences.save({
    ...sampleExperience("baseline", "task-baseline"),
    objective,
    metricObservations: [
      observation("runtime.task.completed", "baseline", false, objective.id),
      observation("runtime.failed_steps", "baseline", 2, objective.id),
    ],
  });

  const recorded = await recorder.recordTaskCompletion({
    id: "task-current",
    goal: "complete task without regression",
    status: "completed",
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:01.000Z",
    plan: [{ id: "step-1", title: "Run bounded task", status: "completed" }],
    result: {
      failedSteps: 0,
      strategyId: "strategy.no-regression",
      workflowId: "workflow-current",
      selectedSkills: [{ skillId: "skill.repo-audit", version: "1.2.3", source: "builtin" }],
      executionVariant: { id: "variant-control", role: "control" },
    },
  }, { actor: "test" });

  assert.ok(recorded);
  assert.equal(recorded.evaluation.status, "IMPROVED");
  assert.ok(recorded.missionId);
  assert.equal(missionManager.get(recorded.missionId!)?.status, "completed");
  assert.equal(recorded.strategyId, "strategy.no-regression");
  assert.equal(recorded.execution.workflowId, "workflow-current");
  assert.deepEqual(recorded.execution.selectedSkills, [{ skillId: "skill.repo-audit", version: "1.2.3", source: "builtin" }]);
  assert.equal(recorded.execution.variant?.role, "control");
  assert.equal(recorded.evidence[0].execution?.workflowId, "workflow-current");
});

test("validated runtime fixture records persisted evidence without bypassing tool security", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_learning_workspace"));
  const dataDir = join(tmpdir(), createId("quack_learning_state"));
  const previousNvidiaKey = process.env["NVIDIA_API_KEY"];
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, "hello.txt"), "learning evidence\n", "utf8");

  try {
    delete process.env["NVIDIA_API_KEY"];
    const system = createQuackSystem({
      workspaceRoot,
      dataDir,
      permissions: ["workspace.read"],
    });

    const runtime = createValidatedListingRuntime(system, "hello.txt");
    const task = await runtime.submitGoal("list workspace files", "test");
    assert.equal(task.ok, true);
    if (!task.ok) return;

    const experiences = await system.learningExperiences.list({ taskId: task.data.id });
    assert.equal(experiences.length, 1);
    assert.equal(experiences[0].evaluation.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(experiences[0].metricObservations.some((metric) => metric.metricId === "runtime.task.completed" && metric.value === true), true);
    assert.equal(experiences[0].evidence[0].objectiveId, DEFAULT_NO_REGRESSION_OBJECTIVE_ID);
    assert.equal(system.cognitiveSystem.missionManager.get(experiences[0].missionId!)?.status, "completed");
    assert.equal(typeof experiences[0].execution.runtimeId, "string");
    assert.equal(experiences[0].execution.workflowId !== undefined, true);

    const denied = await runtime.executeTool(
      "core.workspace.read-file",
      { path: "..\\outside.txt" },
      { taskId: task.data.id, actor: "test" },
    );
    assert.equal(denied.ok, false);
    if (!denied.ok) {
      assert.equal(denied.error.category, "permission");
      assert.equal(denied.error.code, "tool.permission_denied");
    }
  } finally {
    if (previousNvidiaKey === undefined) {
      delete process.env["NVIDIA_API_KEY"];
    } else {
      process.env["NVIDIA_API_KEY"] = previousNvidiaKey;
    }
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});

function testObjective(): ObjectiveSpecification {
  return {
    id: "test.objective",
    name: "Increase deterministic score",
    description: "Test objective",
    metrics: [{
      id: "score",
      description: "Score",
      direction: "maximize",
      measurementSource: "test.score",
    }],
    constraints: [],
    evaluationPolicy: {
      evaluatorId: "core.deterministic-objective-evaluator",
      minEvidenceCount: 1,
      requireBaseline: true,
    },
  };
}

function observation(
  metricId: string,
  runId: string,
  value: number | boolean | string,
  objectiveId = "test.objective",
): MetricObservation {
  return {
    id: createId("obs"),
    objectiveId,
    metricId,
    runId,
    source: "test",
    value,
    valid: true,
    observedAt: "2026-08-05T00:00:00.000Z",
    sequence: 0,
  };
}

function sampleExperience(runId: string, taskId: string): EvidenceBackedExperience {
  const objective = new ObjectiveRegistry().get(DEFAULT_NO_REGRESSION_OBJECTIVE_ID)!;
  const observations = observeRuntimeTask({
    id: taskId,
    goal: "sample",
    status: "completed",
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:01.000Z",
    plan: [],
    result: { failedSteps: 0 },
  }, objective);
  const evaluation = new DeterministicObjectiveEvaluator().evaluate({
    objective,
    runId,
    observations,
    baselineRunId: "baseline",
    baselineObservations: [
      observation("runtime.task.completed", "baseline", true, objective.id),
      observation("runtime.failed_steps", "baseline", 0, objective.id),
    ],
  });

  return {
    id: createId("evexp"),
    objective,
    strategyId: `strategy-${runId}`,
    execution: {
      strategyId: `strategy-${runId}`,
      workflowId: `workflow-${runId}`,
      runtimeId: "core.quack-runtime",
      selectedSkills: [],
      variant: { id: `variant-${runId}`, role: "production" },
    },
    runId,
    taskId,
    actions: ["sample action"],
    outcomes: ["task.status:completed"],
    metricObservations: observations,
    evaluation,
    evidence: evaluation.evidence,
    resultStatus: "completed",
    traceRefs: [taskId],
    createdAt: "2026-08-05T00:00:02.000Z",
  };
}
