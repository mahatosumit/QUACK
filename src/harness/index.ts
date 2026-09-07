import { type EventBus } from "../events/event-bus.js";
import { MetricsCollector, collectMetrics } from "./metrics-collector.js";
import { MissionEvaluator, evaluateMission } from "./evaluator.js";
import { ReplayEngine, replayTrace, traceSignature } from "./replay-engine.js";
import { TraceRecorder } from "./trace-recorder.js";
import { benchmarkScenarios } from "./scenarios.js";
import { type EvaluationRepository, type TraceRepository } from "../storage/sqlite.js";
import { type Harness, type HarnessConfig, type HarnessExecutionContext, type HarnessTaskInput, type HarnessTaskOutput, type HarnessMetadata, type HarnessCapabilities, type HarnessHealth, type HarnessCertification, type HarnessStatus, type HarnessCheckpoint, type SubagentSpawnOptions, type SubagentReport, type BackgroundJob, type BackgroundJobStatus, type HarnessRegistry } from "./contract.js";

/**
 * Legacy Harness interface for backward compatibility.
 * This is now a minimal wrapper around the contract Harness.
 */
export interface LegacyHarness {
  readonly traceRecorder: TraceRecorder;
  readonly metrics: MetricsCollector;
  readonly evaluator: MissionEvaluator;
  readonly replay: ReplayEngine;
  readonly scenarios: typeof benchmarkScenarios;
}

/**
 * Creates a minimal legacy-compatible harness object.
 * For full contract compliance, use the registry with proper harness providers.
 */
export function createHarness(options: {
  readonly eventBus?: EventBus;
  readonly traceRepository?: TraceRepository;
  readonly evaluationRepository?: EvaluationRepository;
} = {}): LegacyHarness {
  const metrics = new MetricsCollector();
  return {
    traceRecorder: new TraceRecorder({ eventBus: options.eventBus, traceRepository: options.traceRepository }),
    metrics,
    evaluator: new MissionEvaluator({ eventBus: options.eventBus, metrics, evaluationRepository: options.evaluationRepository }),
    replay: new ReplayEngine(),
    scenarios: benchmarkScenarios,
  };
}

export {
  benchmarkScenarios,
  collectMetrics,
  evaluateMission,
  MetricsCollector,
  MissionEvaluator,
  ReplayEngine,
  replayTrace,
  TraceRecorder,
  traceSignature,
  type HarnessRegistry,
};
export * from "./types.js";
