import { createId, now, type IsoTimestamp, type JsonObject, type QuackResult, fail, ok } from "../core/types.js";
import type { CapabilityGrantRegistry, CapabilityGrantScopeRestrictions } from "../security/capability-broker.js";
import type { Permission } from "../security/permissions.js";
import type { Task } from "./task.js";
import type { RuntimeGoalOptions } from "./runtime.js";

/**
 * Governed delegation runtime (ADR 0035).
 *
 * Delegation reuses the canonical `QuackRuntime.submitGoal` path — a child is
 * an ordinary task of the same mission with its own derived capability grant.
 * There is no second orchestration path: the child executes through
 * QuackRuntime → SessionRuntime → DefaultLoopDriver → CapabilityBroker, and
 * its completion must carry the same evidence/verification/receipt chain as
 * any canonical mission.
 */

export type DelegationState = "REQUESTED" | "ACCEPTED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "BLOCKED" | "PARTIAL";

export interface DelegationRequest {
  /** Parent mission (grants are mission-bound; a child cannot change mission). */
  readonly missionId: string;
  /** Parent execution (task) identity requesting the delegation. */
  readonly parentExecutionId: string;
  readonly goal: string;
  readonly actor: string;
  /** Child agent identity; the derived grant is agent-scoped to it. */
  readonly agentId: string;
  /** Requested capabilities; must be a subset of the parent grant. */
  readonly capabilities: readonly string[];
  /** Requested scope; must be a subset of the parent grant scope. */
  readonly scope?: CapabilityGrantScopeRestrictions;
  readonly reason: string;
  readonly approvedBy: string;
  readonly signal?: AbortSignal;
  readonly deadline?: IsoTimestamp;
}

export interface DelegationRecord {
  readonly id: string;
  readonly missionId: string;
  readonly parentExecutionId: string;
  readonly childTaskId: string | null;
  readonly goal: string;
  readonly agentId: string;
  readonly depth: number;
  readonly grantId: string;
  readonly state: DelegationState;
  readonly reason: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  /** Child completion receipt chain, present only after verified completion. */
  readonly childReceipt?: JsonObject;
  readonly error?: string;
}

export interface DelegationRuntimeOptions {
  readonly maxDepth: number;
  /** Parent grant id that child grants derive from. */
  readonly parentGrantId: string;
  readonly grants: CapabilityGrantRegistry;
  readonly submit: (goal: string, actor: string, options: RuntimeGoalOptions) => Promise<QuackResult<Task>>;
  readonly onRecord?: (record: DelegationRecord) => void;
}

const DELEGATION_STATES: readonly DelegationState[] = ["REQUESTED", "ACCEPTED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED", "BLOCKED"];

export function isDelegationState(value: unknown): value is DelegationState {
  return typeof value === "string" && (DELEGATION_STATES as readonly string[]).includes(value);
}

export class DelegationRuntime {
  private readonly records = new Map<string, DelegationRecord>();

  constructor(private readonly options: DelegationRuntimeOptions) {}

  list(): readonly DelegationRecord[] {
    return [...this.records.values()];
  }

  get(id: string): DelegationRecord | undefined {
    return this.records.get(id);
  }

  /** Depth of the delegation chain containing the given execution, 0 for non-delegated executions. */
  depthOf(executionId: string): number {
    return this.records.get(executionId)?.depth ?? 0;
  }

  /**
   * Delegate a child execution under the parent's authority. The child grant
   * is derived from the parent grant (never widening capabilities or scope),
   * the child task runs through the canonical runtime, and its verified
   * completion receipt is attached before the parent may treat it as done.
   */
  async delegate(request: DelegationRequest): Promise<QuackResult<DelegationRecord>> {
    if (!request.goal?.trim()) return fail({ code: "delegation.goal_empty", message: "A delegated goal is required.", category: "validation", recoverable: false });
    if (!request.missionId?.trim() || !request.parentExecutionId?.trim() || !request.agentId?.trim() || !request.actor?.trim()) {
      return fail({ code: "delegation.identity_incomplete", message: "Delegation requires mission, parent execution, actor, and child agent identity.", category: "validation", recoverable: false });
    }
    if (request.capabilities.length === 0) {
      return fail({ code: "delegation.capabilities_empty", message: "Delegation requires at least one capability.", category: "validation", recoverable: false });
    }

    // Depth guard: the parent chain must stay inside the configured ceiling.
    const parentDepth = this.depthOf(request.parentExecutionId);
    const depth = parentDepth + 1;
    if (depth > this.options.maxDepth) {
      return fail({ code: "delegation.depth_exceeded", message: `Delegation depth ${depth} exceeds the maximum ${this.options.maxDepth}.`, category: "permission", recoverable: false });
    }

    // Duplicate guard: one active delegation per parent execution and goal.
    const duplicate = [...this.records.values()].find(record =>
      record.parentExecutionId === request.parentExecutionId && record.goal === request.goal
      && !["COMPLETED", "FAILED", "CANCELLED"].includes(record.state));
    if (duplicate) {
      return fail({ code: "delegation.duplicate", message: `An active delegation already exists for this parent execution and goal (${duplicate.id}, ${duplicate.state}).`, category: "runtime", recoverable: true });
    }

    if (request.deadline !== undefined && !Number.isFinite(Date.parse(request.deadline))) {
      return fail({ code: "delegation.deadline_invalid", message: "Delegation deadline is invalid.", category: "validation", recoverable: false });
    }

    // Attenuation: derive the child grant from the parent grant. The grant
    // registry enforces capability/scope/mission/agent subset rules and
    // throws when the child would exceed the parent's authority.
    let grantId: string;
    try {
      grantId = this.options.grants.deriveGrant(this.options.parentGrantId, {
        missionId: request.missionId,
        agentId: request.agentId,
        capabilities: [...request.capabilities],
        ...(request.scope ? { scope: request.scope } : {}),
        approval: { approvedBy: request.approvedBy, reason: request.reason, approvedAt: now() },
      }).id;
    } catch (error) {
      return fail({ code: "delegation.attenuation_denied", message: `Child authority exceeds the parent grant: ${error instanceof Error ? error.message : String(error)}.`, category: "permission", recoverable: false });
    }

    const id = createId("delegation");
    let record: DelegationRecord = {
      id, missionId: request.missionId, parentExecutionId: request.parentExecutionId, childTaskId: null,
      goal: request.goal, agentId: request.agentId, depth, grantId, state: "ACCEPTED",
      reason: request.reason, createdAt: now(), updatedAt: now(),
    };
    this.records.set(id, record);
    this.options.onRecord?.(record);

    record = { ...record, state: "RUNNING", updatedAt: now() };
    this.records.set(id, record);
    this.options.onRecord?.(record);

    const child = await this.options.submit(request.goal, request.actor, {
      missionId: request.missionId,
      agentId: request.agentId,
      signal: request.signal,
      deadline: request.deadline,
      origin: "system",
    });

    if (!child.ok) {
      const failed: DelegationRecord = { ...record, state: "FAILED", updatedAt: now(),
        error: child.error.message };
      this.records.set(id, failed);
      this.options.onRecord?.(failed);
      // The derived grant is revoked so a failed child leaves no authority residue.
      this.options.grants.revokeGrant(grantId, { revokedBy: "delegation-runtime", reason: "Child execution failed to start." });
      return fail({ code: "delegation.child_rejected", message: child.error.message, category: "runtime", recoverable: true });
    }

    const task = child.data;
    const finished: DelegationRecord = { ...record, childTaskId: task.id, updatedAt: now() };
    this.records.set(id, finished);
    this.options.onRecord?.(finished);

    if (task.status === "completed") {
      const receipt = task.result?.["receipt"] as JsonObject | undefined;
      const completed: DelegationRecord = { ...finished, state: "COMPLETED", updatedAt: now(),
        ...(receipt ? { childReceipt: receipt } : {}) };
      this.records.set(id, completed);
      this.options.onRecord?.(completed);
      this.options.grants.revokeGrant(grantId, { revokedBy: "delegation-runtime", reason: "Child execution completed." });
      return ok(completed);
    }

    const cancelled = request.signal?.aborted;
    const state: DelegationState = cancelled ? "CANCELLED" : task.status === "failed" ? "FAILED" : "BLOCKED";
    const terminal: DelegationRecord = { ...finished, state, updatedAt: now(),
      error: task.error?.["message"] as string | undefined };
    this.records.set(id, terminal);
    this.options.onRecord?.(terminal);
    this.options.grants.revokeGrant(grantId, { revokedBy: "delegation-runtime", reason: `Child execution ${state.toLowerCase()}.` });
    return ok(terminal);
  }
}

/** Validate that a child task result can be trusted by the parent: a durable receipt must cite the child execution. */
export function assertChildReceipt(task: Task): QuackResult<JsonObject> {
  if (task.status !== "completed") {
    return fail({ code: "delegation.child_incomplete", message: "Child execution did not complete.", category: "validation", recoverable: false });
  }
  const receipt = task.result?.["receipt"] as JsonObject | undefined;
  if (!receipt || receipt["evidenceId"] === undefined || receipt["verificationStatus"] !== "PASSED") {
    return fail({ code: "delegation.child_unverified", message: "Child completion has no verified durable receipt; the parent cannot trust it.", category: "validation", recoverable: false });
  }
  return ok(receipt);
}

/**
 * Deterministic semantics for fan-out aggregation (ADR 0036). The parent may
 * only COMPLETE when every required child produced a verified receipt.
 * Partial completion never silently marks the parent COMPLETE; outcomes are
 * reported exactly, and unresolved child work blocks parent completion.
 */
export interface FanOutRequest {
  readonly missionId: string;
  readonly parentExecutionId: string;
  readonly actor: string;
  readonly reason: string;
  readonly approvedBy: string;
  readonly signal?: AbortSignal;
  readonly deadline?: IsoTimestamp;
  /** Child delegations to run. Each entry derives its own attenuated grant. */
  readonly children: readonly {
    readonly agentId: string;
    readonly goal: string;
    readonly capabilities: readonly string[];
    readonly scope?: CapabilityGrantScopeRestrictions;
  }[];
}

export interface FanOutResult {
  readonly state: DelegationState;
  /** Per-child outcomes in request order; a denied/failed delegation start is recorded as FAILED. */
  readonly children: readonly {
    readonly agentId: string;
    readonly goal: string;
    readonly state: DelegationState;
    readonly receipt?: JsonObject;
    readonly error?: string;
  }[];
  /** True only when every child produced a verified receipt. */
  readonly complete: boolean;
}

export async function delegateFanOut(delegator: DelegationRuntime, request: FanOutRequest): Promise<FanOutResult> {
  if (request.children.length === 0) {
    return { state: "FAILED", children: [], complete: false };
  }
  const children: FanOutResult["children"][number][] = [];
  let allCompleted = true;
  for (const child of request.children) {
    if (request.signal?.aborted) {
      children.push({ agentId: child.agentId, goal: child.goal, state: "CANCELLED", error: "Fan-out cancelled before child start." });
      allCompleted = false;
      continue;
    }
    const result = await delegator.delegate({
      missionId: request.missionId,
      parentExecutionId: request.parentExecutionId,
      goal: child.goal,
      actor: request.actor,
      agentId: child.agentId,
      capabilities: child.capabilities,
      ...(child.scope ? { scope: child.scope } : {}),
      reason: request.reason,
      approvedBy: request.approvedBy,
      signal: request.signal,
      deadline: request.deadline,
    });
    if (!result.ok) {
      children.push({ agentId: child.agentId, goal: child.goal, state: "FAILED", error: result.error.message });
      allCompleted = false;
      continue;
    }
    const record = result.data;
    children.push({
      agentId: child.agentId, goal: child.goal, state: record.state,
      ...(record.childReceipt ? { receipt: record.childReceipt } : {}),
      ...(record.error ? { error: record.error } : {}),
    });
    if (record.state !== "COMPLETED") allCompleted = false;
  }
  return { state: allCompleted ? "COMPLETED" : "PARTIAL", children, complete: allCompleted };
}