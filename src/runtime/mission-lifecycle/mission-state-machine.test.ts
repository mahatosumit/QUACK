import assert from "node:assert/strict";
import test from "node:test";
import {
  AMBIGUOUS_MISSION_STATES,
  IllegalMissionTransitionError,
  TERMINAL_MISSION_STATES,
  assertMissionTransition,
  isAmbiguousMissionState,
  isLegalMissionTransition,
  isTerminalMissionState,
  legalMissionTransitions,
  legacyStatusFromMissionState,
  missionStateFromLegacyStatus,
  planMissionTransition,
  type MissionState,
  type MissionTransitionTrigger,
} from "./mission-state-machine.js";

const LEGAL_TRANSITIONS: ReadonlyArray<{ from: MissionState; to: MissionState; trigger: MissionTransitionTrigger }> = [
  { from: "CREATED", to: "QUEUED", trigger: "enqueue" },
  { from: "CREATED", to: "CANCELLED", trigger: "cancel" },
  { from: "CREATED", to: "FAILED", trigger: "fail" },
  { from: "QUEUED", to: "STARTING", trigger: "start" },
  { from: "QUEUED", to: "CANCELLED", trigger: "cancel" },
  { from: "QUEUED", to: "FAILED", trigger: "fail" },
  { from: "QUEUED", to: "TIMED_OUT", trigger: "timeout" },
  { from: "STARTING", to: "RUNNING", trigger: "start" },
  { from: "STARTING", to: "FAILED", trigger: "fail" },
  { from: "STARTING", to: "CANCELLED", trigger: "cancel" },
  { from: "STARTING", to: "INTERRUPTED", trigger: "interrupt" },
  { from: "STARTING", to: "TIMED_OUT", trigger: "timeout" },
  { from: "RUNNING", to: "WAITING", trigger: "wait" },
  { from: "RUNNING", to: "SUCCEEDED", trigger: "succeed" },
  { from: "RUNNING", to: "FAILED", trigger: "fail" },
  { from: "RUNNING", to: "BLOCKED", trigger: "block" },
  { from: "RUNNING", to: "INTERRUPTED", trigger: "interrupt" },
  { from: "RUNNING", to: "CANCELLED", trigger: "cancel" },
  { from: "RUNNING", to: "TIMED_OUT", trigger: "timeout" },
  { from: "WAITING", to: "RUNNING", trigger: "resume" },
  { from: "WAITING", to: "BLOCKED", trigger: "block" },
  { from: "WAITING", to: "INTERRUPTED", trigger: "interrupt" },
  { from: "WAITING", to: "CANCELLED", trigger: "cancel" },
  { from: "WAITING", to: "TIMED_OUT", trigger: "timeout" },
  { from: "WAITING", to: "FAILED", trigger: "fail" },
  { from: "INTERRUPTED", to: "RECOVERING", trigger: "recover" },
  { from: "INTERRUPTED", to: "FAILED", trigger: "fail" },
  { from: "INTERRUPTED", to: "CANCELLED", trigger: "cancel" },
  { from: "RECOVERING", to: "RUNNING", trigger: "resume" },
  { from: "RECOVERING", to: "WAITING", trigger: "wait" },
  { from: "RECOVERING", to: "BLOCKED", trigger: "block" },
  { from: "RECOVERING", to: "FAILED", trigger: "fail" },
  { from: "RECOVERING", to: "CANCELLED", trigger: "cancel" },
  { from: "BLOCKED", to: "RUNNING", trigger: "unblock" },
  { from: "BLOCKED", to: "WAITING", trigger: "wait" },
  { from: "BLOCKED", to: "FAILED", trigger: "fail" },
  { from: "BLOCKED", to: "CANCELLED", trigger: "cancel" },
  { from: "BLOCKED", to: "TIMED_OUT", trigger: "timeout" },
];

const ALL_STATES: readonly MissionState[] = [
  "CREATED", "QUEUED", "STARTING", "RUNNING", "WAITING",
  "INTERRUPTED", "RECOVERING", "BLOCKED",
  "SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT",
];

const ALL_TRIGGERS: readonly MissionTransitionTrigger[] = [
  "enqueue", "start", "wait", "resume", "interrupt", "recover",
  "block", "unblock", "succeed", "fail", "cancel", "timeout",
];

test("every legal transition returns a MissionTransition", () => {
  for (const { from, to, trigger } of LEGAL_TRANSITIONS) {
    const transition = planMissionTransition("mission-1", from, to, trigger, "test");
    assert.equal(transition.from, from);
    assert.equal(transition.to, to);
    assert.equal(transition.trigger, trigger);
    assert.equal(transition.missionId, "mission-1");
    assert.equal(transition.reason, "test");
    assert.ok(typeof transition.occurredAt === "string" && transition.occurredAt.length > 0);
  }
});

test("every transition not in the table throws IllegalMissionTransitionError", () => {
  for (const from of ALL_STATES) {
    for (const to of ALL_STATES) {
      for (const trigger of ALL_TRIGGERS) {
        const legal = LEGAL_TRANSITIONS.some(
          (rule) => rule.from === from && rule.to === to && rule.trigger === trigger,
        );
        if (legal) continue;
        assert.throws(
          () => assertMissionTransition(from, to, trigger),
          (err: unknown) => err instanceof IllegalMissionTransitionError
            && err.from === from && err.to === to && err.trigger === trigger,
          `expected illegal ${from} --(${trigger})--> ${to} to throw`,
        );
      }
    }
  }
});

test("terminal states have no legal outgoing transitions", () => {
  for (const terminal of TERMINAL_MISSION_STATES) {
    assert.equal(legalMissionTransitions(terminal).length, 0,
      `${terminal} must have zero outgoing transitions`);
    for (const to of ALL_STATES) {
      assert.equal(isLegalMissionTransition(terminal, to), false,
        `${terminal} -> ${to} must be illegal`);
    }
  }
});

test("a cancelled mission cannot launch a new action", () => {
  assert.equal(isLegalMissionTransition("CANCELLED", "RUNNING"), false);
  assert.equal(isLegalMissionTransition("CANCELLED", "WAITING"), false);
  assert.throws(() => assertMissionTransition("CANCELLED", "RUNNING", "resume"));
});

test("a terminal mission cannot return to RUNNING", () => {
  for (const terminal of TERMINAL_MISSION_STATES) {
    assert.throws(() => assertMissionTransition(terminal, "RUNNING", "resume"));
    assert.throws(() => assertMissionTransition(terminal, "RUNNING", "start"));
    assert.throws(() => assertMissionTransition(terminal, "RUNNING", "unblock"));
  }
});

test("INTERRUPTED cannot resume directly to RUNNING — must pass through RECOVERING", () => {
  assert.throws(() => assertMissionTransition("INTERRUPTED", "RUNNING", "resume"));
  assert.throws(() => assertMissionTransition("INTERRUPTED", "RUNNING", "start"));
  assert.ok(isLegalMissionTransition("INTERRUPTED", "RECOVERING"));
  assert.ok(isLegalMissionTransition("RECOVERING", "RUNNING"));
});

test("WAITING cannot succeed directly — must resume to RUNNING first", () => {
  assert.throws(() => assertMissionTransition("WAITING", "SUCCEEDED", "succeed"));
  assert.ok(isLegalMissionTransition("WAITING", "RUNNING"));
  assert.ok(isLegalMissionTransition("RUNNING", "SUCCEEDED"));
});

test("isTerminalMissionState and isAmbiguousMissionState partition states", () => {
  for (const state of ALL_STATES) {
    if (TERMINAL_MISSION_STATES.has(state)) {
      assert.equal(isTerminalMissionState(state), true);
      assert.equal(isAmbiguousMissionState(state), false);
    } else if (AMBIGUOUS_MISSION_STATES.has(state)) {
      assert.equal(isTerminalMissionState(state), false);
      assert.equal(isAmbiguousMissionState(state), true);
    }
  }
});

test("legacy status <-> canonical state round-trip preserves membership buckets", () => {
  for (const state of ALL_STATES) {
    const legacy = legacyStatusFromMissionState(state);
    const back = missionStateFromLegacyStatus(legacy);
    if (TERMINAL_MISSION_STATES.has(state)) {
      assert.equal(["completed", "failed"].includes(legacy), true, `terminal ${state} must map to completed/failed`);
      assert.equal(TERMINAL_MISSION_STATES.has(back) || back === "CREATED", true);
    }
  }
});

test("CREATED is the default for unknown legacy status", () => {
  assert.equal(missionStateFromLegacyStatus("nonexistent"), "CREATED");
});

test("legalMissionTransitions exposes the full rule set for each state", () => {
  for (const state of ALL_STATES) {
    const rules = legalMissionTransitions(state);
    const expected = LEGAL_TRANSITIONS.filter((rule) => rule.from === state);
    assert.equal(rules.length, expected.length,
      `${state}: expected ${expected.length} legal transitions, got ${rules.length}`);
  }
});
