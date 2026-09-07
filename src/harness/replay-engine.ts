import { type MissionTrace, type ReplayMismatch, type ReplayResult, type ReplaySignature } from "./types.js";

export class ReplayEngine {
  replay(expectedTrace: MissionTrace, actualTrace: MissionTrace = expectedTrace): ReplayResult {
    return replayTrace(expectedTrace, actualTrace);
  }
}

export function replayTrace(expectedTrace: MissionTrace, actualTrace: MissionTrace = expectedTrace): ReplayResult {
  const expected = traceSignature(expectedTrace);
  const actual = traceSignature(actualTrace);
  const mismatches = compareSignatures(expected, actual);

  return {
    success: mismatches.length === 0,
    matched: mismatches.length === 0,
    expected,
    actual,
    mismatches,
  };
}

export function traceSignature(trace: MissionTrace): ReplaySignature {
  return {
    goal: trace.missionInput.goal,
    planStrategies: trace.plansGenerated.map((plan) => plan.strategy),
    selectedActions: trace.iterations.map((iteration) => iteration.selectedAction?.nodeId ?? "none"),
    tools: trace.toolsExecuted.map((tool) => `${tool.toolId}:${tool.success ? "ok" : "failed"}`),
    verification: trace.verificationResults.map((verification) => verification.success),
    outcome: trace.finalOutcome.success ? "success" : "failure",
  };
}

function compareSignatures(expected: ReplaySignature, actual: ReplaySignature): ReplayMismatch[] {
  const mismatches: ReplayMismatch[] = [];
  for (const field of Object.keys(expected) as (keyof ReplaySignature)[]) {
    if (JSON.stringify(expected[field]) !== JSON.stringify(actual[field])) {
      mismatches.push({ field, expected: expected[field], actual: actual[field] });
    }
  }
  return mismatches;
}
