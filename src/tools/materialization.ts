import { createId, type IsoTimestamp, type JsonObject, type QuackResult, fail } from "../core/types.js";
import type { RetrySafety } from "../engine/execution-recovery.js";
import type { ToolInvocation, ToolInvocationExecutionContext, ToolInvocationOutcome, ToolInvocationExecutor } from "./tool.js";

/**
 * Unified executable representation of a tool or provider operation.
 *
 * Materialization makes the full governed identity of an executable explicit
 * so that no provider or tool can manufacture authority, reuse a foreign
 * identity, or omit the capability envelope. Every executable operation must
 * pass through the capability broker before it is dispatched; this contract
 * is the frozen identity record that broker resolution and dispatch share.
 */
export interface ToolMaterialization {
  readonly contractVersion: 1;
  /** Stable identity of the executable. */
  readonly toolId: string;
  /** Provider owning the tool, when the tool wraps a provider operation. */
  readonly providerId?: string;
  readonly providerVersion?: string;
  /** Capability id that authorizes execution (e.g. `permission.workspace.read`). */
  readonly capabilityId: string;
  readonly retrySafety: RetrySafety;
  readonly identity: {
    readonly missionId: string;
    readonly taskId: string;
    readonly executionId: string;
    readonly sessionId: string;
    readonly actor: string;
    readonly agentId?: string;
    readonly skillId?: string;
    readonly namespace?: string;
    readonly operationId: string;
  };
  readonly deadline?: IsoTimestamp;
  readonly cancellation?: AbortSignal;
  readonly provenance: {
    readonly toolId: string;
    readonly providerId?: string;
    readonly providerVersion?: string;
    readonly source: "runtime" | "extension" | "plugin";
  };
}

export interface MaterializeToolInput {
  readonly toolId: string;
  readonly providerId?: string;
  readonly providerVersion?: string;
  readonly capabilityId: string;
  readonly retrySafety: RetrySafety;
  readonly missionId: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly sessionId: string;
  readonly actor: string;
  readonly agentId?: string;
  readonly skillId?: string;
  readonly namespace?: string;
  readonly operationId?: string;
  readonly deadline?: IsoTimestamp;
  readonly cancellation?: AbortSignal;
  readonly source?: "runtime" | "extension" | "plugin";
}

/**
 * Build a frozen, validated executable representation of a tool. Rejects
 * invalid or inconsistent identity so a provider cannot substitute a foreign
 * mission/execution/actor, drop its capability, or omit retry safety.
 */
export function materializeTool(input: MaterializeToolInput): QuackResult<ToolMaterialization> {
  if (!input.toolId?.trim() || !input.capabilityId?.trim() || !input.missionId?.trim() || !input.taskId?.trim()
    || !input.executionId?.trim() || !input.sessionId?.trim() || !input.actor?.trim()) {
    return fail({ code: "tool.materialization_identity_incomplete", message: "Tool materialization requires tool, capability, mission, task, execution, session, and actor identity.", category: "validation", recoverable: false });
  }
  if (!["READ_ONLY", "IDEMPOTENT_WRITE", "NON_IDEMPOTENT_WRITE", "DESTRUCTIVE", "UNKNOWN"].includes(input.retrySafety)) {
    return fail({ code: "tool.materialization_retry_safety_invalid", message: `Tool ${input.toolId} declares invalid retry safety.`, category: "validation", recoverable: false });
  }
  if (input.deadline !== undefined && !Number.isFinite(Date.parse(input.deadline))) {
    return fail({ code: "tool.materialization_deadline_invalid", message: `Tool ${input.toolId} materialization has an invalid deadline.`, category: "validation", recoverable: false });
  }
  const materialization: ToolMaterialization = Object.freeze({
    contractVersion: 1,
    toolId: input.toolId,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.providerVersion ? { providerVersion: input.providerVersion } : {}),
    capabilityId: input.capabilityId,
    retrySafety: input.retrySafety,
    identity: Object.freeze({
      missionId: input.missionId,
      taskId: input.taskId,
      executionId: input.executionId,
      sessionId: input.sessionId,
      actor: input.actor,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.skillId ? { skillId: input.skillId } : {}),
      ...(input.namespace ? { namespace: input.namespace } : {}),
      operationId: input.operationId ?? createId("tool-op"),
    }),
    ...(input.deadline ? { deadline: input.deadline } : {}),
    ...(input.cancellation ? { cancellation: input.cancellation } : {}),
    provenance: Object.freeze({
      toolId: input.toolId,
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.providerVersion ? { providerVersion: input.providerVersion } : {}),
      source: input.source ?? "runtime",
    }),
  });
  return { ok: true, data: materialization };
}

export interface GovernedToolDispatchInput {
  readonly materialization: ToolMaterialization;
  readonly invocation: ToolInvocation;
}

export interface GovernedToolDispatchResult {
  readonly materialization: ToolMaterialization;
  readonly outcome: ToolInvocationOutcome;
}

/**
 * Governed dispatch boundary for a materialized tool. The executor runs the
 * actual operation; authority is enforced by the caller (the runtime) through
 * the capability broker before this function is invoked. This boundary exists
 * to keep materialization (identity) separate from dispatch (execution) so a
 * provider can never bypass the runtime's capability check.
 */
export function createGovernedToolExecutor(
  materialization: ToolMaterialization,
  executor: ToolInvocationExecutor,
): ToolInvocationExecutor {
  return (invocation: ToolInvocation, context: ToolInvocationExecutionContext): Promise<ToolInvocationOutcome> => {
    if (invocation.toolId !== materialization.toolId) {
      return Promise.resolve({ toolId: materialization.toolId, success: false, error: "Materialized tool identity mismatch at dispatch." });
    }
    if (context.signal?.aborted) {
      return Promise.resolve({ toolId: materialization.toolId, success: false, error: "Tool dispatch cancelled." });
    }
    return executor(invocation, {
      ...context,
      taskId: materialization.identity.taskId,
      actor: materialization.identity.actor,
      signal: materialization.cancellation ?? context.signal,
      deadline: materialization.deadline ?? context.deadline,
      sessionId: materialization.identity.sessionId,
      idempotencyKey: context.idempotencyKey ?? materialization.identity.operationId,
    });
  };
}

/** Human/JSON-safe projection of a materialization (no live AbortSignal). */
export function materializationSnapshot(materialization: ToolMaterialization): JsonObject {
  return {
    contractVersion: materialization.contractVersion,
    toolId: materialization.toolId,
    providerId: materialization.providerId ?? null,
    providerVersion: materialization.providerVersion ?? null,
    capabilityId: materialization.capabilityId,
    retrySafety: materialization.retrySafety,
    identity: {
      missionId: materialization.identity.missionId,
      taskId: materialization.identity.taskId,
      executionId: materialization.identity.executionId,
      sessionId: materialization.identity.sessionId,
      actor: materialization.identity.actor,
      agentId: materialization.identity.agentId ?? null,
      skillId: materialization.identity.skillId ?? null,
      namespace: materialization.identity.namespace ?? null,
      operationId: materialization.identity.operationId,
    },
    deadline: materialization.deadline ?? null,
    provenance: { ...materialization.provenance },
  };
}