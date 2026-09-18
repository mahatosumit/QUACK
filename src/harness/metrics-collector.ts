import { type HarnessMetrics, type MissionTrace } from "./types.js";

export class MetricsCollector {
  collect(trace: MissionTrace): HarnessMetrics {
    return collectMetrics(trace);
  }
}

export function collectMetrics(trace: MissionTrace): HarnessMetrics {
  const toolCallCount = trace.toolsExecuted.length;
  const failedTools = trace.toolsExecuted.filter((tool) => !tool.success).length;
  const deniedCapabilities = trace.capabilitiesRequested
    .filter((capability) => capability.decision === "denied").length;
  const recoverableFailures = trace.iterations
    .filter((iteration) => !iteration.executionSucceeded && !iteration.toolCalls.some((tool) => tool.error?.includes("CapabilityDeniedError")))
    .length;

  // P5: denied-then-recovered — a denial in an iteration whose mission still
  // reached later successful iterations (degraded instead of abandoned).
  const deniedRequestIds = new Set(trace.capabilitiesRequested
    .filter((capability) => capability.decision === "denied")
    .map((capability) => capability.requestId)
    .filter((id): id is string => typeof id === "string"));
  const recoveredDenials = deniedRequestIds.size === 0 ? 0
    : trace.iterations.filter((iteration) =>
        iteration.executionSucceeded ||
        trace.iterations.some((later) => later.index > iteration.index && later.executionSucceeded),
      ).length === 0
      ? 0
      : countRecoveredAfterDenial(trace);

  // P5: evidence coverage — successful tool calls that produced output
  // usable as evidence. Iteration tool calls carry captured outputs; the
  // trace-level toolsExecuted list is the denominator.
  const evidenced = trace.toolsExecuted.filter((tool) => tool.success && tool.output !== undefined).length;

  // P8.6: governed-instruction dispatch census (metadata only). Counts are
  // derived from P8.6 records; a mission without QIE dispatch reports zeros
  // (and the instruction dimensions are simply absent from evaluation).
  const instructionRecords = trace.instruction ?? [];
  const instructionDispatched = instructionRecords.filter((record) => record.outcome === "dispatched").length;
  const instructionRejected = instructionRecords.filter((record) => record.outcome === "rejected").length;
  const instructionInjectionFlags = instructionRecords.reduce((total, record) => total + record.injectionFlagCount, 0);

  // P9.21: semantic-memory census (metadata only). Absent evidence reports
  // zeros and the memory dimensions stay absent from evaluation.
  const semanticMemory = trace.semanticMemory;
  const semanticMemoryRecordCount = semanticMemory?.records.length ?? 0;
  const semanticMemoryRetrievalCount = semanticMemory?.retrievals.length ?? 0;
  const semanticMemoryDeletionCount = semanticMemory?.deletedIds.length ?? 0;

  return {
    taskSuccessRate: trace.finalOutcome.success ? 1 : 0,
    toolFailureRate: toolCallCount === 0 ? 0 : failedTools / toolCallCount,
    capabilityViolations: deniedCapabilities,
    recoveryAttempts: recoverableFailures,
    executionLatencyMs: trace.finalOutcome.latencyMs,
    iterationCount: trace.iterations.length,
    toolCallCount,
    capabilityCheckCount: trace.capabilitiesRequested.length,
    recoveredDenials,
    evidenceCoverage: toolCallCount === 0 ? 0 : evidenced / toolCallCount,
    instructionDispatchCount: instructionRecords.length,
    instructionDispatchedCount: instructionDispatched,
    instructionRejectedCount: instructionRejected,
    instructionInjectionFlagCount: instructionInjectionFlags,
    semanticMemoryRecordCount,
    semanticMemoryRetrievalCount,
    semanticMemoryDeletionCount,
  };
}

function countRecoveredAfterDenial(trace: MissionTrace): number {
  const denialIterations = new Set<number>();
  for (const capability of trace.capabilitiesRequested) {
    if (capability.decision !== "denied") continue;
    const iteration = trace.iterations.find((candidate) =>
      candidate.toolCalls.some((tool) => tool.error?.includes("CapabilityDeniedError")) ||
      candidate.verification.reason.toLowerCase().includes("denied"));
    if (iteration) denialIterations.add(iteration.index);
  }
  let recovered = 0;
  for (const index of denialIterations) {
    const later = trace.iterations.some((iteration) => iteration.index > index && iteration.executionSucceeded);
    const final = trace.finalOutcome.success;
    if (later || final) recovered += 1;
  }
  return recovered;
}
