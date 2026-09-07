import { type EventBus } from "../events/event-bus.js";
import { createId, now } from "../core/types.js";
import { collectMetrics, MetricsCollector } from "./metrics-collector.js";
import { type EvaluationRepository } from "../storage/sqlite.js";
import {
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
  };
}
