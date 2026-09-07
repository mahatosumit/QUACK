# Durable Execution State

Status: SUPPORTED (documented from the verified implementation; no
persistence was added "for completeness").

ADRs: [0028](../adr/0028-interrupted-mission-recovery.md),
[0031](../adr/0031-multi-process-recovery-unsupported.md) (prerequisite
lifted in Phase 5)

## What survives process death (durable state)

All durable state lives under the runtime `dataDir` and is written with
atomic tmp+rename semantics (or SQLite transactions):

| State | Store | Notes |
| --- | --- | --- |
| mission/task record incl. `execution` identity (missionId, executionId, taskId, sessionId, workflowId, actor) | `tasks.json` (JSON task store) | written before first durable execution |
| execution checkpoint: identity, status, graphDigest, budget, deadline, invocations (attempt ids, idempotency keys, retrySafety), memoryWrites, evidence, verification | checkpoint store (`sessions/…/checkpoints.json`, versioned) | the single authoritative execution state; validated by `assertRecoveryCheckpoint` |
| invocation journal `STARTED → COMPLETED/FAILED` | journal store | exactly-once durable replay decisions |
| ownership lease: owner, lease_expires_at, fencing version (epoch), acquired_at, fenced payload | SQLite `coordination_leases` (migration 004) | one row per coordinated resource; NOT an event dump |
| completion receipt (proof chain) | inside the task record (`result.receipt`) + verification record in checkpoint | tamper-evident snapshot of goal, evidence, verification, digest |
| timestamps (createdAt/updatedAt, startedAt/completedAt, checkedAt, acquiredAt) | alongside their records | wall-clock ISO |

## Ephemeral state (dies with the process — by design)

- In-process `executionOwners` guard set, session cache, snapshot stack.
- `MissionOwnershipGuard` object state (lifecycle, epoch, heartbeat timer)
  — the durable truth is the lease ROW; a restarted process re-derives
  everything from it.
- Workflow engine/scheduler in-memory state — reconstructed from the
  checkpoint's graph + node results on resume.
- Heartbeat cadence (interval = lease/3); a crashed heartbeat leaves at
  worst an unexpired lease that later becomes stale and takeable.

## Derived state (recomputed, never trusted blindly)

- Task `plan` step statuses — re-derived from the workflow state at
  completion.
- `calls`/loop summaries — reconstructed from acknowledged invocations on
  resume (unacknowledged STARTED invocations replay only when
  retry-safe).
- Fenced payloads in the coordination store — convenience data guarded by
  owner+version, never a source of execution authority.

## Retention semantics (actual, unvarnished)

- **No automatic retention/compaction exists.** Durable stores grow with
  missions executed; there is no background pruning, snapshot trimming
  beyond `snapshotRetentionCount` on the session runtime, or
  lease-table vacuuming.
- Released leases become tombstones (owner `""`, expiry 0) that keep the
  fencing version monotonic — tombstones are never auto-deleted.
- Task/checkpoint/journal files are never auto-deleted after completion.
- Retention policy is a deliberate future decision (see ADR 0031
  history), not an implemented capability.

## External side-effect classification

- Durable internal state transitions: fenced (ownership epoch).
- Mission ownership: single active owner per host (coordination DB).
- External tool side effects: at-least-once unless the tool declares
  `IDEMPOTENT_WRITE`; ambiguous non-idempotent effects BLOCK with
  `recovery.reconciliation_required` (fail closed, never repeated
  blindly).
- Retry: per-invocation retry-safety classes with idempotency keys;
  acknowledged outcomes replay without re-dispatch.
