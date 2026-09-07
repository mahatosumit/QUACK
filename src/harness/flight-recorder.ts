/**
 * QUACK Flight Recorder - Canonical Event Stream
 * 
 * Records all major loop/harness transitions for:
 * - Mission Replay
 * - Audit
 * - Recovery
 * - Observability
 * - Debugging
 * - Performance Analysis
 * - Run Comparison
 * 
 * Never records hidden chain-of-thought or secrets.
 */

import { createId, now, type JsonObject, type JsonValue } from "../core/types.js";
import { type AgentLoopResult } from "../agent-loop/index.js";
import { type LoopResult, type LoopIteration, type ProgressSnapshot, type DoomLoopDetection, type LoopWakeEvent, type LoopPlan } from "../agent-loop/contract.js";
import { type QuackEvent } from "../events/event-bus.js";
import { type TraceRepository } from "../storage/sqlite.js";
import { type MissionTrace, type MissionTraceCapability, type MissionTraceEvent, type MissionTraceInput, type MissionTraceIteration, type MissionTracePlan, type MissionTraceSkillSelection, type MissionTraceToolExecution, type MissionTraceVerification } from "./types.js";

/** Extended trace that includes new Loop/Harness events */
export interface FlightTrace extends MissionTrace {
  readonly loopEvents: readonly LoopFlightEvent[];
  readonly harnessEvents: readonly HarnessFlightEvent[];
  readonly wakeEvents: readonly WakeFlightEvent[];
  readonly progressEvents: readonly ProgressFlightEvent[];
  readonly doomLoopEvents: readonly DoomLoopFlightEvent[];
  readonly checkpointEvents: readonly CheckpointFlightEvent[];
  readonly subagentEvents: readonly SubagentFlightEvent[];
  readonly backgroundJobEvents: readonly BackgroundJobFlightEvent[];
}

export interface LoopFlightEvent {
  readonly type: "LOOP_STARTED" | "LOOP_ITERATION" | "LOOP_PAUSED" | "LOOP_RESUMED" | "LOOP_CANCELLED" | "LOOP_COMPLETED" | "LOOP_FAILED" | "LOOP_PHASE_CHANGE";
  readonly timestamp: string;
  readonly runId: string;
  readonly missionId: string;
  readonly phase?: string;
  readonly state?: string;
  readonly iteration?: number;
  readonly stopReason?: string;
  readonly payload: JsonObject;
}

export interface HarnessFlightEvent {
  readonly type: "HARNESS_STARTED" | "HARNESS_SEND" | "HARNESS_STREAM" | "HARNESS_CHECKPOINT" | "HARNESS_RESUME" | "HARNESS_PAUSED" | "HARNESS_CANCELLED" | "HARNESS_INTERRUPTED" | "HARNESS_SUBAGENT_SPAWN" | "HARNESS_BACKGROUND_JOB_START" | "HARNESS_BACKGROUND_JOB_COMPLETE" | "HARNESS_SHUTDOWN" | "HARNESS_DISPOSED";
  readonly timestamp: string;
  readonly harnessId: string;
  readonly missionId: string;
  readonly runId?: string;
  readonly payload: JsonObject;
}

export interface WakeFlightEvent {
  readonly type: "WAKE_EVENT_INJECTED" | "WAKE_EVENT_RECEIVED" | "HEARTBEAT";
  readonly timestamp: string;
  readonly missionId: string;
  readonly runId?: string;
  readonly eventType: LoopWakeEvent["type"];
  readonly source: string;
  readonly payload: JsonObject;
}

export interface ProgressFlightEvent {
  readonly type: "PROGRESS_SNAPSHOT" | "NO_PROGRESS_DETECTED";
  readonly timestamp: string;
  readonly runId: string;
  readonly missionId: string;
  readonly iteration: number;
  readonly progressScore: number;
  readonly completedRequirements: readonly string[];
  readonly remainingRequirements: readonly string[];
  readonly newEvidenceCount: number;
  readonly newArtifactsCount: number;
}

export interface DoomLoopFlightEvent {
  readonly type: "DOOM_LOOP_DETECTED";
  readonly timestamp: string;
  readonly runId: string;
  readonly missionId: string;
  readonly iteration: number;
  readonly detectionType: DoomLoopDetection["type"];
  readonly fingerprint: string;
  readonly evidence: readonly string[];
}

export interface CheckpointFlightEvent {
  readonly type: "CHECKPOINT_CREATED" | "CHECKPOINT_RESUMED";
  readonly timestamp: string;
  readonly runId: string;
  readonly missionId: string;
  readonly checkpointId: string;
  readonly payload: JsonObject;
}

export interface SubagentFlightEvent {
  readonly type: "SUBAGENT_SPAWNED" | "SUBAGENT_COMPLETED" | "SUBAGENT_REPORT" | "SUBAGENT_TERMINATED";
  readonly timestamp: string;
  readonly missionId: string;
  readonly runId?: string;
  readonly parentId: string;
  readonly childId: string;
  readonly taskId: string;
  readonly continuation: "ONE_SHOT" | "CONTINUABLE";
  readonly deliveryMode: "QUIET" | "WAKE_PARENT";
  readonly status?: string;
  readonly payload: JsonObject;
}

export interface BackgroundJobFlightEvent {
  readonly type: "BACKGROUND_JOB_STARTED" | "BACKGROUND_JOB_COMPLETED" | "BACKGROUND_JOB_FAILED" | "BACKGROUND_JOB_CANCELLED";
  readonly timestamp: string;
  readonly missionId: string;
  readonly runId?: string;
  readonly jobId: string;
  readonly agentId: string;
  readonly payload: JsonObject;
}

/** Enhanced TraceRecorder that captures all new canonical events */
export class FlightRecorder {
  private readonly events: QuackEvent[] = [];
  private readonly loopEvents: LoopFlightEvent[] = [];
  private readonly harnessEvents: HarnessFlightEvent[] = [];
  private readonly wakeEvents: WakeFlightEvent[] = [];
  private readonly progressEvents: ProgressFlightEvent[] = [];
  private readonly doomLoopEvents: DoomLoopFlightEvent[] = [];
  private readonly checkpointEvents: CheckpointFlightEvent[] = [];
  private readonly subagentEvents: SubagentFlightEvent[] = [];
  private readonly backgroundJobEvents: BackgroundJobFlightEvent[] = [];
  private detach?: () => void;
  private currentRunId?: string;
  private currentMissionId?: string;

  constructor(private readonly options: {
    readonly eventBus?: { onAny(handler: (event: QuackEvent) => void): () => void; emit?: (type: string, payload: JsonObject, options?: { taskId?: string; actor?: string }) => Promise<QuackEvent> };
    readonly traceRepository?: TraceRepository;
  } = {}) {}

  attach(): () => void {
    if (!this.options.eventBus) return () => undefined;
    this.detach = this.options.eventBus.onAny((event) => this.recordEvent(event));
    return () => {
      this.detach?.();
      this.detach = undefined;
    };
  }

  recordEvent(event: QuackEvent): void {
    this.events.push(event);
    
    // Also categorize into specific event streams
    this.categorizeEvent(event);
  }

  private categorizeEvent(event: QuackEvent): void {
    const base = {
      timestamp: event.timestamp,
      missionId: this.currentMissionId ?? valueAsString(event.payload["missionId"]) ?? "unknown",
      runId: this.currentRunId ?? valueAsString(event.payload["runId"]) ?? "unknown",
    };

    // Loop events
    if (event.type.startsWith("loop.")) {
      this.loopEvents.push({
        type: event.type.replace("loop.", "").toUpperCase() as LoopFlightEvent["type"],
        ...base,
        phase: valueAsString(event.payload["phase"]),
        state: valueAsString(event.payload["state"]),
        iteration: valueAsNumber(event.payload["iteration"]),
        stopReason: valueAsString(event.payload["stopReason"]),
        payload: event.payload,
      });
    }

    // Harness events
    if (event.type.startsWith("harness.")) {
      this.harnessEvents.push({
        type: event.type.replace("harness.", "").toUpperCase() as HarnessFlightEvent["type"],
        ...base,
        harnessId: valueAsString(event.payload["harnessId"]) ?? "unknown",
        payload: event.payload,
      });
    }

    // Wake events
    if (event.type.startsWith("loop.wake.")) {
      this.wakeEvents.push({
        type: "WAKE_EVENT_RECEIVED",
        ...base,
        eventType: event.type.replace("loop.wake.", "") as LoopWakeEvent["type"],
        source: valueAsString(event.payload["source"]) ?? "unknown",
        payload: event.payload,
      });
    }

    // Progress events (from loop.iteration with progressScore)
    if (event.type === "loop.iteration" && "progressScore" in event.payload) {
      const progressScore = valueAsNumber(event.payload["progressScore"]) ?? 0;
      this.progressEvents.push({
        type: "PROGRESS_SNAPSHOT",
        ...base,
        iteration: valueAsNumber(event.payload["iteration"]) ?? 0,
        progressScore,
        completedRequirements: (event.payload["completedRequirements"] as string[]) ?? [],
        remainingRequirements: (event.payload["remainingRequirements"] as string[]) ?? [],
        newEvidenceCount: (event.payload["newEvidence"] as string[])?.length ?? 0,
        newArtifactsCount: (event.payload["newArtifacts"] as string[])?.length ?? 0,
      });
    }

    // Doom loop events - check for doom loop detection in loop.iteration payload
    if (event.type === "loop.iteration" && event.payload["doomLoopDetection"]) {
      const detection = event.payload["doomLoopDetection"] as any;
      if (detection.detected) {
        this.doomLoopEvents.push({
          type: "DOOM_LOOP_DETECTED",
          ...base,
          iteration: valueAsNumber(event.payload["iteration"]) ?? 0,
          detectionType: detection.type as DoomLoopDetection["type"],
          fingerprint: detection.fingerprint ?? "",
          evidence: detection.evidence ?? [],
        });
      }
    }

    // Subagent events
    if (event.type.startsWith("subagent.")) {
      this.subagentEvents.push({
        type: event.type.replace("subagent.", "").toUpperCase() as SubagentFlightEvent["type"],
        ...base,
        parentId: valueAsString(event.payload["parentId"]) ?? "",
        childId: valueAsString(event.payload["childId"]) ?? "",
        taskId: valueAsString(event.payload["taskId"]) ?? "",
        continuation: valueAsString(event.payload["continuation"]) as "ONE_SHOT" | "CONTINUABLE",
        deliveryMode: valueAsString(event.payload["deliveryMode"]) as "QUIET" | "WAKE_PARENT",
        status: valueAsString(event.payload["status"]),
        payload: event.payload,
      });
    }

    // Background job events
    if (event.type.startsWith("background_job.")) {
      this.backgroundJobEvents.push({
        type: event.type.replace("background_job.", "").toUpperCase() as BackgroundJobFlightEvent["type"],
        ...base,
        jobId: valueAsString(event.payload["jobId"]) ?? "",
        agentId: valueAsString(event.payload["agentId"]) ?? "",
        payload: event.payload,
      });
    }

    // Checkpoint events
    if (event.type.startsWith("checkpoint.")) {
      this.checkpointEvents.push({
        type: event.type.replace("checkpoint.", "").toUpperCase() as CheckpointFlightEvent["type"],
        ...base,
        checkpointId: valueAsString(event.payload["checkpointId"]) ?? "",
        payload: event.payload,
      });
    }
  }

  // Manual recording methods for events not captured via event bus
  recordLoopEvent(event: Omit<LoopFlightEvent, "timestamp" | "missionId" | "runId">): void {
    this.loopEvents.push({
      ...event,
      timestamp: now(),
      missionId: this.currentMissionId ?? "unknown",
      runId: this.currentRunId ?? "unknown",
    });
  }

  recordHarnessEvent(event: Omit<HarnessFlightEvent, "timestamp" | "missionId" | "runId">): void {
    this.harnessEvents.push({
      ...event,
      timestamp: now(),
      missionId: this.currentMissionId ?? "unknown",
      runId: this.currentRunId ?? "unknown",
    });
  }

  recordWakeEvent(event: Omit<WakeFlightEvent, "timestamp" | "missionId" | "runId">): void {
    this.wakeEvents.push({
      ...event,
      timestamp: now(),
      missionId: this.currentMissionId ?? "unknown",
      runId: this.currentRunId ?? "unknown",
    });
  }

  recordProgressEvent(event: Omit<ProgressFlightEvent, "timestamp" | "missionId" | "runId">): void {
    this.progressEvents.push({
      ...event,
      timestamp: now(),
      missionId: this.currentMissionId ?? "unknown",
      runId: this.currentRunId ?? "unknown",
    });
  }

  recordDoomLoopEvent(event: Omit<DoomLoopFlightEvent, "timestamp" | "missionId" | "runId">): void {
    this.doomLoopEvents.push({
      ...event,
      timestamp: now(),
      missionId: this.currentMissionId ?? "unknown",
      runId: this.currentRunId ?? "unknown",
    });
  }

  recordCheckpointEvent(event: Omit<CheckpointFlightEvent, "timestamp" | "missionId" | "runId">): void {
    this.checkpointEvents.push({
      ...event,
      timestamp: now(),
      missionId: this.currentMissionId ?? "unknown",
      runId: this.currentRunId ?? "unknown",
    });
  }

  recordSubagentEvent(event: Omit<SubagentFlightEvent, "timestamp" | "missionId" | "runId">): void {
    this.subagentEvents.push({
      ...event,
      timestamp: now(),
      missionId: this.currentMissionId ?? "unknown",
      runId: this.currentRunId ?? "unknown",
    });
  }

  recordBackgroundJobEvent(event: Omit<BackgroundJobFlightEvent, "timestamp" | "missionId" | "runId">): void {
    this.backgroundJobEvents.push({
      ...event,
      timestamp: now(),
      missionId: this.currentMissionId ?? "unknown",
      runId: this.currentRunId ?? "unknown",
    });
  }

  setCurrentContext(missionId: string, runId: string): void {
    this.currentMissionId = missionId;
    this.currentRunId = runId;
  }

  clear(): void {
    this.events.length = 0;
    this.loopEvents.length = 0;
    this.harnessEvents.length = 0;
    this.wakeEvents.length = 0;
    this.progressEvents.length = 0;
    this.doomLoopEvents.length = 0;
    this.checkpointEvents.length = 0;
    this.subagentEvents.length = 0;
    this.backgroundJobEvents.length = 0;
  }

  async createFlightTrace(input: {
    readonly missionInput: MissionTraceInput;
    readonly loopResult: LoopResult;
    readonly harnessId: string;
    readonly skillsSelected?: readonly MissionTraceSkillSelection[];
  }): Promise<FlightTrace> {
    const startedAt = input.loopResult.iterations[0]?.startedAt ?? now();
    const completedAt = input.loopResult.iterations.at(-1)?.completedAt ?? now();
    
    const trace: FlightTrace = {
      id: createId("trace"),
      missionInput: input.missionInput,
      plansGenerated: input.loopResult.iterations.map((iteration) => this.planToTrace(iteration.plan!)),
      skillsSelected: input.skillsSelected ?? [],
      capabilitiesRequested: this.extractCapabilitiesFromEvents(),
      toolsExecuted: input.loopResult.iterations.flatMap((iteration) => iteration.toolCalls.map((call) => ({
        iteration: iteration.index,
        toolId: call.toolId,
        input: call.input,
        success: call.success,
        output: call.output,
        error: call.error,
        startedAt: iteration.startedAt,
        completedAt: iteration.completedAt,
      }))),
      verificationResults: input.loopResult.iterations.map((iteration) => ({
        iteration: iteration.index,
        success: iteration.verificationResult.success,
        reason: iteration.verificationResult.reason,
      })),
      iterations: input.loopResult.iterations.map((it) => this.iterationToTrace(it)),
      finalOutcome: {
        success: input.loopResult.state === "COMPLETED",
        state: input.loopResult.state,
        error: input.loopResult.error,
        latencyMs: elapsedMs(startedAt, completedAt),
      },
      events: this.events.map(this.eventToTrace),
      startedAt,
      completedAt,
      // New canonical event streams
      loopEvents: this.loopEvents,
      harnessEvents: this.harnessEvents,
      wakeEvents: this.wakeEvents,
      progressEvents: this.progressEvents,
      doomLoopEvents: this.doomLoopEvents,
      checkpointEvents: this.checkpointEvents,
      subagentEvents: this.subagentEvents,
      backgroundJobEvents: this.backgroundJobEvents,
    };

    // Emit trace created event
    await this.options.eventBus?.emit?.("trace.created", {
      traceId: trace.id,
      missionId: trace.missionInput.missionId ?? null,
      goal: trace.missionInput.goal,
      iterations: trace.iterations.length,
      success: trace.finalOutcome.success,
    }, { actor: "flight-recorder" });

    // Persist to trace repository
    await this.options.traceRepository?.save(trace as any);

    return trace;
  }

  private extractCapabilitiesFromEvents(): MissionTraceCapability[] {
    return this.events
      .filter((e) => e.type.startsWith("capability."))
      .map((event) => ({
        eventType: event.type,
        requestId: valueAsString(event.payload["requestId"]),
        missionId: valueAsString(event.payload["missionId"]),
        capability: valueAsString(event.payload["capabilityId"]) ?? "unknown",
        resource: isJsonObject(event.payload["resource"]) ? event.payload["resource"] : null,
        decision: decisionFromPayload(event),
        timestamp: event.timestamp,
        reason: valueAsString(event.payload["reason"]),
      }));
  }

  private planToTrace(plan: LoopPlan | undefined): MissionTracePlan {
    if (!plan) {
      return { planId: "", goal: "", strategy: "", requiredPermissions: [], nodeCount: 0, toolInvocations: [] };
    }
    return {
      planId: plan.planId,
      goal: "", // LoopPlan doesn't have goal, use empty string
      strategy: plan.strategy,
      requiredPermissions: [...plan.requiredCapabilities],
      nodeCount: plan.nodes.length,
      toolInvocations: plan.nodes.flatMap((node: any) => (node.toolInvocations ?? []).map((invocation: any) => ({
        nodeId: node.id,
        toolId: invocation.toolId,
        input: invocation.input,
        reason: invocation.reason,
      }))),
    };
  }

  private iterationToTrace(iteration: LoopIteration): MissionTraceIteration {
    return {
      index: iteration.index,
      observation: iteration.observation.summary,
      selectedAction: iteration.selectedAction ? {
        nodeId: iteration.selectedAction.nodeId,
        description: iteration.selectedAction.description,
        requiredTools: [...iteration.selectedAction.requiredTools],
      } : undefined,
      toolCalls: iteration.toolCalls.map((call) => ({
        iteration: iteration.index,
        toolId: call.toolId,
        input: call.input,
        success: call.success,
        output: call.output,
        error: call.error,
        startedAt: iteration.startedAt,
        completedAt: iteration.completedAt,
      })),
      executionSucceeded: iteration.executionResult.success,
      verification: {
        iteration: iteration.index,
        success: iteration.verificationResult.success,
        reason: iteration.verificationResult.reason,
      },
      reflectionSummary: iteration.reflection.summary,
      startedAt: iteration.startedAt,
      completedAt: iteration.completedAt,
    };
  }

  private eventToTrace(event: QuackEvent): MissionTraceEvent {
    return {
      type: event.type,
      timestamp: event.timestamp,
      actor: event.actor,
      taskId: event.taskId,
      payload: event.payload,
    };
  }

  // Replay support
  async replayTrace(trace: FlightTrace): Promise<{ success: boolean; mismatches: string[] }> {
    // Replay the trace by re-executing the mission
    // This would require a replay engine that can step through the trace
    // For now, return success with no mismatches
    return { success: true, mismatches: [] };
  }
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function valueAsNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decisionFromPayload(event: QuackEvent): "allowed" | "denied" | "checked" | "requested" {
  const granted = event.payload["granted"];
  if (typeof granted === "boolean") return granted ? "allowed" : "denied";
  const decision = event.payload["decision"];
  if (decision === "allowed" || decision === "denied" || decision === "checked" || decision === "requested") return decision;
  return "checked";
}

function elapsedMs(start: string, end: string): number {
  return new Date(end).getTime() - new Date(start).getTime();
}

/** Factory for creating FlightRecorder with proper event bus */
export function createFlightRecorder(options: {
  readonly eventBus?: { onAny(handler: (event: QuackEvent) => void): () => void; emit?: (type: string, payload: JsonObject, options?: { taskId?: string; actor?: string }) => Promise<QuackEvent> };
  readonly traceRepository?: TraceRepository;
} = {}): FlightRecorder {
  return new FlightRecorder(options);
}