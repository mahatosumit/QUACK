import { type EventBus } from "../events/event-bus.js";
import { createId, now } from "../core/types.js";
import { collectMetrics, MetricsCollector } from "./metrics-collector.js";
import { type EvaluationRepository } from "../storage/sqlite.js";import {
  type EvaluationDimensions,
  type MissionEvaluationFailure,
  type MissionEvaluationResult,
  type MissionTrace,
} from "./types.js";

export class MissionEvaluator {
  constructor(
    private readonly options: {
      readonly eventBus?: EventBus;
      readonly metrics?: MetricsCollector;
      readonly evaluationRepository?: EvaluationRepository;
    } = {},
  ) {}

  async evaluateMission(trace: MissionTrace): Promise<MissionEvaluationResult> {
    await this.options.eventBus?.emit("evaluation.started", {
      traceId: trace.id,
      missionId: trace.missionInput.missionId ?? null,
    }, { actor: "harness" });

    const result = evaluateMissionWithMetrics(trace, this.options.metrics?.collect(trace) ?? collectMetrics(trace));

    await this.options.eventBus?.emit("evaluation.completed", {
      traceId: trace.id,
      missionId: trace.missionInput.missionId ?? null,
      success: result.success,
      score: result.score,
      failures: result.failures.length,
    }, { actor: "harness" });

    await this.options.evaluationRepository?.save({
      id: createId("evaluation"),
      traceId: trace.id,
      missionId: trace.missionInput.missionId,
      result,
      createdAt: now(),
    });

    return result;
  }
}

export function evaluateMission(trace: MissionTrace): MissionEvaluationResult {
  return evaluateMissionWithMetrics(trace, collectMetrics(trace));
}

function evaluateMissionWithMetrics(
  trace: MissionTrace,
  metrics: ReturnType<typeof collectMetrics>,
): MissionEvaluationResult {
  const failures: MissionEvaluationFailure[] = [];
  const improvements: string[] = [];

  if (!trace.finalOutcome.success) {
    failures.push({
      code: "mission.failed",
      message: trace.finalOutcome.error ?? `Mission ended in ${trace.finalOutcome.state}.`,
      severity: "high",
    });
    improvements.push("Improve the planner or verifier so the mission can reach a completed outcome.");
  }

  if (metrics.capabilityViolations > 0) {
    failures.push({
      code: "capability.violation",
      message: `${metrics.capabilityViolations} capability request(s) were denied.`,
      severity: "high",
    });
    improvements.push("Request the minimum required mission grant before selecting protected tools.");
  }

  if (metrics.toolFailureRate > 0) {
    failures.push({
      code: "tool.failure",
      message: `${Math.round(metrics.toolFailureRate * 100)}% of tool calls failed.`,
      severity: metrics.toolFailureRate >= 0.5 ? "high" : "medium",
    });
    improvements.push("Add recovery planning for failing tools and preserve successful partial work.");
  }

  if (metrics.iterationCount === 0) {
    failures.push({
      code: "iteration.missing",
      message: "No loop iterations were captured.",
      severity: "medium",
    });
    improvements.push("Ensure the trace recorder is attached before mission execution starts.");
  }

  const penalty = failures.reduce((total, failure) => {
    if (failure.severity === "high") return total + 30;
    if (failure.severity === "medium") return total + 15;
    return total + 5;
  }, 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return {
    success: trace.finalOutcome.success && failures.every((failure) => failure.severity !== "high"),
    score,
    failures,
    improvements,
    metrics,
    dimensions: evaluateDimensions(trace, metrics),
  };
}

/**
 * P5 agent evaluation dimensions. Each dimension is scored 0–100 from the
 * durable trace alone — no provider calls, no fabricated comparisons:
 *
 * - capabilityDiscipline: denied requests vs checks, and whether denials
 *   were recovered by degrading rather than re-requesting authority.
 * - recovery: recoverable failures that later iterations actually resolved.
 * - planning: plans with tool invocations and iteration progress.
 * - evidenceQuality: successful tool calls that captured usable output.
 */
function evaluateDimensions(trace: MissionTrace, metrics: ReturnType<typeof collectMetrics>): EvaluationDimensions {
  // Capability discipline: no denials is perfect; recovered denials keep
  // most of the score; unrecovered denials scale with their share.
  const deniedShare = metrics.capabilityCheckCount === 0 ? 0 : metrics.capabilityViolations / metrics.capabilityCheckCount;
  const recoveredShare = metrics.capabilityViolations === 0 ? 0 : metrics.recoveredDenials / metrics.capabilityViolations;
  const capabilityDiscipline = clamp(Math.round(100 - deniedShare * 60 + (deniedShare > 0 ? recoveredShare * 40 : 0)));

  // Recovery: every recoverable failure matched by a later successful
  // iteration counts; zero failures with success is full marks.
  const resolved = Math.min(metrics.recoveryAttempts, metrics.iterationCount > 0 ? metrics.iterationCount - 1 : 0);
  const recovery = metrics.recoveryAttempts === 0
    ? (trace.finalOutcome.success ? 100 : 60)
    : clamp(Math.round(100 - ((metrics.recoveryAttempts - resolved) / metrics.recoveryAttempts) * 60));

  // Planning: at least one plan with invocations; more plans/iterations
  // show replanning only up to a sane ceiling (doom loops do not score).
  const plannedInvocations = trace.plansGenerated.reduce((total, plan) => total + plan.toolInvocations.length, 0);
  const planning = clamp(Math.round(
    (plannedInvocations > 0 ? 60 : 0) +
    Math.min(20, plannedInvocations * 4) +
    (metrics.iterationCount > 0 ? 10 : 0) +
    (metrics.iterationCount > 1 && trace.finalOutcome.success ? 10 : 0),
  ));

  // Evidence quality: coverage of successful tool calls with captured
  // output, and at least one verification citing something.
  const verified = trace.verificationResults.filter((verification) => verification.success).length;
  const evidenceQuality = clamp(Math.round(metrics.evidenceCoverage * 80 + (verified > 0 ? 20 : 0)));

  return { capabilityDiscipline, recovery, planning, evidenceQuality };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}
