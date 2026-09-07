import { createId, type IsoTimestamp, type JsonObject, type JsonValue } from "../../core/types.js";
import { type ActionProposal, type ActionOutcome } from "./action-contract.js";
import { type MissionState, type MissionTransition } from "./mission-state-machine.js";

/**
 * Canonical executive loop contract.
 *
 * The audit (`docs/production/EXECUTION_ARCHITECTURE_AUDIT.md` §3, §27.1)
 * found three competing executive loops (`Runtime.submitGoal`, `AgentLoop`,
 * `WorkflowEngine`) with three overlapping state models, no `run_id` /
 * `iteration_id` correlation beyond `taskId`, no structured stop reasons,
 * no stall detection, and a single-instance `AgentLoop.state` field shared
 * across concurrent missions (`agent-loop/index.ts:135`).
 *
 * This module is the canonical contract. It defines:
 *
 * - `LoopRun` — per-mission run record (one run per `AgentLoop.start`).
 *   Replaces the single-instance `state` field with a per-mission struct.
 * - `IterOrbiting OODA` phases — `OBSERVE | ORIENT | DECIDE | AUTHORIZE
 *   | ACT | VERIFY | LEARN` (prompt §3). Names track the prompt; the
 *   existing `AgentLoop` has `OBSERVING | PLANNING | EXECUTING |
 *   VERIFYING | REFLECTING` and a COMPLETED/FAILED wrap. The mapping
 *   is explicit below; subsequent phases migrate the existing code.
 * - `IterationRecord` — append-only per-iteration record carrying the
 *   full prompt §4 surface (observations, candidate actions, selected
 *   action + reason, permission decision, execution result, evaluation,
 *   state delta, memory delta, next step, stop reason).
 * - `StopReason` — typed terminal-cause enumeration.
 * - `Budget` and budget enforcement — `maxIterations`, `maxModelCalls`,
 *   `maxToolCalls`, `maxCost`, `maxExecutionTimeMs`, etc. (prompt §7).
 * - `StallSignature` — repeated action, repeated failure, planner
 *   oscillation (prompt §8). When detected, the loop must replan,
 *   fall back, request human, or terminate — never spin.
 *
 * Pure types + helpers. The contract is intentionally side-effect free
 * so phase-12 property tests can assert invariants against it without
 * driving the live runtime.
 *
 * See `docs/runtime/EXECUTIVE_LOOP_SPEC.md` for the OODA mapping,
 * budget semantics, stop-reason taxonomy, stall policy, and the
 * migration plan onto `AgentLoop`.
 */

export type LoopPhase =
  | "OBSERVE"
  | "ORIENT"
  | "DECIDE"
  | "AUTHORIZE"
  | "ACT"
  | "VERIFY"
  | "LEARN";

export const LOOP_PHASE_ORDER: readonly LoopPhase[] = [
  "OBSERVE", "ORIENT", "DECIDE", "AUTHORIZE", "ACT", "VERIFY", "LEARN",
];

export function nextLoopPhase(phase: LoopPhase): LoopPhase | undefined {
  const idx = LOOP_PHASE_ORDER.indexOf(phase);
  return idx >= 0 && idx < LOOP_PHASE_ORDER.length - 1 ? LOOP_PHASE_ORDER[idx + 1] : undefined;
}

/** Existing `AgentLoopState` → canonical `LoopPhase` mapping. */
export function phaseFromLegacyAgentLoopState(legacy: string): LoopPhase | undefined {
  switch (legacy) {
    case "OBSERVING": return "OBSERVE";
    case "PLANNING": return "ORIENT";
    case "EXECUTING": return "ACT";
    case "VERIFYING": return "VERIFY";
    case "REFLECTING": return "LEARN";
    default: return undefined;
  }
}

export type IterationDecision =
  | "PROCEED"
  | "REPLAN"
  | "WAIT"
  | "RETRY"
  | "BLOCK_FOR_HUMAN"
  | "STOP_FAIL"
  | "STOP_SUCCESS";

export type StopReason =
  | "STOP_GOAL_ACHIEVED"
  | "STOP_MAX_ITERATIONS"
  | "STOP_MAX_MODEL_CALLS"
  | "STOP_MAX_TOOL_CALLS"
  | "STOP_BUDGET_EXCEEDED"
  | "STOP_TIMEOUT"
  | "STOP_POLICY_DENIED"
  | "STOP_STALL_NO_PROGRESS"
  | "STOP_STALL_OSCILLATION"
  | "STOP_STALL_REPEATED_FAILURE"
  | "STOP_UNRECOVERABLE_ERROR"
  | "STOP_CANCELLED"
  | "STOP_HUMAN_ABORT";

export const TERMINAL_STOP_REASONS: ReadonlySet<StopReason> = new Set<StopReason>([
  "STOP_GOAL_ACHIEVED",
  "STOP_MAX_ITERATIONS",
  "STOP_MAX_MODEL_CALLS",
  "STOP_MAX_TOOL_CALLS",
  "STOP_BUDGET_EXCEEDED",
  "STOP_TIMEOUT",
  "STOP_STALL_NO_PROGRESS",
  "STOP_STALL_OSCILLATION",
  "STOP_STALL_REPEATED_FAILURE",
  "STOP_UNRECOVERABLE_ERROR",
  "STOP_CANCELLED",
  "STOP_HUMAN_ABORT",
]);

export function isTerminalStopReason(reason: StopReason): boolean {
  return TERMINAL_STOP_REASONS.has(reason);
}

export interface Budget {
  readonly maxIterations: number;
  readonly maxModelCalls?: number;
  readonly maxToolCalls?: number;
  readonly maxCost?: number;
  readonly maxExecutionTimeMs?: number;
  readonly maxConsecutiveFailures?: number;
  readonly maxReplans?: number;
}

export interface BudgetUsage {
  readonly iterations: number;
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly cost: number;
  readonly startedAt: IsoTimestamp;
  readonly consecutiveFailures: number;
  readonly replans: number;
}

export function emptyBudgetUsage(): BudgetUsage {
  return {
    iterations: 0,
    modelCalls: 0,
    toolCalls: 0,
    cost: 0,
    startedAt: new Date().toISOString(),
    consecutiveFailures: 0,
    replans: 0,
  };
}

export function recordModelCall(usage: BudgetUsage, cost = 0): BudgetUsage {
  return { ...usage, modelCalls: usage.modelCalls + 1, cost: usage.cost + cost };
}

export function recordToolCall(usage: BudgetUsage, cost = 0): BudgetUsage {
  return { ...usage, toolCalls: usage.toolCalls + 1, cost: usage.cost + cost };
}

export function recordFailure(usage: BudgetUsage): BudgetUsage {
  return { ...usage, consecutiveFailures: usage.consecutiveFailures + 1 };
}

export function recordRecoverableFailure(usage: BudgetUsage): BudgetUsage {
  return { ...usage, consecutiveFailures: 0 };
}

export function recordReplan(usage: BudgetUsage): BudgetUsage {
  return { ...usage, replans: usage.replans + 1 };
}

export function evaluateBudget(budget: Budget, usage: BudgetUsage, nowMs: number): StopReason | undefined {
  if (usage.iterations >= budget.maxIterations) return "STOP_MAX_ITERATIONS";
  if (budget.maxModelCalls !== undefined && usage.modelCalls >= budget.maxModelCalls) return "STOP_MAX_MODEL_CALLS";
  if (budget.maxToolCalls !== undefined && usage.toolCalls >= budget.maxToolCalls) return "STOP_MAX_TOOL_CALLS";
  if (budget.maxCost !== undefined && usage.cost >= budget.maxCost) return "STOP_BUDGET_EXCEEDED";
  if (budget.maxExecutionTimeMs !== undefined && nowMs - Date.parse(usage.startedAt) >= budget.maxExecutionTimeMs) return "STOP_TIMEOUT";
  if (budget.maxConsecutiveFailures !== undefined && usage.consecutiveFailures >= budget.maxConsecutiveFailures) return "STOP_UNRECOVERABLE_ERROR";
  if (budget.maxReplans !== undefined && usage.replans >= budget.maxReplans) return "STOP_STALL_NO_PROGRESS";
  return undefined;
}

/** A single signal that contributed to a stall classification. */
export interface StallSignal {
  readonly signature: string;
  readonly detail?: string;
  readonly observedAt: IsoTimestamp;
}

export type StallClassification =
  | "NO_PROGRESS"
  | "OSCILLATION"
  | "REPEATED_FAILURE"
  | "REPEATED_ACTION"
  | "REPEATED_PERMISSION_DENIED"
  | "NONE";

export interface StallSignature {
  readonly classification: StallClassification;
  readonly signals: readonly StallSignal[];
}

export interface StallDetectorInputs {
  readonly recentIterations: readonly IterationRecord[];
  readonly maxHistory?: number;
}

export function detectStall(inputs: StallDetectorInputs): StallSignature {
  const recent = inputs.recentIterations.slice(-(inputs.maxHistory ?? 10));
  const signals: StallSignal[] = [];

  if (recent.length < 2) return { classification: "NONE", signals };

  // Repeated action — same proposal capability ≥3 times in a row.
  const lastActions = recent
    .map((it) => it.selectedAction?.capability)
    .filter((c): c is string => typeof c === "string");
  if (lastActions.length >= 3) {
    const tail = lastActions.slice(-3);
    if (tail.every((c) => c === tail[0])) {
      signals.push({
        signature: "repeated_action",
        detail: `capability ${tail[0]} attempted ${tail.length} times in a row`,
        observedAt: new Date().toISOString(),
      });
    }
  }

  // Repeated failure — same failure signature ≥3 times.
  const recentFailures = recent
    .map((it) => it.executionErrorSignature)
    .filter((s): s is string => typeof s === "string");
  if (recentFailures.length >= 3) {
    const tail = recentFailures.slice(-3);
    if (tail.every((s) => s === tail[0])) {
      signals.push({
        signature: "repeated_failure",
        detail: `error signature ${tail[0]} appeared ${tail.length} times`,
        observedAt: new Date().toISOString(),
      });
    }
  }

  // Oscillation — A → B → A → B within the last 4 actions.
  if (lastActions.length >= 4) {
    const tail = lastActions.slice(-4);
    if (tail[0] === tail[2] && tail[1] === tail[3] && tail[0] !== tail[1]) {
      signals.push({
        signature: "oscillation",
        detail: `${tail[0]} ↔ ${tail[1]} cycle`,
        observedAt: new Date().toISOString(),
      });
    }
  }

  // No progress — last N iterations recorded no state delta and no memory delta.
  const progressless = recent.slice(-3);
  const madeProgress = progressless.some(
    (it) => it.stateDelta !== undefined || it.memoryDelta !== undefined,
  );
  if (progressless.length === 3 && !madeProgress) {
    signals.push({
      signature: "no_progress",
      detail: "last 3 iterations recorded no state or memory delta",
      observedAt: new Date().toISOString(),
    });
  }

  // Repeated permission denials.
  const recentDenials = recent
    .map((it) => it.permissionDecision?.decision)
    .filter((d): d is "DENIED" => d === "DENIED");
  if (recentDenials.length >= 3) {
    signals.push({
      signature: "repeated_permission_denied",
      detail: `${recentDenials.length} permission denials in the recent window`,
      observedAt: new Date().toISOString(),
    });
  }

  const classification =
    signals.find((s) => s.signature === "oscillation") ? "OSCILLATION"
    : signals.find((s) => s.signature === "repeated_action") ? "REPEATED_ACTION"
    : signals.find((s) => s.signature === "repeated_failure") ? "REPEATED_FAILURE"
    : signals.find((s) => s.signature === "repeated_permission_denied") ? "REPEATED_PERMISSION_DENIED"
    : signals.find((s) => s.signature === "no_progress") ? "NO_PROGRESS"
    : "NONE";
  return { classification, signals };
}

export function stopReasonForStall(signature: StallSignature): StopReason | undefined {
  switch (signature.classification) {
    case "OSCILLATION": return "STOP_STALL_OSCILLATION";
    case "NO_PROGRESS": return "STOP_STALL_NO_PROGRESS";
    case "REPEATED_FAILURE": return "STOP_STALL_REPEATED_FAILURE";
    case "REPEATED_ACTION": return "STOP_STALL_NO_PROGRESS";
    case "REPEATED_PERMISSION_DENIED": return "STOP_POLICY_DENIED";
    default: return undefined;
  }
}

export interface PermissionDecision {
  readonly decision: "ALLOWED" | "DENIED" | "BLOCKED_FOR_HUMAN";
  readonly scope?: string;
  readonly reason: string;
  readonly approvalId?: string;
}

export interface IterationRecord {
  readonly runId: string;
  readonly missionId: string;
  readonly iterationId: string;
  readonly index: number;
  readonly startedAt: IsoTimestamp;
  readonly completedAt: IsoTimestamp;

  readonly phase: LoopPhase;
  readonly goal: string;
  readonly observations: JsonObject;
  readonly workingContext: JsonObject;
  readonly relevantMemory?: JsonValue;
  readonly candidateActions: readonly string[];
  readonly selectedAction?: ActionProposal;
  readonly selectionReason?: string;
  readonly permissionDecision?: PermissionDecision;
  readonly executionResult?: ActionOutcome;
  readonly verification?: { readonly status: string; readonly message: string; readonly failures?: readonly string[] };
  readonly evaluation?: { readonly verdict: string; readonly confidence: number; readonly message: string };
  readonly stateDelta?: JsonValue;
  readonly memoryDelta?: JsonValue;
  readonly nextStep?: IterationDecision;
  readonly stopReason?: StopReason;

  /**
   * Stable signature of the error from the execution result. Stored on the
   * iteration so the stall detector can group repeated failures without
   * holding the full error payload.
   */
  readonly executionErrorSignature?: string;
}

export interface LoopRun {
  readonly runId: string;
  readonly missionId: string;
  readonly goal: string;
  readonly actor: string;
  readonly origin?: string;
  readonly startedAt: IsoTimestamp;
  readonly endedAt?: IsoTimestamp;
  readonly budget: Budget;
  readonly usage: BudgetUsage;
  readonly iterations: readonly IterationRecord[];
  readonly currentPhase: LoopPhase | undefined;
  readonly currentState: MissionState | undefined;
  readonly lastTransition?: MissionTransition;
  readonly stopReason?: StopReason;
}

export function createLoopRun(params: {
  missionId: string;
  goal: string;
  actor: string;
  origin?: string;
  budget: Budget;
}): LoopRun {
  return {
    runId: createId("run"),
    missionId: params.missionId,
    goal: params.goal,
    actor: params.actor,
    origin: params.origin,
    startedAt: new Date().toISOString(),
    budget: params.budget,
    usage: emptyBudgetUsage(),
    iterations: [],
    currentPhase: undefined,
    currentState: undefined,
  };
}

export function appendIteration(run: LoopRun, iteration: IterationRecord): LoopRun {
  const iterations = [...run.iterations, iteration];
  const usage: BudgetUsage = {
    ...run.usage,
    iterations: iterations.length,
    consecutiveFailures: iteration.executionResult?.actionResult?.status === "SUCCEEDED"
      ? 0
      : run.usage.consecutiveFailures + (iteration.executionResult !== undefined ? 1 : 0),
  };
  return { ...run, iterations, usage, currentPhase: iteration.phase };
}

export function applyTransition(run: LoopRun, transition: MissionTransition, state: MissionState): LoopRun {
  return { ...run, lastTransition: transition, currentState: state };
}

export function terminateRun(run: LoopRun, reason: StopReason): LoopRun {
  return { ...run, stopReason: reason, endedAt: new Date().toISOString() };
}

export function createIterationId(): string {
  return createId("it");
}
