import { createId, now } from "../core/types.js";
import {
  type MetricDefinition,
  type MetricObservation,
  type MetricValue,
  type ExecutionProvenance,
  type ObjectiveEvaluation,
  type ObjectiveEvaluationStatus,
  type ObjectiveEvidence,
  type ObjectiveSpecification,
} from "./types.js";

export interface EvaluationInput {
  readonly objective: ObjectiveSpecification;
  readonly runId: string;
  readonly observations: readonly MetricObservation[];
  readonly baselineRunId?: string;
  readonly baselineObservations?: readonly MetricObservation[];
  readonly execution?: ExecutionProvenance;
}

export class DeterministicObjectiveEvaluator {
  readonly id = "core.deterministic-objective-evaluator";

  evaluate(input: EvaluationInput): ObjectiveEvaluation {
    const createdAt = now();
    const evidence: ObjectiveEvidence[] = [];
    const currentByMetric = indexObservations(input.observations);
    const baselineByMetric = indexObservations(input.baselineObservations ?? []);

    if (input.objective.evaluationPolicy.evaluatorId !== this.id) {
      return this.inconclusive(input, createdAt, "Objective requires a different evaluator.");
    }

    if (!input.baselineObservations || input.baselineObservations.length === 0) {
      return this.insufficient(input, createdAt, "No prior comparable baseline exists.");
    }

    const statuses: ObjectiveEvaluationStatus[] = [];

    for (const metric of input.objective.metrics) {
      const current = currentByMetric.get(metric.id);
      if (!current) {
        return this.inconclusive(input, createdAt, `Missing observation for metric ${metric.id}.`);
      }
      if (!current.valid || current.value === undefined) {
        return this.inconclusive(input, createdAt, current.error ?? `Invalid observation for metric ${metric.id}.`);
      }

      const baseline = baselineByMetric.get(metric.id);
      if (!baseline || !baseline.valid || baseline.value === undefined) {
        return this.insufficient(input, createdAt, `Baseline observation for metric ${metric.id} is missing or invalid.`);
      }

      const comparison = compareMetric(metric, current.value, baseline.value);
      if (comparison.status === "INCONCLUSIVE") {
        return this.inconclusive(input, createdAt, `Metric ${metric.id} has incompatible measurements.`);
      }

      statuses.push(comparison.status);
      evidence.push({
        id: createId("evidence"),
        objectiveId: input.objective.id,
        runId: input.runId,
        metricId: metric.id,
        observationId: current.id,
        evaluatorId: this.id,
        source: current.source,
        baselineRunId: input.baselineRunId,
        baselineValue: baseline.value,
        observedValue: current.value,
        delta: comparison.delta,
        conclusion: comparison.status,
        confidence: 1,
        createdAt,
        execution: input.execution ? clone(input.execution) : undefined,
      });
    }

    const status = summarizeStatuses(statuses);
    return {
      id: createId("eval"),
      objectiveId: input.objective.id,
      runId: input.runId,
      status,
      summary: `Deterministic evaluation ${status.toLowerCase().replaceAll("_", " ")}.`,
      observations: clone(input.observations),
      evidence: clone(evidence),
      comparedToRunId: input.baselineRunId,
      confidence: status === "INCONCLUSIVE" ? 0.2 : 1,
      createdAt,
      execution: input.execution ? clone(input.execution) : undefined,
    };
  }

  private insufficient(input: EvaluationInput, createdAt: string, reason: string): ObjectiveEvaluation {
    return this.terminalEvaluation(input, createdAt, "INSUFFICIENT_EVIDENCE", reason, 0.3);
  }

  private inconclusive(input: EvaluationInput, createdAt: string, reason: string): ObjectiveEvaluation {
    return this.terminalEvaluation(input, createdAt, "INCONCLUSIVE", reason, 0.2);
  }

  private terminalEvaluation(
    input: EvaluationInput,
    createdAt: string,
    status: ObjectiveEvaluationStatus,
    reason: string,
    confidence: number,
  ): ObjectiveEvaluation {
    const evidence: ObjectiveEvidence = {
      id: createId("evidence"),
      objectiveId: input.objective.id,
      runId: input.runId,
      evaluatorId: this.id,
      source: "deterministic-evaluator",
      baselineRunId: input.baselineRunId,
      conclusion: status,
      confidence,
      createdAt,
      execution: input.execution ? clone(input.execution) : undefined,
    };
    return {
      id: createId("eval"),
      objectiveId: input.objective.id,
      runId: input.runId,
      status,
      summary: reason,
      observations: clone(input.observations),
      evidence: [evidence],
      comparedToRunId: input.baselineRunId,
      confidence,
      createdAt,
      execution: input.execution ? clone(input.execution) : undefined,
    };
  }
}

function indexObservations(observations: readonly MetricObservation[]): Map<string, MetricObservation> {
  return new Map(observations.map((observation) => [observation.metricId, observation]));
}

function compareMetric(
  metric: MetricDefinition,
  current: MetricValue,
  baseline: MetricValue,
): { readonly status: ObjectiveEvaluationStatus; readonly delta?: number } {
  if (metric.direction === "target") {
    const target = metric.threshold;
    if (target === undefined) return { status: "INCONCLUSIVE" };
    const currentHit = current === target;
    const baselineHit = baseline === target;
    if (currentHit && !baselineHit) return { status: "IMPROVED" };
    if (!currentHit && baselineHit) return { status: "REGRESSED" };
    return { status: "UNCHANGED" };
  }

  if (typeof current !== "number" || typeof baseline !== "number") {
    return { status: "INCONCLUSIVE" };
  }

  const delta = current - baseline;
  if (delta === 0) return { status: "UNCHANGED", delta };
  if (metric.direction === "maximize") return { status: delta > 0 ? "IMPROVED" : "REGRESSED", delta };
  return { status: delta < 0 ? "IMPROVED" : "REGRESSED", delta };
}

function summarizeStatuses(statuses: readonly ObjectiveEvaluationStatus[]): ObjectiveEvaluationStatus {
  if (statuses.length === 0) return "INSUFFICIENT_EVIDENCE";
  const improved = statuses.includes("IMPROVED");
  const regressed = statuses.includes("REGRESSED");
  if (improved && regressed) return "INCONCLUSIVE";
  if (improved) return "IMPROVED";
  if (regressed) return "REGRESSED";
  return "UNCHANGED";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
