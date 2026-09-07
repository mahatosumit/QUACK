import { createId, now, type JsonObject, type JsonValue } from "../core/types.js";
import { type Task } from "../runtime/task.js";
import { DeterministicObjectiveEvaluator } from "./deterministic-evaluator.js";
import { type EvidenceExperienceStore } from "./evidence-experience-store.js";
import { DEFAULT_NO_REGRESSION_OBJECTIVE_ID, ObjectiveRegistry, cloneObjective } from "./objectives.js";
import { type MissionManager } from "./mission-manager.js";
import {
  type EvidenceBackedExperience,
  type ExecutionProvenance,
  type ExecutionVariant,
  type ExecutionVariantRole,
  type MetricObservation,
  type MetricValue,
  type ObjectiveSpecification,
  type SkillAttribution,
} from "./types.js";

export interface RuntimeLearningSink {
  recordTaskCompletion(task: Task, options?: { readonly actor?: string; readonly execution?: ExecutionProvenance }): Promise<EvidenceBackedExperience | undefined>;
}

/** Additional experience store for learning module (ExperienceRecord format) */
export interface LearningExperienceStore {
  recordExperience(experience: Omit<import("../learning/types.js").ExperienceRecord, "experienceId" | "timestamp">): Promise<string>;
  findSimilarExperiences(query: import("../learning/types.js").SimilarExperienceQuery): Promise<import("../learning/types.js").ExperienceRecord[]>;
}

export class RuntimeLearningRecorder implements RuntimeLearningSink {
  constructor(
    private readonly deps: {
      readonly objectives: ObjectiveRegistry;
      readonly evaluator: DeterministicObjectiveEvaluator;
      readonly experiences: EvidenceExperienceStore;
      readonly missionManager: MissionManager;
      /** Optional learning experience store (ExperienceRecord format for daily learning) */
      readonly learningExperienceStore?: LearningExperienceStore;
    },
    private readonly options: { readonly defaultObjectiveId?: string } = {},
  ) {}

  async recordTaskCompletion(
    task: Task,
    options: { readonly actor?: string; readonly execution?: ExecutionProvenance } = {},
  ): Promise<EvidenceBackedExperience | undefined> {
    const objective = this.deps.objectives.get(this.options.defaultObjectiveId ?? DEFAULT_NO_REGRESSION_OBJECTIVE_ID);
    if (!objective) return undefined;

    const mission = this.deps.missionManager.create({
      name: `Runtime task ${task.id}`,
      description: task.goal,
      owner: options.actor ?? "runtime",
    });
    this.deps.missionManager.activate(mission.id);
    if (task.status === "completed") {
      this.deps.missionManager.complete(mission.id);
    } else {
      this.deps.missionManager.fail(mission.id);
    }

    const baseline = await this.deps.experiences.latestForObjective(objective.id, task.id);
    const observations = observeRuntimeTask(task, objective);
    const execution = buildExecutionProvenance(task, options.execution);
    const evaluation = this.deps.evaluator.evaluate({
      objective,
      runId: task.id,
      observations,
      baselineRunId: baseline?.runId,
      baselineObservations: baseline?.metricObservations,
      execution,
    });

    const experience: EvidenceBackedExperience = {
      id: createId("evexp"),
      objective: cloneObjective(objective),
      strategyId: execution.strategyId,
      execution,
      missionId: mission.id,
      runId: task.id,
      taskId: task.id,
      actions: task.plan.map((step) => step.title),
      outcomes: buildOutcomes(task),
      metricObservations: clone(observations),
      evaluation,
      evidence: clone(evaluation.evidence),
      resultStatus: task.status === "completed" ? "completed" : "failed",
      traceRefs: [task.id],
      createdAt: now(),
    };

    // Save to evidence experience store
    await this.deps.experiences.save(experience);

    // Also save to learning experience store (ExperienceRecord format) if available
    if (this.deps.learningExperienceStore) {
          const outcome: import("../learning/types.js").ExperienceOutcome = task.status === "completed" ? "VERIFIED_SUCCESS" : "VERIFIED_FAILURE";
          await this.deps.learningExperienceStore.recordExperience({
                      companyId: "quack",
                      projectId: "default",
                      missionId: mission.id,
                      taskId: task.id,
                      agentId: options.actor ?? "runtime",
                      role: "executor",
                      taskType: "runtime_task",
                      outcome,
                      harness: "QUACK_NATIVE",
                      provider: "runtime",
                      model: "runtime",
                      skills: [],
                      environment: {
                        os: process.platform,
                        cpu: process.arch,
                        ramGb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
                        gpu: "none",
                        vramGb: 0,
                      },
                      toolsUsed: task.plan.map((step) => String(step.title)),
                      attempts: 1,
                      retries: 0,
                      durationMs: 0, // not available here
                      tokens: { input: 0, output: 0, total: 0 },
                      costUsd: 0,
                      errors: task.status === "failed" ? [String(task.error?.message ?? "Unknown error")] : [],
                      artifacts: [],
                      evidenceRefs: [experience.id],
                      verification: { passed: task.status === "completed", verifier: "runtime", reason: task.status === "completed" ? "Task completed successfully" : "Task failed" },
                      lessons: [],
                      classification: "INTERNAL",
                    });
        }

    return experience;
  }
}

export function observeRuntimeTask(task: Task, objective: ObjectiveSpecification): MetricObservation[] {
  return objective.metrics.map((metric, index) => {
    const value = readMetricValue(task, metric.measurementSource);
    return {
      id: createId("obs"),
      objectiveId: objective.id,
      metricId: metric.id,
      runId: task.id,
      source: metric.measurementSource,
      value,
      valid: value !== undefined,
      error: value === undefined ? `No value found at ${metric.measurementSource}.` : undefined,
      observedAt: now(),
      sequence: index,
    };
  });
}

function readMetricValue(task: Task, source: string): MetricValue | undefined {
  switch (source) {
    case "runtime.task.status":
      return task.status === "completed";
    case "runtime.task.result.failedSteps": {
      const failedSteps = task.result?.["failedSteps"];
      if (typeof failedSteps === "number") return failedSteps;
      if (task.status === "completed") return 0;
      return 1;
    }
    default:
      return readJsonPath({ task: task as unknown as JsonObject }, source);
  }
}

function readJsonPath(source: JsonObject, path: string): MetricValue | undefined {
  let current: JsonValue | undefined = source;
  for (const part of path.split(".")) {
    if (!isJsonObject(current)) return undefined;
    current = current[part];
  }
  if (typeof current === "number" || typeof current === "boolean" || typeof current === "string") return current;
  return undefined;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildOutcomes(task: Task): string[] {
  const outcomes = [`task.status:${task.status}`];
  const failedSteps = task.result?.["failedSteps"];
  if (typeof failedSteps === "number") outcomes.push(`runtime.failedSteps:${failedSteps}`);
  if (task.error?.["code"]) outcomes.push(`task.error:${String(task.error["code"])}`);
  return outcomes;
}

function buildExecutionProvenance(task: Task, provided?: ExecutionProvenance): ExecutionProvenance {
  const result = task.result;
  return {
    strategyId: provided?.strategyId ?? stringValue(result, "strategyId"),
    strategyLabel: provided?.strategyLabel ?? stringValue(result, "strategyLabel") ?? stringValue(result, "strategy"),
    workflowId: provided?.workflowId ?? stringValue(result, "workflowId"),
    plannerId: provided?.plannerId ?? stringValue(result, "plannerId"),
    plannerVersion: provided?.plannerVersion ?? stringValue(result, "plannerVersion"),
    runtimeId: provided?.runtimeId ?? stringValue(result, "runtimeId") ?? "core.quack-runtime",
    runtimeVersion: provided?.runtimeVersion ?? stringValue(result, "runtimeVersion"),
    contextKey: provided?.contextKey ?? stringValue(result, "contextKey"),
    contextTags: provided?.contextTags ?? readStringArray(result, "contextTags"),
    selectedSkills: mergeSkillAttributions(provided?.selectedSkills ?? [], readSkillAttributions(result)),
    variant: provided?.variant ?? readExecutionVariant(result),
  };
}

function stringValue(source: JsonObject | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readSkillAttributions(source: JsonObject | undefined): SkillAttribution[] {
  const raw = source?.["selectedSkills"] ?? source?.["skills"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry === "string" && entry.length > 0) return [{ skillId: entry }];
    if (!isRecord(entry) || typeof entry["skillId"] !== "string" || entry["skillId"].length === 0) return [];
    return [{
      skillId: entry["skillId"],
      version: typeof entry["version"] === "string" ? entry["version"] : undefined,
      source: typeof entry["source"] === "string" ? entry["source"] : undefined,
    }];
  });
}

function readStringArray(source: JsonObject | undefined, key: string): string[] | undefined {
  const raw = source?.[key];
  if (!Array.isArray(raw)) return undefined;
  const values = raw.filter((value): value is string => typeof value === "string" && value.length > 0);
  return values.length > 0 ? values : undefined;
}

function mergeSkillAttributions(
  provided: readonly SkillAttribution[],
  observed: readonly SkillAttribution[],
): SkillAttribution[] {
  const merged = new Map<string, SkillAttribution>();
  for (const skill of [...observed, ...provided]) {
    merged.set(`${skill.skillId}@${skill.version ?? ""}`, { ...skill });
  }
  return [...merged.values()];
}

function readExecutionVariant(source: JsonObject | undefined): ExecutionVariant | undefined {
  const raw = source?.["executionVariant"];
  if (isRecord(raw) && typeof raw["id"] === "string" && isVariantRole(raw["role"])) {
    return {
      id: raw["id"],
      role: raw["role"],
      label: typeof raw["label"] === "string" ? raw["label"] : undefined,
    };
  }

  const id = stringValue(source, "executionVariantId");
  const role = source?.["executionVariantRole"];
  if (!id || !isVariantRole(role)) return undefined;
  return { id, role };
}

function isVariantRole(value: unknown): value is ExecutionVariantRole {
  return value === "production" || value === "control" || value === "candidate";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
