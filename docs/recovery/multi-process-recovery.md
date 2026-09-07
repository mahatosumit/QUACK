# Multi-Process Recovery

Status: **SUPPORTED** (implemented + verified with real multi-process
tests on the Windows runtime; Linux/macOS pending CI execution).

ADRs: [0031](../adr/0031-multi-process-recovery-unsupported.md) — the
ADR's "prerequisite" section records the coordination primitive; Phase 5
completed the integration the ADR deferred. The ADR's historical
boundary (pre-Phase-5 stores without coordination) is preserved as
history; this document is the current truth.

Related: `sqlite-coordination.md` (the primitive),
`durable-state.md` (what persists), `architecture.md` (single-process
path).

## What changed in Phase 5

```text
SQLite coordination primitive:      IMPLEMENTED + TESTED (Phase 4)
Recovery stores using it:           IMPLEMENTED + TESTED (Phase 5)
QuackRuntime.resumeMission lease:   IMPLEMENTED + TESTED
Fresh submitGoal lease:             IMPLEMENTED + TESTED
Multi-process recovery:             SUPPORTED (single-host scope)
```

## MissionOwnershipGuard

`src/runtime/ownership.ts` — one guard per mission execution. The lease
row in the coordination DB is the durable truth; guard object state is
ephemeral and re-derived from the row after any restart.

### Ownership lifecycle

```text
UNOWNED → ACQUIRING → OWNED → HEARTBEATING → COMPLETING → RELEASED
Failure states: OWNERSHIP_CONFLICT · LEASE_LOST · STALE_OWNER
```

- `OWNERSHIP_CONFLICT` — another live owner holds the lease (acquire
  returned BUSY; nothing was left behind).
- `LEASE_LOST` — heartbeat renewal failed (owner replaced or lease
  expired); durable writes are fenced out from that moment.
- `STALE_OWNER` — write-time fencing check failed (epoch mismatch);
  every subsequent durable write is refused.

### Semantics

- **Atomic acquisition**: the lease claim runs inside the coordination
  store's `begin immediate` transaction — no check-then-write race.
- **Lease**: wall-clock duration (default 30s, runtime-tunable via
  `ownershipLeaseMs`). Another process may take over only after expiry.
- **Heartbeat**: interval = lease/3, timer unref'd; renewal is
  live-owner-only — an expired lease can never be resurrected by the old
  owner.
- **Fencing**: every ownership-sensitive durable write passes
  `assertOwnedForWrite(operation)` which verifies owner + exact epoch +
  live lease inside the current DB state; a mismatch throws (fail
  closed) before any write.
- **Takeover**: after lease expiry another process acquires with
  version+1 (TAKEOVER_STALE); the old owner's next fenced write is
  rejected as STALE_OWNER.
- **Stale-owner rejection**: enforced at every durable transition —
  checkpoint init, mission-state transitions (INTERRUPTED/RECOVERING/
  RUNNING/SUCCEEDED/FAILED/CANCELLED), task-store writes, receipt/
  completion persists.
- **Crash recovery**: a crashed owner leaves at worst an unexpired
  lease; after expiry any process may take over and resume. Verified
  with real SIGKILL at six boundaries (before-ownership, after-
  ownership, during-heartbeat, tool-entered, after-tool-before-persist,
  after-receipt-before-complete).
- **Release tombstone**: explicit release keeps the fencing version
  monotonic; a released mission's next owner can never re-issue an
  epoch an old writer held.

## Runtime integration

### resumeMission

```text
load task + checkpoint (read-only)
→ acquire mission lease            (BUSY → recovery.ownership_conflict, fail closed)
→ heartbeat
→ INTERRUPTED → RECOVERING → RUNNING (each transition fenced)
→ runTask with fenced durable writes
→ COMPLETING: receipt → memory → SUCCEEDED → task completed store
→ release AFTER the final durable persist
```

If ownership cannot be obtained, the mission DOES NOT EXECUTE — the
caller receives a governed `recovery.ownership_conflict` result
(recoverable: true).

### Fresh mission submission

`submitGoal` for durable missions acquires the same mission lease before
execution, so two processes cannot co-execute a mission from the start.

### Durable write fencing

`fencedTransition` + `assertOwnedForWrite` wrap every durable mutation
listed above. The failure-transition path (FAILED/CANCELLED/TIMED_OUT)
is also fenced — a stale process cannot even record its own failure over
the new owner's state.

### Single-process mode

`disableOwnership: true` (used by the single-process recovery suite)
keeps ADR 0028 semantics unchanged: in-process `recovery.busy` guard
only. Multi-process suites run with the ownership layer on.

## Exactly-once classification

```text
Durable internal state:   fenced by ownership epoch
Mission ownership:        single active owner per host
External side effects:    at-least-once; retry-safe (READ_ONLY/
                          IDEMPOTENT_WRITE) invocations replay with
                          idempotency keys; ambiguous non-idempotent
                          effects BLOCK (recovery.reconciliation_required)
Completion receipts:      verified across crash/resume (dogfood E2E)
```

## Verification (real processes, no simulation)

12-test suite (`src/runtime/multi-process-recovery.test.ts`) using
forked workers sharing one dataDir + coordination DB:

1. 6 crash boundaries → takeover after expiry → completed + verified receipt
2. simultaneous resume race → never more than one executing owner; loser governed-rejected
3. stale process resume of a completed mission → stored result, no re-execution, call count exactly 2 (crashed attempt + resume)
4. repeated crash/restart cycles → eventual completion with verified receipt
5. crash before ownership → no lease left behind → immediate recovery
6. forged-owner / version-guessing attack → fenced out; takeover unaffected afterward
7. dogfood E2E: SKILL.md → compiler → governed graph → durable run → SIGKILL → second-process resume → verified receipt

Plus adversarial cross-suite recovery attacks (fencing after takeover,
heartbeat-race, version guessing, 12-owner storm, DB-tamper boundary) and
the coordination primitive suite (9 real-fork tests).

## Scope and non-goals

Single-host multi-process coordination only. No distributed consensus, no
HA cluster, no cross-host fencing, no clock synchronization beyond
wall-clock lease expiry, no PID detection, no exactly-once external side
effects. The coordination DB is inside the trust boundary: an attacker
with direct DB write access owns the host (tested boundary, documented
explicitly).
