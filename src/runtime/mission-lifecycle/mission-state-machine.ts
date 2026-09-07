import { now, type IsoTimestamp } from "../../core/types.js";

/**
 * Canonical QUACK mission lifecycle state machine.
 *
 * Single source of truth for mission lifecycle states + transitions.
 * Existing soft state models (`MissionDefinition.status`, `Task.status`,
 * `AgentLoopState`, company `MissionCompanyRecordV1.state`) either map onto
 * this contract or are superseded by callers that route through these
 * transitions. No other module may invent mission states.
 *
 * Illegal transitions throw `IllegalMissionTransitionError`. Every legal
 * transition emits a typed `MissionTransition` record that callers persist /
 * surface through the event bus.
 *
 * See docs/runtime/MISSION_STATE_MACHINE.md for the transition table, side
 * effects, persisted data, emitted events, recovery paths, and the rationale
 * for each state. This module is the executable form of that spec.
 */

export type MissionState =
  | "CREATED"
  | "QUEUED"
  | "STARTING"
  | "RUNNING"
  | "WAITING"
  | "INTERRUPTED"
  | "RECOVERING"
  | "BLOCKED"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";

export const TERMINAL_MISSION_STATES: ReadonlySet<MissionState> = new Set([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
]);

export const AMBIGUOUS_MISSION_STATES: ReadonlySet<MissionState> = new Set([
  "RUNNING",
  "STARTING",
  "WAITING",
  "INTERRUPTED",
  "RECOVERING",
]);

export type MissionTransitionTrigger =
  | "enqueue"
  | "start"
  | "wait"
  | "resume"
  | "interrupt"
  | "recover"
  | "block"
  | "unblock"
  | "succeed"
  | "fail"
  | "cancel"
  | "timeout";

export interface MissionTransition {
  readonly missionId: string;
  readonly from: MissionState;
  readonly to: MissionState;
  readonly trigger: MissionTransitionTrigger;
  readonly reason?: string;
  readonly occurredAt: IsoTimestamp;
}

interface TransitionRule {
  readonly to: MissionState;
  readonly trigger: MissionTransitionTrigger;
}

const TRANSITIONS: ReadonlyMap<MissionState, ReadonlyArray<TransitionRule>> = new Map([
  ["CREATED", [
    { to: "QUEUED", trigger: "enqueue" },
    { to: "CANCELLED", trigger: "cancel" },
    { to: "FAILED", trigger: "fail" },
  ]],
  ["QUEUED", [
    { to: "STARTING", trigger: "start" },
    { to: "CANCELLED", trigger: "cancel" },
    { to: "FAILED", trigger: "fail" },
    { to: "TIMED_OUT", trigger: "timeout" },
  ]],
  ["STARTING", [
    { to: "RUNNING", trigger: "start" },
    { to: "FAILED", trigger: "fail" },
    { to: "CANCELLED", trigger: "cancel" },
    { to: "INTERRUPTED", trigger: "interrupt" },
    { to: "TIMED_OUT", trigger: "timeout" },
  ]],
  ["RUNNING", [
    { to: "WAITING", trigger: "wait" },
    { to: "SUCCEEDED", trigger: "succeed" },
    { to: "FAILED", trigger: "fail" },
    { to: "BLOCKED", trigger: "block" },
    { to: "INTERRUPTED", trigger: "interrupt" },
    { to: "CANCELLED", trigger: "cancel" },
    { to: "TIMED_OUT", trigger: "timeout" },
  ]],
  ["WAITING", [
    { to: "RUNNING", trigger: "resume" },
    { to: "BLOCKED", trigger: "block" },
    { to: "INTERRUPTED", trigger: "interrupt" },
    { to: "CANCELLED", trigger: "cancel" },
    { to: "TIMED_OUT", trigger: "timeout" },
    { to: "FAILED", trigger: "fail" },
  ]],
  ["INTERRUPTED", [
    { to: "RECOVERING", trigger: "recover" },
    { to: "FAILED", trigger: "fail" },
    { to: "CANCELLED", trigger: "cancel" },
  ]],
  ["RECOVERING", [
    { to: "RUNNING", trigger: "resume" },
    { to: "WAITING", trigger: "wait" },
    { to: "BLOCKED", trigger: "block" },
    { to: "FAILED", trigger: "fail" },
    { to: "CANCELLED", trigger: "cancel" },
  ]],
  ["BLOCKED", [
    { to: "RUNNING", trigger: "unblock" },
    { to: "WAITING", trigger: "wait" },
    { to: "FAILED", trigger: "fail" },
    { to: "CANCELLED", trigger: "cancel" },
    { to: "TIMED_OUT", trigger: "timeout" },
  ]],
]);

export class IllegalMissionTransitionError extends Error {
  readonly from: MissionState;
  readonly to: MissionState;
  readonly trigger: MissionTransitionTrigger;
  constructor(from: MissionState, to: MissionState, trigger: MissionTransitionTrigger) {
    super(`Illegal mission transition: ${from} --(${trigger})--> ${to}`);
    this.name = "IllegalMissionTransitionError";
    this.from = from;
    this.to = to;
    this.trigger = trigger;
  }
}

export function isLegalMissionTransition(from: MissionState, to: MissionState): boolean {
  const rules = TRANSITIONS.get(from);
  return rules !== undefined && rules.some((rule) => rule.to === to);
}

export function legalMissionTransitions(from: MissionState): readonly TransitionRule[] {
  return TRANSITIONS.get(from) ?? [];
}

export function isTerminalMissionState(state: MissionState): boolean {
  return TERMINAL_MISSION_STATES.has(state);
}

export function isAmbiguousMissionState(state: MissionState): boolean {
  return AMBIGUOUS_MISSION_STATES.has(state);
}

export function assertMissionTransition(
  from: MissionState,
  to: MissionState,
  trigger: MissionTransitionTrigger,
): void {
  const rules = TRANSITIONS.get(from);
  if (rules === undefined || !rules.some((rule) => rule.to === to && rule.trigger === trigger)) {
    throw new IllegalMissionTransitionError(from, to, trigger);
  }
}

export function planMissionTransition(
  missionId: string,
  from: MissionState,
  to: MissionState,
  trigger: MissionTransitionTrigger,
  reason?: string,
): MissionTransition {
  assertMissionTransition(from, to, trigger);
  return { missionId, from, to, trigger, reason, occurredAt: now() };
}

/**
 * Legacy `MissionDefinition.status` ("draft"|"active"|"completed"|"failed")
 * <-> canonical `MissionState` mapping. Used at the persistence boundary so
 * existing SQLite rows stay readable across the hardening migration without
 * a schema rewrite. New code stores the canonical state directly.
 */
export function missionStateFromLegacyStatus(legacy: string): MissionState {
  switch (legacy) {
    case "draft": return "CREATED";
    case "active": return "RUNNING";
    case "completed": return "SUCCEEDED";
    case "failed": return "FAILED";
    default: return "CREATED";
  }
}

export function legacyStatusFromMissionState(state: MissionState): "draft" | "active" | "completed" | "failed" {
  switch (state) {
    case "CREATED":
    case "QUEUED":
    case "STARTING":
    case "WAITING":
    case "INTERRUPTED":
    case "RECOVERING":
    case "BLOCKED":
      return "active";
    case "RUNNING":
      return "active";
    case "SUCCEEDED":
      return "completed";
    case "FAILED":
    case "TIMED_OUT":
      return "failed";
    case "CANCELLED":
      return "failed";
    default:
      return "draft";
  }
}
