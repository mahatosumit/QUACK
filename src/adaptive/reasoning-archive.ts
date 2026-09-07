import { createId, now } from "../core/types.js";
import type { ReasoningTrace } from "./types.js";

export function createReasoningArchive() {
  const traces: ReasoningTrace[] = [];
  const maxTraces = 2000;

  function storeTrace(trace: ReasoningTrace): void {
    traces.push({ ...trace, id: trace.id || createId("rt") });
    if (traces.length > maxTraces) {
      traces.splice(0, traces.length - maxTraces);
    }
  }

  function getTrace(id: string): ReasoningTrace | undefined {
    return traces.find((t) => t.id === id);
  }

  function searchTraces(goal: string): ReasoningTrace[] {
    const lowerGoal = goal.toLowerCase();
    return traces
      .filter(
        (t) =>
          t.goal.toLowerCase().includes(lowerGoal) ||
          t.steps.some((s) => s.content.toLowerCase().includes(lowerGoal)) ||
          t.conclusion.toLowerCase().includes(lowerGoal)
      )
      .sort((a, b) => b.confidence - a.confidence);
  }

  function getStats(): Record<string, number> {
    const stats: Record<string, number> = { total: traces.length };
    stats.avgConfidence =
      traces.length > 0
        ? traces.reduce((s, t) => s + t.confidence, 0) / traces.length
        : 0;
    stats.avgSteps =
      traces.length > 0
        ? traces.reduce((s, t) => s + t.steps.length, 0) / traces.length
        : 0;
    return stats;
  }

  const stepTypes = ["observation", "inference", "hypothesis", "verification", "conclusion"] as const;

  function createReasoningStep(type: ReasoningTrace["steps"][0]["type"], content: string, evidence: string[] = [], confidence = 1): ReasoningTrace["steps"][0] {
    return { type, content, evidence, confidence };
  }

  return { storeTrace, getTrace, searchTraces, getStats, createReasoningStep } as const;
}
