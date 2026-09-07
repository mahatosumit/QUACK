# ADR 0031: Multi-Process Recovery Remains Unsupported

## Status

Accepted — 2026-09-06
Superseded in part — 2026-09-07: the SQLite coordination PRIMITIVE required
by this ADR's "Required prerequisite" section now exists and is verified
(`src/storage/coordination.ts`, migration `004_coordination_leases`). The
recovery stores are NOT yet backed by it; multi-process recovery for the
canonical runtime REMAINS UNSUPPORTED until that separate, deliberate
migration happens. See "Prerequisite status" at the end.
Superseded (boundary lifted) — 2026-09-08, Phase 5: the integration this
ADR deferred is now implemented and verified — `resumeMission` and fresh
durable `submitGoal` acquire mission leases through
`src/runtime/ownership.ts` (`MissionOwnershipGuard`), all durable state
transitions are epoch-fenced, and the behavior is proven by 12 real
forked-process crash/restart tests plus the 5K dogfood E2E. Multi-process
recovery is SUPPORTED (single-host scope). Current truth lives in
`docs/recovery/multi-process-recovery.md`; the original boundary below is
preserved as the historical pre-Phase-5 state.

## Context

Interrupted-mission recovery (ADR 0028) is explicitly single-process. The
documented unsupported boundary states that the task store and checkpoint
store serialize within one runtime instance only, and two processes sharing
one `dataDir` must not run recovery concurrently because no cross-process lock
exists.

This ADR evaluates whether multi-process recovery can be implemented safely
for the existing canonical runtime without adding a new persistence or locking
subsystem.

## Investigation findings

The recovery path is `QuackRuntime.resumeMission` → `SessionRuntime` (sole
checkpoint owner) → `assertRecoveryCheckpoint` → `DefaultLoopDriver`. The
authoritative state during recovery is the checkpoint's `recovery` block
(identity, status, invocation journal, memory writes, evidence, verification)
plus the durable task record.

All three recovery persistence layers are JSON files with the same shape:

- `JsonFileTaskStore` (`src/storage/task-store.ts`)
- `JsonFileCheckpointStore` (`src/engine/checkpoint-system.ts`)
- `JsonFileJournalStore` (`src/engine/execution-journal.ts`)

Each:

- reads the file into an in-process cache exactly once (`loadPromise` /
  `loaded`), never invalidating on subsequent operations;
- serializes writes through a per-instance promise queue (in-process only);
- persists by atomic temp-file + rename (`atomicWriteFile`).

`QuackRuntime.executionOwners` and `SessionRuntime.executionUpdates` /
`activeRuns` are in-memory per-instance structures.

### Analysis

| Question | Finding |
| --- | --- |
| Who owns a running execution? | `QuackRuntime.executionOwners`, an in-memory per-instance `Set`. Not durable, not cross-process. |
| How is execution identity persisted? | `Task.execution` (`ExecutionIdentity`) plus the versioned checkpoint `recovery.identity`. |
| How does another process discover an execution? | Via `JsonFileTaskStore`; but each process caches the file once and never re-reads, so cross-process visibility of writes is not guaranteed. |
| How are concurrent writes serialized? | Per-instance promise queues only; no cross-process serialization. |
| What atomicity already exists? | Atomic single-file replace via `atomicWriteFile` (crash-safe for one writer), plus per-instance serialization. No compare-and-swap, no cross-process exclusion. |
| Two processes resume the same task? | Both pass the in-memory `executionOwners` check, both transition to RUNNING, both execute. Duplicate non-idempotent side effects are possible. |
| One process crashes while another is active? | No detection mechanism exists (no lease, no heartbeat, no version guard). |
| Can checkpoint/journal versions detect stale writers? | Checkpoint has an id and timestamp but no cross-process monotonic version incremented atomically; saves are whole-file overwrites. Journal entries carry ids/timestamps only. No. |
| Side effects outside the durable journal? | Real tool effects (files, APIs, workspace) occur externally; the journal only records acknowledged invocations. Ambiguity is handled fail-closed in the single-process path. |
| Which state is authoritative during recovery? | The checkpoint `recovery` block plus the invocation journal, validated by `assertRecoveryCheckpoint`. Correct single source of truth — but only safely read/written by one process because the stores cache per-process. |
| Locking/lease primitives already available? | None for cross-process recovery. Company `leaseId` is a separate in-memory runtime. No file lock, no flock, no CAS, no SQLite-backed lease on the recovery path. |
| Filesystem-specific concerns? | JSON whole-file rewrite + rename; `renameWithTransientRetry` handles Windows EPERM/EBUSY/EACCES. No lock primitive used. |
| Windows concerns? | No flock/fcntl. PID-based detection is fragile and rejected. `node:sqlite` `DatabaseSync` is present on Node 24 but is not wired into the recovery stores. |
| Is multi-process support safe to implement now? | No — see below. |

### Why a minimal lease/version guard cannot be added safely

A durable lease or optimistic-version guard requires an atomic
compare-and-swap on acquisition: read current owner, verify it is free or
expired, and claim it in one step such that a competing process observes the
claim.

A sidecar lease written as another JSON file reproduces the exact defect it is
meant to fix: two processes both read the stale cached lease copy, both decide
the lease is free, both claim it, and the last rename wins. JSON-file + rename
provides no atomic read-modify-write across processes.

The only compare-and-swap-capable primitives available without adding a
dependency are:

- `node:sqlite` transactions / unique constraints (`node:sqlite` exists on
  Node 24), or
- an OS file lock (`flock`-style), which is not reliable on Windows.

Both are a new persistence or locking subsystem for the recovery path. The
task explicitly forbids creating another persistence system and forbids
redesigning the existing journal or checkpoints.

## Decision

Multi-process recovery for the canonical runtime remains **unsupported**.

No ownership, lease, version-guard, or cross-process serialization mechanism
is added to the recovery stores, because doing so safely requires a new
persistence/coordination subsystem, which is out of scope.

The existing single-process guarantees are unchanged and verified:

- `executionOwners` prevents duplicate resume within one runtime instance
  (`recovery.busy`).
- `atomicWriteFile` gives crash-safe single-writer replacement.
- `assertRecoveryCheckpoint` and the invocation journal make the checkpoint the
  authoritative, validated recovery state.
- Ambiguous non-idempotent side effects fail closed
  (`recovery.reconciliation_required`).

## Required prerequisite

To make multi-process recovery safe, the recovery stores must be backed by an
atomic compare-and-swap-capable coordination primitive, for example:

- a SQLite-backed task/checkpoint/journal store using transactions and a
  `owner + lease_expires_at + version` column with an atomic claim
  (`UPDATE ... WHERE owner IS NULL OR lease_expires_at < now` returning rows
  changed), plus heartbeat renewal and crash-safe stale-lease takeover; or
- an equivalent external coordination service.

That primitive must:

- make execution ownership explicit and durable,
- make ownership expire/recover safely after process failure,
- reject a second owner while the first lease is live,
- prevent stale owners from overwriting newer checkpoint or terminal state,
- keep the journal authoritative, and
- verify Windows semantics (no reliance on PID detection).

Until such a primitive is introduced, the documented limitation stands and
tests prove single-process safety.

## Prerequisite status — 2026-09-07

The coordination primitive is now implemented and verified:
`src/storage/coordination.ts` provides `SqliteCoordinationStore` over the
existing `SqliteConnection` (migration `004_coordination_leases`):
atomic `acquire` (`begin immediate`, free/stale/released claims, version
bump on every ownership change), `heartbeat` renewal (live-lease only —
expired leases cannot be resurrected), `release` (tombstone keeps the
fencing version monotonic across ownership epochs), and `writeFenced`
(owner + exact-version + live-lease stale-writer rejection). Verified with
real multi-process tests (`src/storage/coordination.test.ts`, 9 tests):
forked-process races where exactly one of four wins, live-lease rejection,
stale takeover, version fencing after takeover, real `SIGKILL` crash with
lease-expiry recovery, and cross-process fenced writes — on Windows.

Scope limits remain explicit: single-host multi-process coordination only.
No distributed/HA guarantees, no cross-host fencing, no clock
synchronization beyond wall-clock lease expiry, no PID detection.

What is still NOT done — the reason multi-process recovery stays
UNSUPPORTED: `JsonFileTaskStore` / `JsonFileCheckpointStore` /
`JsonFileJournalStore` do not check or use the coordination store.
`QuackRuntime.resumeMission` does not acquire a lease. Rewiring the
recovery path onto this primitive (ownership claim on resume, fenced
checkpoint/journal writes, heartbeat during execution) is the next
separate, deliberate change; until then ADR 0028's unsupported boundary
stands unchanged.

## Consequences

- The unsupported boundary in ADR 0028 remains accurate and enforceable.
- No new dependency, persistence system, or locking primitive is introduced.
- Single-process interrupted-mission recovery continues to pass its focused
  and full-suite gates unchanged.
- Future work to lift this boundary must introduce the SQLite/coordination
  primitive above first; that is a separate, deliberate change, not an
  incremental add-on to the JSON stores.

## Verification

`src/runtime/interrupted-recovery.test.ts` continues to exercise real
child-process `SIGKILL` crashes at seven boundaries, fail-closed retry
classes, retry-safe acknowledged failures, metadata/capability revalidation,
foreign evidence and receipts, terminal reopening, missing persisted budget
fields, unsupported checkpoint versions, the `dataDir` contract, and
single-process duplicate ownership (`recovery.busy`). The full repository
suite, root and SDK typechecks, build, and lint pass.