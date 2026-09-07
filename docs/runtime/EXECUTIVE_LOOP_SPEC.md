# Executive Loop Spec

Status: **canonical contract — Phase 3 of production hardening**
Pair with: `src/runtime/mission-lifecycle/executive-loop.ts`

---

## 1. Purpose

Audit (`docs/production/EXECUTION_ARCHITECTURE_AUDIT.md` §3, §16, §27.1)
found three competing executive loops

- `QuackRuntime.submitGoal` — single plan → execute, no iteration.
- `AgentLoop.start` — bounded `for` loop, default `maxIterations = 3`.
- `WorkflowEngine.executeLoop` — true recurring `while (!cancelled)`.

with three overlapping units (`Mission` / `Task` / `Mission Company`) on
three different state models (§2). The `AgentLoop.state` field is a
**single instance shared across concurrent missions** (§16, §27.1) — a
concurrent `POST /missions` race. Iterations live in an in-memory array
on the instance, not durably per-mission. No `run_id` / `iteration_id`
correlation other than the `taskId` overloaded as a correlation id (§9).
No structured stop reasons; "something failed" is the error string. No
stall detection; no budget enforcement — the loop can only stop on
`maxIterations` and the iteration timeout.

This module is the canonical contract. It defines the per-mission run
record (`LoopRun`), the OODA phases, the iteration record, the budget
envelope, structured stop reasons, and the stall detector. Pure types +
helpers — the actual `AgentLoop` migration (replacing its in-memory
state with a `LoopRun`) lands as a focused refactor of
`agent-loop/index.ts` after this contract is stable.

---

## 2. The loop phases (OODA)

```
OBSERVE → ORIENT → DECIDE → AUTHORIZE → ACT → VERIFY → LEARN
```

The existing `AgentLoop` phases map onto these:

| Existing `AgentLoopState` | Canonical `LoopPhase` | Purpose |
|---|---|---|
| `OBSERVING` | `OBSERVE` | Gather observations; build working context. |
| `PLANNING` | `ORIENT` | Reason about state; orient toward candidates. |
| (none today) | `DECIDE` | Pick a candidate action; produce `ActionProposal`. |
| (inside `executeTool`) | `AUTHORIZE` | Permission gate as an **explicit** phase, not an inline check (audit §6). |
| `EXECUTING` | `ACT` | Submit the proposal via the harness (`ActionRuntime`). |
| `VERIFYING` | `VERIFY` | Run `verifyActionResult`; separate execution success from goal progress (§29). |
| `REFLECTING` | `LEARN` | Record memory delta, write lessons, emit evaluation. |

`DECIDE` and `AUTHORIZE` are new names for what was implicit. `DECIDE`
fires between `ORIENT` (plan ready) and `AUTHORIZE` (policy check). The
ability to stop an iteration between `DECIDE` and `ACT` is the audit
§6 decision-vs-execution boundary: the loop knows what it would do
**before** the harness runs it.

After `LEARN`, the loop returns to `OBSERVE` for the next iteration, or
terminates. `nextLoopPhase` walks the order; the loop driver decides
whether the next phase is another full OODA pass or a terminal wrap.

---

## 3. Per-mission run record

```ts
interface LoopRun {
  runId: string;          // createId("run")
  missionId: string;
  goal: string;
  actor: string;
  origin?: string;
  startedAt: IsoTimestamp;
  endedAt?: IsoTimestamp;
  budget: Budget;
  usage: BudgetUsage;
  iterations: readonly IterationRecord[];
  currentPhase: LoopPhase | undefined;
  currentState: MissionState | undefined;
  lastTransition?: MissionTransition;
  stopReason?: StopReason;
}
```

`createLoopRun({ missionId, goal, actor, budget })` returns a fresh run
with `createId("run")` and zero `BudgetUsage`. There is **no singleton**
loop state any more; each `start` produces a `LoopRun`. The audit §16 /
§27.1 concurrency race is fixed at the data layer: two concurrent
missions cannot collide because each owns its own `LoopRun`.

`appendIteration(run, iteration)` returns an **immutable** new `LoopRun`
with the appended iteration + rolled budget usage + the new
`currentPhase`. Immutability matters: the persisted `LoopRun` and the
in-flight `LoopRun` must not share mutable arrays (§35 concurrency). The
existing `AgentLoop` mutates `this.iterations.push(...)` — that will be
replaced in the migration.

`applyTransition(run, transition, state)` threads a
`MissionTransition` from the Phase 1 state machine plus the
canonical `MissionState` onto the run. The loop and the state machine
are connected through this; the loop's `currentPhase` and
`currentState` change in lockstep.

`terminateRun(run, reason)` records the `StopReason` and `endedAt`.

---

## 4. Iteration record

Per the prompt §4 surface. Each iteration is an **append-only** record
carrying everything required to reconstruct "why did the loop do this?".

```ts
interface IterationRecord {
  runId, missionId, iterationId, index,
  startedAt, completedAt,
  phase: LoopPhase,
  goal,
  observations: JsonObject,
  workingContext: JsonObject,
  relevantMemory?: JsonValue,
  candidateActions: readonly string[],
  selectedAction?: ActionProposal,
  selectionReason?: string,
  permissionDecision?: PermissionDecision,
  executionResult?: ActionOutcome,
  verification?: { status, message, failures? },
  evaluation?: { verdict, confidence, message },
  stateDelta?: JsonValue,
  memoryDelta?: JsonValue,
  nextStep?: IterationDecision,
  stopReason?: StopReason,
  executionErrorSignature?: string,
}
```

`executionErrorSignature` is a stable signature of the error carried from
the execution result so the stall detector can group repeated failures
without holding the full error payload. It is computed by the harness
(Phase 4 / Phase 5) — for example `normalizeProviderErrorV1.category` +
the action id — and persisted on the iteration record.

---

## 5. Budget envelope

```ts
interface Budget {
  maxIterations: number;        // required; hard upper bound
  maxModelCalls?: number;
  maxToolCalls?: number;
  maxCost?: number;              // dollars / tokens / units — whatever the runtime measures
  maxExecutionTimeMs?: number;
  maxConsecutiveFailures?: number;
  maxReplans?: number;
}
```

Every mission **must** have at least one hard upper bound — that's the
prompt §7 rule, and the type expresses it by making `maxIterations`
required. `evaluateBudget(budget, usage, nowMs)` returns a `StopReason`
as soon as a bound is breached, or `undefined` to continue. The order is
intentional: iterations → model calls → tool calls → cost → time →
consecutive failures → replans. A breach **anywhere** in this list is a
terminal stop reason, not a recoverable retry.

Budget enforcement is **deterministic** (audit §25). The model may
propose; the kernel decides. `evaluateBudget` runs in the loop driver,
not in any tool or provider. `recordModelCall` / `recordToolCall` /
`recordFailure` / `recordReplan` are pure functions that return updated
`BudgetUsage`. `recordRecoverableFailure` resets the
`consecutiveFailures` counter (a successful execution clears the
streak).

### Why budget lives on the loop, not the tool

A provider's own retry layer has no mission budget. A tool's own retry
has no mission budget. The loop owns the mission budget. Pushing budget
down into each tool would multiply and contradict the audit §20 "who
owns retries" finding. The loop is the single owner of the budget; every
tool / model call bumps the `usage` via these helpers and the loop
`evaluateBudget`s before each new iteration.

---

## 6. Stop reasons

```
STOP_GOAL_ACHIEVED              — verify passed; goal accomplishes the mission.
STOP_MAX_ITERATIONS            — hard cap.
STOP_MAX_MODEL_CALLS           — model budget exhausted.
STOP_MAX_TOOL_CALLS            — tool budget exhausted.
STOP_BUDGET_EXCEEDED           — cost budget exhausted.
STOP_TIMEOUT                    — wall-clock exhausted.
STOP_POLICY_DENIED             — permission gate (one-shot or stall-derived).
STOP_STALL_NO_PROGRESS         — three iterations with no state/memory delta.
STOP_STALL_OSCILLATION         — A → B → A → B action cycle.
STOP_STALL_REPEATED_FAILURE    — same error signature three times in a row.
STOP_UNRECOVERABLE_ERROR       — `maxConsecutiveFailures` reached.
STOP_CANCELLED                 — external cancellation reached the loop.
STOP_HUMAN_ABORT               — human aborted the mission.
```

The audit §28.10 finding ("no structured stop reasons; today: generic
error string only") is closed. `isTerminalStopReason(reason)` partitions
the set; non-terminal reasons (`STOP_POLICY_DENIED` may be scoped to a
single iteration, decided by policy in Phase 7) are not in this set.

The terminal classification matches the Phase 1 state machine: a mission
reaching any terminal stop reason goes to `SUCCEEDED` (for
`STOP_GOAL_ACHIEVED`) or to `FAILED` / `CANCELLED` / `TIMED_OUT` for the
rest. The mapping table lives in §10.

---

## 7. Stall detector

Per prompt §8. `detectStall({ recentIterations, maxHistory? })` returns
a `StallSignature` with a `StallClassification` and a list of
contributing `StallSignal`s. The detector is intentionally simple —
short sliding windows over the recent iterations.

| Signal | Window | Trigger |
|---|---|---|
| `repeated_action` | last 3 | same `selectedAction.capability` three times in a row |
| `repeated_failure` | last 3 | same `executionErrorSignature` three times in a row |
| `oscillation` | last 4 | `A B A B` action cycle |
| `no_progress` | last 3 | no `stateDelta` and no `memoryDelta` on any of three iterations |
| `repeated_permission_denied` | window | three denials in the recent window |

Classification priority (intentional):

```
OSCILLATION > REPEATED_ACTION > REPEATED_FAILURE
            > REPEATED_PERMISSION_DENIED > NO_PROGRESS > NONE
```

`stopReasonForStall(signature)` maps the classification to a
`StopReason`. When progress stops, the loop must decide its own policy —
the canonical options are `replan`, `fallback`, `request human
intervention`, `terminate safely` (prompt §8). The contract produces
the stop reason; the loop's stall policy (Phase 3 migration) is the only
caller that decides whether to terminate or escalate.

`maxHistory` defaults to 10. The window must be small; a long detector
window against a long mission would mask short stalls and waste budget.

---

## 8. Iteration decision / next step

```
PROCEED — go to the next phase or iterate.
REPLAN  — re-orient; produce a new plan; treat as a replan against budget.
WAIT    — pause on external dependency; mission goes WAITING (Phase 1).
RETRY   — re-submit the same action with same idempotency key (Phase 4).
BLOCK_FOR_HUMAN — mission goes BLOCKED (Phase 1).
STOP_FAIL — terminate as FAILED.
STOP_SUCCESS — terminate as SUCCEEDED.
```

The loop driver consults the budget + stall signature at the end of
`LEARN` and selects `nextStep`. The `IterationRecord.nextStep` records
what the driver decided, so post-hoc audit can show the decision the
loop made for any given iteration.

---

## 9. Migration plan (Phase 3 → `AgentLoop`)

The contract is in place. The migration of `agent-loop/index.ts` onto it
happens in a focused follow-up (this contract + tests landed first to
lock the types). Migration inventory:

- Replace `this.state` / `this.paused` / `this.stopped` /
  `this.iterations[]` with a per-call `LoopRun`.
- `createLoopRun({ missionId, goal, actor, origin, budget })` becomes
  the first call in `start`.
- `appendIteration` after each `runIteration`; iteration body returns a
  full `IterationRecord`, not the legacy `AgentLoopIteration`.
- `AgentLoopState` → `LoopPhase` mapping via
  `phaseFromLegacyAgentLoopState`.
- `evaluateBudget` replaces the `for index <= cfg.maxIterations` cap.
  Today's only enforcement (`maxIterations`, `iterationTimeoutMs`,
  `maxRecoveryAttempts`) becomes the `Budget` initialization.
- `detectStall` + `stopReasonForStall` add stall handling to each
  iteration's `nextStep` selection.
- `terminateRun` records the terminal `StopReason` on the result.
- Each iteration body emits the iteration record through `eventBus.emit`
  (the existing `loop.iteration` event grows the canonical fields).

The legacy `AgentLoop.start` return keeps its shape; the
`AgentLoopResult` gains `stopReason` and `runId`. New concurrent-safe
behavior: `AgentLoop` no longer holds single-instance state. Two
concurrent `start` calls produce two `LoopRun` records with distinct
`runId`s and do not race (audit §16 / §27.1).

The migration grows the iteration body in `agent-loop/index.ts` — no
other module changes structurally. The harness stays `ActionRuntime`; the
planner produces `ActionProposal` (Phase 2); the state machine stays
Phase 1. Concurrency primitives (per-mission mutex / worker pool) are
Phase 9.

---

## 10. Map terminal stop reason → terminal mission state

| Stop reason | MissionState (Phase 1) |
|---|---|
| `STOP_GOAL_ACHIEVED` | `SUCCEEDED` |
| `STOP_MAX_ITERATIONS` | `FAILED` |
| `STOP_MAX_MODEL_CALLS` | `FAILED` |
| `STOP_MAX_TOOL_CALLS` | `FAILED` |
| `STOP_BUDGET_EXCEEDED` | `FAILED` |
| `STOP_TIMEOUT` | `TIMED_OUT` |
| `STOP_POLICY_DENIED` | `FAILED` |
| `STOP_STALL_NO_PROGRESS` | `FAILED` |
| `STOP_STALL_OSCILLATION` | `FAILED` |
| `STOP_STALL_REPEATED_FAILURE` | `FAILED` |
| `STOP_UNRECOVERABLE_ERROR` | `FAILED` |
| `STOP_CANCELLED` | `CANCELLED` |
| `STOP_HUMAN_ABORT` | `CANCELLED` |

The loop driver applies the `MissionTransition` via
`planMissionTransition(missionId, currentState, mappedTargetState,
terminalTrigger)` (Phase 1). The trigger is `succeed` /
`fail` / `cancel` / `timeout`. The Phase 1 contract enforces illegal
transitions; here the driver is **only** ever firing a legal terminal
transition from a non-terminal state.

---

## 11. Test plan (Phase 3)

`src/runtime/mission-lifecycle/executive-loop.test.ts` — 24 tests:

- `createLoopRun` run id + zero usage.
- `nextLoopPhase` walks the OODA order and stops.
- `phaseFromLegacyAgentLoopState` maps every legacy phase.
- `evaluateBudget` triggers each `StopReason`
  (`STOP_MAX_ITERATIONS`, `STOP_MAX_MODEL_CALLS`,
  `STOP_MAX_TOOL_CALLS`, `STOP_BUDGET_EXCEEDED`, `STOP_TIMEOUT`,
  `STOP_UNRECOVERABLE_ERROR`, `STOP_STALL_NO_PROGRESS` cap on replans).
- `recordRecoverableFailure` resets the counter.
- `isTerminalStopReason` partitions the reasons.
- `appendIteration` rolls consecutive failures up + resets on success +
  keeps failures unchanged when no execution result.
- `detectStall` `NONE` on short window, `REPEATED_ACTION`,
  `OSCILLATION`, `REPEATED_FAILURE`, `NO_PROGRESS`, skipped-no-progress,
  `REPEATED_PERMISSION_DENIED`.
- `stopReasonForStall` maps every classification.
- `terminateRun` records reason + endedAt + run id.
- `applyTransition` threads transition + state.

Property / invariant tests (Phase 12):

- "Iteration number is monotonic" — `appendIteration` always increments.
- "Budget usage never decreases" — `recordModelCall` /
  `recordToolCall` / `recordFailure` / `recordReplan` only add.
- "A cancelled mission cannot launch a new action" — coupled with
  Phase 1 state machine.

---

## 12. Out of scope for this contract

- Authorizing an `ActionProposal` (Phase 7) — `AUTHORIZE` phase exists
  but the policy engine that populates `PermissionDecision` is built
  later.
- Resolving `providerId` from `capability` + `sandbox` (Phase 4).
- Persisting `LoopRun` + `IterationRecord` (Phase 6).
- Threading `AbortSignal` mission → loop → action → harness → provider
  (Phase 5).
- Backpressure — bounded mission queue + worker pool (Phase 9).
- Per-mission mutex (Phase 9).
- The `RUNDED_LOOPING` example mission in the prompt §48 —
  that exercises the migrated `AgentLoop`; Phase 3-only contract does
  not run missions yet.
