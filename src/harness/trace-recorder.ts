import { createId, now, type JsonObject } from "../core/types.js";
import { type LoopResult, type LoopIteration } from "../agent-loop/contract.js";
import { type QuackEvent } from "../events/event-bus.js";
import { type TraceRepository } from "../storage/sqlite.js";
import {
  type MissionTrace,
  type MissionTraceCapability,
  type MissionTraceEvent,
  type MissionTraceInput,
  type MissionTraceIteration,
  type MissionTracePlan,
  type MissionTraceSkillSelection,
  type MissionTraceToolExecution,
  type MissionTraceVerification,
} from "./types.js";

export class TraceRecorder {
  private readonly events: QuackEvent[] = [];
  private detach?: () => void;

  constructor(private readonly options: {
    readonly eventBus?: { onAny(handler: (event: QuackEvent) => void): () => void; emit?: QuackEventEmitter };
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
  }

  clear(): void {
    this.events.length = 0;
  }

  async createTrace(input: {
    readonly missionInput: MissionTraceInput;
    readonly loopResult: LoopResult;
    readonly skillsSelected?: readonly MissionTraceSkillSelection[];
  }): Promise<MissionTrace> {
    const startedAt = input.loopResult.iterations[0]?.startedAt ?? now();
    const completedAt = input.loopResult.iterations.at(-1)?.completedAt ?? now();
    const trace: MissionTrace = {
      id: createId("trace"),
      missionInput: input.missionInput,
      plansGenerated: input.loopResult.iterations.map((iteration) => planToTrace(iteration.plan)),
      skillsSelected: input.skillsSelected ?? selectedSkillsFromEvents(this.events),
      capabilitiesRequested: capabilitiesFromEvents(this.events, input.loopResult.missionId),
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
      iterations: input.loopResult.iterations.map(iterationToTrace),
      finalOutcome: {
        success: input.loopResult.state === "COMPLETED",
        state: input.loopResult.state,
        error: input.loopResult.error,
        latencyMs: elapsedMs(startedAt, completedAt),
      },
      events: this.events.map(eventToTrace),
      startedAt,
      completedAt,
    };

    await this.options.eventBus?.emit?.("trace.created", {
      traceId: trace.id,
      missionId: trace.missionInput.missionId ?? null,
      goal: trace.missionInput.goal,
      iterations: trace.iterations.length,
      success: trace.finalOutcome.success,
    }, { actor: "harness" });

    await this.options.traceRepository?.save(trace);

    return trace;
  }
}

type QuackEventEmitter = (
  type: "trace.created",
  payload: JsonObject,
  options?: { readonly taskId?: string; readonly actor?: string },
) => Promise<QuackEvent>;

function planToTrace(plan: { planId: string; strategy: string; requiredCapabilities: readonly string[]; nodes: readonly { id: string; description: string; toolInvocations: readonly { toolId: string; input: any; reason?: string }[] }[] } | undefined): MissionTracePlan {
  if (!plan) {
    return { planId: "", goal: "", strategy: "", requiredPermissions: [], nodeCount: 0, toolInvocations: [] };
  }
  return {
    planId: plan.planId,
    goal: "", // LoopPlan doesn't have goal field
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

function iterationToTrace(iteration: LoopIteration): MissionTraceIteration {
  const verification: MissionTraceVerification = {
    iteration: iteration.index,
    success: iteration.verificationResult.success,
    reason: iteration.verificationResult.reason,
  };
  return {
    index: iteration.index,
    observation: iteration.observation.summary,
    selectedAction: iteration.selectedAction ? {
      nodeId: iteration.selectedAction.nodeId,
      description: iteration.selectedAction.description,
      requiredTools: [...iteration.selectedAction.requiredTools],
    } : undefined,
    toolCalls: iteration.toolCalls.map((call: any) => ({
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
    verification,
    reflectionSummary: iteration.reflection.summary,
    startedAt: iteration.startedAt,
    completedAt: iteration.completedAt,
  };
}

function capabilitiesFromEvents(events: readonly QuackEvent[], missionId?: string): MissionTraceCapability[] {
  return events
    .filter((event) => event.type.startsWith("capability."))
    .filter((event) => {
      const eventMission = valueAsString(event.payload["missionId"]);
      return !missionId || !eventMission || eventMission === missionId;
    })
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

function selectedSkillsFromEvents(events: readonly QuackEvent[]): MissionTraceSkillSelection[] {
  return events
    .filter((event) => event.type === "skill.selected")
    .flatMap((event) => {
      const decision = isJsonObject(event.payload["decision"]) ? event.payload["decision"] : undefined;
      const selected = decision?.["selected"];
      if (!Array.isArray(selected)) return [];
      return selected.flatMap((entry) => {
        if (!isJsonObject(entry)) return [];
        const skillId = valueAsString(entry["skillId"]);
        if (!skillId) return [];
        return [{
          skillId,
          version: valueAsString(entry["version"]),
          reason: valueAsString(event.payload["reason"]),
        }];
      });
    });
}

function eventToTrace(event: QuackEvent): MissionTraceEvent {
  return {
    type: event.type,
    timestamp: event.timestamp,
    actor: event.actor,
    taskId: event.taskId,
    payload: event.payload,
  };
}

function decisionFromPayload(event: QuackEvent): MissionTraceCapability["decision"] {
  if (event.type === "capability.allowed") return "allowed";
  if (event.type === "capability.denied") return "denied";
  if (event.type === "capability.checked") return "checked";
  if (event.type === "capability.requested") return "requested";
  const decision = valueAsString(event.payload["decision"]);
  if (decision === "allowed" || decision === "denied") return decision;
  return undefined;
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function elapsedMs(startedAt: string, completedAt: string): number {
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}
