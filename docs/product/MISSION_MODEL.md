# QUACK OS — Mission Model

The **mission** is QUACK's primary abstraction: a durable, governed, inspectable
unit of AI work. This document maps *product terminology* onto the *actual
runtime states that exist today*. **There is no second state machine** — the
runtime states below are the only states; product names are presentation
vocabulary for them.

## Conceptual lifecycle

```
DRAFT → PLANNED → READY → RUNNING → WAITING_APPROVAL → VERIFYING → COMPLETED
                                                    ↘ FAILED / PAUSED /
                                                      CANCELLED / RECOVERING → RESUMED
```

## State mapping (verified against source)

| Product state | Actual runtime representation | Source module | Event(s) | User meaning | Surfaced today? | Planned surface |
|---|---|---|---|---|---|---|
| DRAFT | task record `status: "created"` (pre-submit); HTTP mission record state `PENDING` | `src/runtime/task.ts` (`TaskStatus`), `src/server/index.ts` | `task.created` | intent captured, not yet executing | Studio mission list shows records | Mission Control "drafts" lane (P2) |
| PLANNED | task `status: "planned"`; loop state `PLANNING` | `src/runtime/task.ts`, `src/agent-loop/contract.ts` (`LoopState`) | `task.planned`, `loop.started` | plan graph built, capabilities determined | trace output only | Mission Detail plan view (P2) |
| READY | implicit: task `planned` + workflow `node.ready` events | `src/engine/workflow-engine` | `node.created`, `node.ready`, `workflow.started` | plan accepted, execution beginning | no | Mission Detail (P2) |
| RUNNING | task `status: "running"`; loop `EXECUTING` | `src/runtime/task.ts`, `src/agent-loop/contract.ts` | `task.started`, `node.started`, `tool.requested`, `tool.completed` | work in flight | CLI live event lines; Studio blocks until terminal | Mission Control live lane (P2, SSE) |
| WAITING_APPROVAL | loop state `WAITING_FOR_APPROVAL`; stop reason `WAITING_FOR_APPROVAL` | `src/agent-loop/contract.ts` (state exists; `RiskAwareApprovalPolicy` callback is the decision path) | **no dedicated event emitted today** (loop wake reason `loop.wake.APPROVAL_DECISION` exists for resume) | human decision required to continue | no (CLI callback is synchronous stdin) | Approval Center (P1 adds `approval.requested`/`approval.decided` events + queue) |
| VERIFYING | loop state `VERIFYING` | `src/agent-loop/contract.ts` | verification runs inside trace; `trace.created` after | outcome being checked against evidence | no | Mission Detail verify step (P2) |
| COMPLETED | task `status: "completed"` + `mission.completed`; receipt at `task.result.receipt` | `src/runtime/runtime.ts`, `src/engine/completion-receipt.ts` | `mission.completed` | verified outcome + durable receipt | CLI `run` prints receipt digest; Studio mission record | Receipt view (P2) |
| FAILED | task `status: "failed"`; loop `FAILED` | `src/runtime/task.ts` | `task.failed`, `mission.failed` | mission ended unsuccessfully | yes (CLI/Studio) | failure-reason surfacing (P2) |
| RECOVERING | resume path: `mission.recovery_started` | `src/runtime/runtime.ts` (`resumeMission`) | `mission.recovery_started` | crashed/interrupted mission being reconciled | resume via CLI only | Mission Control recovering lane (P2) |
| RESUMED | `mission.resumed` / `mission.recovery_completed` | `src/runtime/runtime.ts` | `mission.resumed`, `mission.recovery_completed` | execution continuing from checkpoint | CLI `resume` | resume buttons (P1 endpoints → P2 UI) |
| PAUSED | workflow `workflow.paused`; session `session.paused`; loop `WAITING_FOR_EXTERNAL_EVENT` | `src/engine/workflow-engine`, `src/events/event-bus.ts` | `workflow.paused`, `session.paused` | deliberate halt awaiting an external condition | engine-level only | pause affordance (P2+, only if genuinely supported end-to-end) |
| CANCELLED | loop state `CANCELLED`; runtime abort via `AbortSignal` (runtime.ts:568 maps to fenced `CANCELLED` transition) | `src/agent-loop/contract.ts`, `src/runtime/runtime.ts` | no dedicated `mission.cancelled` event today; state observable in loop result | user/timeout aborted the mission | loop result only | cancel endpoint (P1) + UI (P2) |

## What does NOT exist today (do not pretend otherwise)

- No `approval.requested` / `approval.decided` **events** (P1 will add them).
- No `mission.cancelled` **event**; cancellation is an abort-signal path that
  lands a fenced `CANCELLED` transition (P1 will consider adding the event).
- No pause of a *whole mission* from clients — only engine-level pause states
  exist. Do not expose a Pause button until the runtime truly supports it.
- `READY` is conceptual: the runtime moves planned → running without a
  distinct persisted "ready" status.

## Identity and durability

Every mission carries an `ExecutionIdentity`
(`src/engine/execution-recovery.ts`): `missionId`, `executionId`, `taskId`,
`sessionId`, `workflowId`, `actor`, `agentId?`. Identity is created **before**
planning; durable transitions are fenced (ownership epochs); receipts are
digest- and identity-bound. Recovery re-enters the same pipeline — it never
creates a second identity for one execution.
