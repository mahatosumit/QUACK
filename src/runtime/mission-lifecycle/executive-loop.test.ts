import assert from "node:assert/strict";
import test from "node:test";
import {
  type Budget,
  type BudgetUsage,
  type IterationRecord,
  type LoopPhase,
  type LoopRun,
  type PermissionDecision,
  type StopReason,
  LOOP_PHASE_ORDER,
  appendIteration,
  applyTransition,
  createIterationId,
  createLoopRun,
  detectStall,
  emptyBudgetUsage,
  evaluateBudget,
  isTerminalStopReason,
  nextLoopPhase,
  phaseFromLegacyAgentLoopState,
  recordFailure,
  recordModelCall,
  recordRecoverableFailure,
  recordReplan,
  recordToolCall,
  stopReasonForStall,
  terminateRun,
  type StallClassification,
} from "./executive-loop.js";
import type { ActionOutcome } from "./action-contract.js";
import { assertMissionTransition, type MissionState, type MissionTransition } from "./mission-state-machine.js";

function baseRun(budget: Partial<Budget> = {}): LoopRun {
  return createLoopRun({
    missionId: "mission-1",
    goal: "investigate cell 4",
    actor: "agent-loop",
    budget: { maxIterations: 5, ...budget },
  });
}

function iterationFixture(params: {
  readonly index: number;
  readonly phase: LoopPhase;
  readonly capability?: string;
  readonly errorSignature?: string;
  readonly permissionDecision?: PermissionDecision;
  readonly stateDelta?: unknown;
  readonly memoryDelta?: unknown;
  readonly runId?: string;
}): IterationRecord {
  const id = createIterationId();
  const startedAt = new Date(2026, 0, 1, 0, 0, params.index).toISOString();
  return {
    runId: params.runId ?? "run-1",
    missionId: "mission-1",
    iterationId: id,
    index: params.index,
    startedAt,
    completedAt: startedAt,
    phase: params.phase,
    goal: "investigate cell 4",
    observations: {},
    workingContext: {},
    candidateActions: params.capability ? [params.capability] : [],
    selectedAction: params.capability
      ? {
        id,
        missionId: "mission-1",
        capability: params.capability,
        arguments: {},
        intent: "",
        riskLevel: "REVERSIBLE" as never,
        sandbox: "IN_PROCESS_TRUSTED" as never,
        timeoutMs: 1000,
        selectionReason: "",
        proposedAt: startedAt,
        proposedBy: "agent-loop",
      }
      : undefined,
    executionErrorSignature: params.errorSignature,
    permissionDecision: params.permissionDecision,
    stateDelta: params.stateDelta,
    memoryDelta: params.memoryDelta,
  } as IterationRecord;
}

test("createLoopRun assigns a run id and zero-budget usage", () => {
  const run = baseRun();
  assert.ok(run.runId.startsWith("run"));
  assert.equal(run.iterations.length, 0);
  assert.equal(run.usage.iterations, 0);
  assert.equal(run.usage.consecutiveFailures, 0);
  assert.equal(run.currentPhase, undefined);
});

test("nextLoopPhase walks the OODA order and stops at the end", () => {
  assert.equal(nextLoopPhase("OBSERVE"), "ORIENT");
  assert.equal(nextLoopPhase("LEARN"), undefined);
  assert.equal(LOOP_PHASE_ORDER.length, 7);
});

test("phaseFromLegacyAgentLoopState maps every legacy phase onto a canonical phase", () => {
  assert.equal(phaseFromLegacyAgentLoopState("OBSERVING"), "OBSERVE");
  assert.equal(phaseFromLegacyAgentLoopState("PLANNING"), "ORIENT");
  assert.equal(phaseFromLegacyAgentLoopState("EXECUTING"), "ACT");
  assert.equal(phaseFromLegacyAgentLoopState("VERIFYING"), "VERIFY");
  assert.equal(phaseFromLegacyAgentLoopState("REFLECTING"), "LEARN");
  assert.equal(phaseFromLegacyAgentLoopState("IDLE"), undefined);
});

test("evaluateBudget triggers STOP_MAX_ITERATIONS when usage.iterations reaches the cap", () => {
  const budget: Budget = { maxIterations: 3 };
  const usage: BudgetUsage = { ...emptyBudgetUsage(), iterations: 3 };
  assert.equal(evaluateBudget(budget, usage, Date.parse(usage.startedAt)), "STOP_MAX_ITERATIONS");
});

test("evaluateBudget triggers STOP_MAX_MODEL_CALLS once modelCalls hits the limit", () => {
  const budget: Budget = { maxIterations: 10, maxModelCalls: 2 };
  let usage = emptyBudgetUsage();
  usage = recordModelCall(usage, 0.05);
  usage = recordModelCall(usage, 0.05);
  assert.equal(evaluateBudget(budget, usage, Date.parse(usage.startedAt)), "STOP_MAX_MODEL_CALLS");
});

test("evaluateBudget triggers STOP_MAX_TOOL_CALLS once toolCalls hits the limit", () => {
  const budget: Budget = { maxIterations: 10, maxToolCalls: 2 };
  let usage = emptyBudgetUsage();
  usage = recordToolCall(usage);
  usage = recordToolCall(usage);
  assert.equal(evaluateBudget(budget, usage, Date.parse(usage.startedAt)), "STOP_MAX_TOOL_CALLS");
});

test("evaluateBudget triggers STOP_BUDGET_EXCEEDED on cost cap", () => {
  const budget: Budget = { maxIterations: 10, maxCost: 0.05 };
  let usage: BudgetUsage = emptyBudgetUsage();
  usage = recordModelCall(usage, 0.06);
  assert.equal(evaluateBudget(budget, usage, Date.parse(usage.startedAt)), "STOP_BUDGET_EXCEEDED");
});

test("evaluateBudget triggers STOP_TIMEOUT once wall clock exceeds maxExecutionTimeMs", () => {
  const budget: Budget = { maxIterations: 10, maxExecutionTimeMs: 1000 };
  const startedAt = new Date(Date.now() - 2000).toISOString();
  const usage: BudgetUsage = { ...emptyBudgetUsage(), startedAt };
  assert.equal(evaluateBudget(budget, usage, Date.now()), "STOP_TIMEOUT");
});

test("evaluateBudget triggers STOP_UNRECOVERABLE_ERROR on consecutive failures", () => {
  const budget: Budget = { maxIterations: 10, maxConsecutiveFailures: 3 };
  let usage: BudgetUsage = emptyBudgetUsage();
  usage = recordFailure(usage);
  usage = recordFailure(usage);
  usage = recordFailure(usage);
  assert.equal(evaluateBudget(budget, usage, Date.parse(usage.startedAt)), "STOP_UNRECOVERABLE_ERROR");
});

test("recordRecoverableFailure resets the consecutive failure counter", () => {
  let usage: BudgetUsage = emptyBudgetUsage();
  usage = recordFailure(usage);
  usage = recordFailure(usage);
  usage = recordRecoverableFailure(usage);
  assert.equal(usage.consecutiveFailures, 0);
});

test("recordReplan increments replans and evaluateBudget stops at the cap", () => {
  const budget: Budget = { maxIterations: 10, maxReplans: 2 };
  let usage: BudgetUsage = emptyBudgetUsage();
  usage = recordReplan(usage);
  usage = recordReplan(usage);
  assert.equal(evaluateBudget(budget, usage, Date.parse(usage.startedAt)), "STOP_STALL_NO_PROGRESS");
});

test("isTerminalStopReason partitions the stop reasons correctly", () => {
  const terminal: StopReason[] = [
    "STOP_GOAL_ACHIEVED",
    "STOP_STALL_OSCILLATION",
    "STOP_UNRECOVERABLE_ERROR",
    "STOP_CANCELLED",
  ];
  for (const reason of terminal) assert.equal(isTerminalStopReason(reason), true);
});

test("appendIteration rolls consecutive failures up on a non-success result and resets on success", () => {
  let run = baseRun();
  const failed = iterationFixture({ index: 1, phase: "ACT" });
  const failedOutcome = ({ actionResult: { status: "FAILED" } } as unknown) as ActionOutcome;
  const failedIter = { ...failed, executionResult: failedOutcome };
  run = appendIteration(run, failedIter);
  assert.equal(run.usage.consecutiveFailures, 1);
  const succeeded = iterationFixture({ index: 2, phase: "ACT" });
  const succeededIter = { ...succeeded, executionResult: ({ actionResult: { status: "SUCCEEDED" } } as unknown) as ActionOutcome };
  run = appendIteration(run, succeededIter);
  assert.equal(run.usage.consecutiveFailures, 0);
});

test("appendIteration without an execution result keeps the failure counter unchanged", () => {
  let run = baseRun();
  const it = iterationFixture({ index: 1, phase: "OBSERVE" });
  run = appendIteration(run, it);
  assert.equal(run.usage.consecutiveFailures, 0);
  assert.equal(run.usage.iterations, 1);
  assert.equal(run.currentPhase, "OBSERVE");
});

test("detectStall returns NONE with fewer than two iterations", () => {
  const sig = detectStall({ recentIterations: [iterationFixture({ index: 1, phase: "ACT" })] });
  assert.equal(sig.classification, "NONE");
  assert.equal(sig.signals.length, 0);
});

test("detectStall classifies repeated action when the same capability appears three times in a row", () => {
  const its = [
    iterationFixture({ index: 1, phase: "ACT", capability: "restart_service" }),
    iterationFixture({ index: 2, phase: "ACT", capability: "restart_service" }),
    iterationFixture({ index: 3, phase: "ACT", capability: "restart_service" }),
  ];
  const sig = detectStall({ recentIterations: its });
  assert.equal(sig.classification, "REPEATED_ACTION");
  assert.ok(sig.signals.some((s) => s.signature === "repeated_action"));
});

test("detectStall classifies oscillation when A B A B appears", () => {
  const its = [
    iterationFixture({ index: 1, phase: "ACT", capability: "call_a" }),
    iterationFixture({ index: 2, phase: "ACT", capability: "call_b" }),
    iterationFixture({ index: 3, phase: "ACT", capability: "call_a" }),
    iterationFixture({ index: 4, phase: "ACT", capability: "call_b" }),
  ];
  const sig = detectStall({ recentIterations: its });
  assert.equal(sig.classification, "OSCILLATION");
});

test("detectStall classifies repeated failure when the same error signature appears three times", () => {
  const its = [
    iterationFixture({ index: 1, phase: "ACT", errorSignature: "PROVIDER_TIMEOUT" }),
    iterationFixture({ index: 2, phase: "ACT", errorSignature: "PROVIDER_TIMEOUT" }),
    iterationFixture({ index: 3, phase: "ACT", errorSignature: "PROVIDER_TIMEOUT" }),
  ];
  const sig = detectStall({ recentIterations: its });
  assert.equal(sig.classification, "REPEATED_FAILURE");
});

test("detectStall classifies no progress when three iterations have no state or memory delta", () => {
  const its = [
    iterationFixture({ index: 1, phase: "ORIENT" }),
    iterationFixture({ index: 2, phase: "ORIENT" }),
    iterationFixture({ index: 3, phase: "ORIENT" }),
  ];
  const sig = detectStall({ recentIterations: its });
  assert.equal(sig.classification, "NO_PROGRESS");
});

test("detectStall skips no_progress when at least one iteration recorded a state delta", () => {
  const its = [
    iterationFixture({ index: 1, phase: "ORIENT" }),
    iterationFixture({ index: 2, phase: "ORIENT", stateDelta: { count: 1 } }),
    iterationFixture({ index: 3, phase: "ORIENT" }),
  ];
  const sig = detectStall({ recentIterations: its });
  assert.notEqual(sig.classification, "NO_PROGRESS");
});

test("detectStall classifies repeated permission denials when three iterations deny", () => {
  const denied: PermissionDecision = { decision: "DENIED", reason: "no grant" };
  const its = [
    iterationFixture({ index: 1, phase: "AUTHORIZE", permissionDecision: denied, capability: "call_a" }),
    iterationFixture({ index: 2, phase: "AUTHORIZE", permissionDecision: denied, capability: "call_b" }),
    iterationFixture({ index: 3, phase: "AUTHORIZE", permissionDecision: denied, capability: "call_c" }),
  ];
  const sig = detectStall({ recentIterations: its });
  assert.equal(sig.classification, "REPEATED_PERMISSION_DENIED");
});

test("stopReasonForStall maps every classification to a stop reason", () => {
  const pairs: ReadonlyArray<{ classification: StallClassification; reason?: StopReason }> = [
    { classification: "NONE" },
    { classification: "OSCILLATION", reason: "STOP_STALL_OSCILLATION" },
    { classification: "NO_PROGRESS", reason: "STOP_STALL_NO_PROGRESS" },
    { classification: "REPEATED_FAILURE", reason: "STOP_STALL_REPEATED_FAILURE" },
    { classification: "REPEATED_ACTION", reason: "STOP_STALL_NO_PROGRESS" },
    { classification: "REPEATED_PERMISSION_DENIED", reason: "STOP_POLICY_DENIED" },
  ];
  for (const { classification, reason } of pairs) {
    assert.equal(stopReasonForStall({ classification, signals: [] }), reason);
  }
});

test("terminateRun records the stop reason and endedAt and keeps prior idempotency", () => {
  const run = baseRun();
  const terminated = terminateRun(run, "STOP_GOAL_ACHIEVED");
  assert.equal(terminated.stopReason, "STOP_GOAL_ACHIEVED");
  assert.ok(typeof terminated.endedAt === "string");
  assert.equal(terminated.runId, run.runId);
});

test("applyTransition threads the latest transition and state onto the run", () => {
  const run = baseRun();
  const transition: MissionTransition = {
    missionId: run.missionId,
    from: "RUNNING",
    to: "SUCCEEDED",
    trigger: "succeed",
    occurredAt: new Date().toISOString(),
  };
  assertMissionTransition("RUNNING", "SUCCEEDED", "succeed");
  const updated = applyTransition(run, transition, "SUCCEEDED" as MissionState);
  assert.equal(updated.currentState, "SUCCEEDED");
  assert.equal(updated.lastTransition?.trigger, "succeed");
});
