# Mission State Machine Spec

Status: **canonical contract — Phase 1 of production hardening**
Pair with: `src/runtime/mission-lifecycle/mission-state-machine.ts` (the executable form)

---

## 1. Purpose

A single source of truth for the mission lifecycle. Before this contract,
QUACK ran three overlapping units (Mission, Task, Mission Company) on three
different, mostly-soft state models (audit §2). Illegal transitions did not
fail; `MissionManager.complete()` was guarded by a single `!==` check;
`AgentLoop.state` was a single-instance field shared across concurrent
missions.

This contract eliminates mission-state invention by any other module. Every
state and every legal transition is enumerated; illegal transitions throw
`IllegalMissionTransitionError`.

---

## 2. States

| State | Meaning |
|---|---|
| `CREATED` | Mission object exists; not yet admitted to the queue. |
| `QUEUED` | Admitted; waiting for a worker slot (backpressure gate). |
| `STARTING` | Worker claimed the mission; preflight not yet done. |
| `RUNNING` | Loop is actively observing / deciding / acting. |
| `WAITING` | Loop paused on an external dependency (human approval, provider, sub-mission). Bounded by a timeout. |
| `INTERRUPTED` | Process death / forced restart left the mission mid-flight. Requires side-effect reconciliation before any resume. |
| `RECOVERING` | Reconciliation in progress. Cannot reach `RUNNING` directly — must pass through `RECOVERING` or `WAITING`. |
| `BLOCKED` | Manual hold or unrecoverable ambiguity awaiting a human decision. |
| `SUCCEEDED` | Terminal. Goal verified. |
| `FAILED` | Terminal. Unrecoverable error or repeated non-progress. |
| `CANCELLED` | Terminal. External cancel reached the active work. |
| `TIMED_OUT` | Terminal. A hard upper bound fired before terminal state. |

`TERMINAL_MISSION_STATES` = `SUCCEEDED`, `FAILED`, `CANCELLED`, `TIMED_OUT`.
`AMBIGUOUS_MISSION_STATES` = `RUNNING`, `STARTING`, `WAITING`, `INTERRUPTED`, `RECOVERING`.

---

## 3. Transition table

Each row is `from --(trigger)--> to`. Only these transitions are legal.
`assertMissionTransition` throws on anything else.

```
CREATED    --enqueue-->            QUEUED
CREATED    --cancel-->             CANCELLED
CREATED    --fail-->               FAILED

QUEUED     --start-->              STARTING
QUEUED     --cancel-->             CANCELLED
QUEUED     --fail-->               FAILED
QUEUED     --timeout-->           TIMED_OUT

STARTING    --start-->             RUNNING
STARTING    --fail-->              FAILED
STARTING    --cancel-->            CANCELLED
STARTING    --interrupt-->        INTERRUPTED
STARTING    --timeout-->          TIMED_OUT

RUNNING     --wait-->              WAITING
RUNNING     --succeed-->           SUCCEEDED
RUNNING     --fail-->              FAILED
RUNNING     --block-->             BLOCKED
RUNNING     --interrupt-->        INTERRUPTED
RUNNING     --cancel-->            CANCELLED
RUNNING     --timeout-->          TIMED_OUT

WAITING     --resume-->            RUNNING
WAITING     --block-->             BLOCKED
WAITING     --interrupt-->        INTERRUPTED
WAITING     --cancel-->            CANCELLED
WAITING     --timeout-->          TIMED_OUT
WAITING     --fail-->              FAILED

INTERRUPTED --recover-->           RECOVERING
INTERRUPTED --fail-->              FAILED
INTERRUPTED --cancel-->            CANCELLED

RECOVERING  --resume-->            RUNNING
RECOVERING  --wait-->              WAITING
RECOVERING  --block-->             BLOCKED
RECOVERING  --fail-->              FAILED
RECOVERING  --cancel-->            CANCELLED

BLOCKED     --unblock-->           RUNNING
BLOCKED     --wait-->              WAITING
BLOCKED     --fail-->              FAILED
BLOCKED     --cancel-->            CANCELLED
BLOCKED     --timeout-->          TIMED_OUT
```

Terminal states have **no legal outgoing transitions**. A terminal-to-
`RUNNING` attempt is the canonical illegal transition the runtime must
refuse loudly.

---

## 4. Per-transition contract

Every transition specifies:

```
from
to
trigger
preconditions
side effects
persisted data
emitted event
failure behavior
```

The emitted event for each transition is `mission.<trigger>` tagged with the
`to`/`from` states (see `OBSERVABILITY.md`). `planMissionTransition` produces
the typed `MissionTransition` record; the loop / mission manager persists it
and emits the bus event. This module is intentionally side-effect free so
that the contract can be unit-tested as a pure state machine.

### Notable invariants enforced here

- A terminal mission cannot return to `RUNNING`. `assertMissionTransition`
  throws because the `from` has no rule.
- A cancelled mission cannot launch a new action. The only path out of
  `CANCELLED` is none — the contract refuses it.
- `INTERRUPTED` cannot jump straight to `RUNNING`. It must pass through
  `RECOVERING`, where side-effect reconciliation is mandatory (audit §22,
  §25.5). This is the architectural protection against replaying side
  effects that may already have executed.
- A mission in `WAITING` cannot fire `--succeed-->`. It must `--resume-->`
  to `RUNNING` first. Goal verification only happens from an active loop,
  never from a paused one.

---

## 5. Mapping onto existing code

This contract is **additive**. The migration does not require a persisted
schema rewrite on day one. The legacy `MissionDefinition.status` union
`"draft" | "active" | "completed" | "failed"` maps onto canonical states
through `missionStateFromLegacyStatus` / `legacyStatusFromMissionState`:

| Legacy | Canonical |
|---|---|
| `draft` | `CREATED` |
| `active` | `RUNNING` (also `QUEUED`, `STARTING`, `WAITING`, `INTERRUPTED`, `RECOVERING`, `BLOCKED` collapse here) |
| `completed` | `SUCCEEDED` |
| `failed` | `FAILED` (also `CANCELLED`, `TIMED_OUT`) |

The persistence-rewrite phase (Phase 6) replaces the legacy four-state column
with the canonical state. Until then, the contract lives in `MissionManager`
+ the executive loop as a richer in-record field, and `legacyStatusFrom*
keeps the existing SQLite rows readable.

### Migration gaps (vs audit)

- **§2** — Mission / Task / Mission Company on three state models → unify on this contract. Mission Companies keep their enforced FSM as a higher-level orchestration layer; the company's `RUNNING | WAITING | VERIFYING` map onto `RUNNING | WAITING | RUNNING` here, but the company FSM stays its own — it tracks multi-agent workforce state, not single-mission loop state.
- **§27.6** — "Mission, Task, and Mission Company have three different, mostly-soft state models. Illegal transitions don't fail." → resolved by `assertMissionTransition` / `IllegalMissionTransitionError`.
- **§25.3** — "Mission completion is idempotent." → enforced: `RUNNING --succeed--> SUCCEEDED` is a single legal transition; `SUCCEEDED` has no outgoing rule.
- **§28.10** — structured stop reason → canonical `trigger` becomes the stop reason (`cancel` / `timeout` / `fail` / `succeed`). Detailed stop reasons (`STOP_MAX_ITERATIONS`, `STOP_BUDGET_EXCEEDED`, etc.) live on the loop iteration record (Phase 3) and the terminal-state row (Phase 6), not the state machine.

---

## 6. Concurrency ownership

One mission loop has **one state-transition owner**. `assertMissionTransition`
itself is pure and lock-free; the owner is the loop iteration that holds the
mission's `run_id`. Callers must hold a per-mission mutex (Phase 9) before
calling `planMissionTransition`. This module refuses to be the lock — it
only refuses illegal state.

The audit found `AgentLoop.state` field shared across concurrent missions
(§16, §27.1). Per-mission state lives on a per-mission record keyed by
`missionId` + `runId`, not on a runtime-wide singleton. This module's
`planMissionTransition(missionId, from, to, trigger, reason)` takes the
mission id explicitly for that reason.

---

## 7. Recovery path

```
RUNNING at process death
   ↓
INTERRUPTED        (set by startup recovery scan, Phase 6)
   ↓
RECOVERING         (reconcile side effects via ActionRuntime ledger + provider.reconcile)
   ↓
WAITING | RUNNING  (resume) OR FAILED | BLOCKED (unrecoverable)
```

`INTERRUPTED --recover--> RECOVERING` is the only legal out of `INTERRUPTED`
besides `FAILED` and `CANCELLED`. The recovery worker (Phase 6) is the only
caller of `--recover-->`. Side-effect reconciliation is mandatory before any
`--resume-->` to `RUNNING` — replaying an action that may already have
committed is forbidden by the contract: `RECOVERING --resume--> RUNNING`
requires the recovery worker to have written a reconciliation verdict into
the persisted state (Phase 6 invariant).

---

## 8. Test plan

Unit tests (Phase 1):

- every legal transition listed in §3 returns a `MissionTransition`.
- every illegal transition listed in §3 (every direction **not** present) throws `IllegalMissionTransitionError`.
- a terminal mission has zero legal outgoing transitions.
- `missionStateFromLegacyStatus` / `legacyStatusFromMissionState` round-trip for every legacy value and every canonical state.
- `isAmbiguousMissionState` returns true for the recovery-bearing states and false for terminals.
- `planMissionTransition` with a legal transition populates `occurredAt` and preserves the trigger.

Property / invariant tests (Phase 12):

- "A terminal mission cannot return to RUNNING" — try every trigger from every terminal state; all throw.
- "A cancelled mission cannot launch a new action" — `CANCELLED` has no outgoing transitions; cancelling again is illegal.
- "Mission state survives process restart" — persist + reload + assert (Phase 6).

---

## 9. Out of scope for this contract

- Stop reasons beyond `succeed` / `fail` / `cancel` / `timeout` — loop-level (`STOP_MAX_ITERATIONS`, `STOP_BUDGET_EXCEEDED`, `STOP_POLICY_DENIED`, `STOP_UNRECOVERABLE_ERROR`) live on the iteration record, Phase 3.
- The persisted shape of the transition log — Phase 6.
- The event-bus payload for each `mission.*` event — Phase 8.
- Backpressure (the `QUEUED → STARTING` worker pick) — Phase 9.
