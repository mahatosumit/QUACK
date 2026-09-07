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

  return {
    taskSuccessRate: trace.finalOutcome.success ? 1 : 0,
    toolFailureRate: toolCallCount === 0 ? 0 : failedTools / toolCallCount,
    capabilityViolations: deniedCapabilities,
    recoveryAttempts: recoverableFailures,
    executionLatencyMs: trace.finalOutcome.latencyMs,
    iterationCount: trace.iterations.length,
    toolCallCount,
    capabilityCheckCount: trace.capabilitiesRequested.length,
  };
}
