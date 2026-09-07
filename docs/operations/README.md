# QUACK Operations Guide

Status: reflects the verified Phase 5 implementation. Unsupported
capabilities are labeled and must not be assumed present:

```text
container/microVM isolation = UNSUPPORTED
secret mediation = UNSUPPORTED
network sealing in workers = UNSUPPORTED
browser-profile access = UNSUPPORTED
remote skill execution = UNSUPPORTED
automatic retention/compaction = UNSUPPORTED
```

## Deployment requirements

- Node.js ≥ 22.5.0 (`engines` enforced; `node:sqlite` requirement).
- One `dataDir` per QUACK deployment on a LOCAL filesystem. All durable
  state (tasks, checkpoints, journal, coordination DB) lives there.
- Multi-process operation shares one `dataDir` across processes on the
  SAME host; ownership coordination derives `<dataDir>/coordination.sqlite`
  automatically (or set `coordinationDbPath` explicitly).
- Single-process mode: pass `disableOwnership: true` to the runtime
  dependencies to keep ADR 0028 semantics (in-process busy guard only).
- SQLite busy timeout is 10s; processes contending on the coordination DB
  serialize on `begin immediate` transactions.

## Ownership / lease tuning

- `ownershipLeaseMs` (default 30_000) — mission lease duration.
  Heartbeat interval is lease/3. A crashed owner remains "owner" until
  expiry; takeover latency ≈ remaining lease + one acquire attempt.
  - Long missions with stable hosts: default is fine.
  - Fast crash recovery in tests/ops: lower it (e.g. 600ms in the
    multi-process suite) — but never below your worst GC/pause + one
    heartbeat interval, or live owners get taken over mid-execution and
    their remaining writes fence out (mission then needs another resume).
- Lease is wall-clock: host clock jumps extend/shorten leases
  accordingly (single-host scope; documented limitation).
- Heartbeat timer is unref'd: an orphaned Node process holding a lease
  will NOT be kept alive by the heartbeat alone; the lease simply
  expires after the process dies.

## Recovery operations (runbook)

| Symptom | Diagnosis | Action |
| --- | --- | --- |
| `recovery.ownership_conflict` from resume | another live process owns the mission | let the current owner finish; resume again after lease expiry if the owner died |
| Mission stalled after owner crash | lease not yet expired | wait ≤ `ownershipLeaseMs`, then resume; takeover is automatic |
| `recovery.reconciliation_required` | unacknowledged non-idempotent side effect | HUMAN decision required: inspect journal + external system, then resolve (retry manually or mark failed) — QUACK never replays ambiguous effects |
| `LEASE_LOST` / `STALE_OWNER` in events | process lost ownership mid-run | mission durable state is protected; simply resume from another/current process |
| Terminal mission resumed | stored result returned | nothing to do — no re-execution occurs |

Repeated crash/restart cycles are safe: each cycle takes over after
expiry and resumes from the checkpoint (verified by tests).

## Events (observability)

All events flow through the typed `EventBus`
(`src/events/event-bus.ts`). Operational event families:

```text
mission.started / resumed / completed / failed
mission.recovery_started / recovery_completed
ownership.acquired / rejected / heartbeat / lost / released
task.created / planned / started / completed / failed
tool.requested / completed
capability.requested / checked / allowed / denied
recovery.started / completed · checkpoint.created / restored
skill.discovered* family via skill.* events · sandbox denials via
capability.denied with policy metadata
```

Event payloads are structured JSON with mission/epoch identities — never
secrets, credentials, cookie values, or private document content. The
privacy firewall governs any discovered metadata that could reach a
model. Environment variables never enter child processes wholesale
(allowlisted `childProcessEnvironment()` only).

## Failure handling

- Durable writes on ownership loss fail CLOSED: the stale process throws
  before mutating; its failure-transition writes are also fenced.
- Tool failures: retry-safety classes govern replay; acknowledged
  outcomes never re-dispatch; ambiguous non-idempotent effects BLOCK.
- Worker crash: contained per the isolation contract (BEST_EFFORT crash
  containment, ENFORCED timeouts/cancellation).
- Event emission failures never affect execution semantics (observability
  is best-effort by design).

## Retention

No automatic retention/compaction exists (see
`docs/recovery/durable-state.md`). Operators manage `dataDir` growth
deliberately; released lease tombstones and completed mission files are
never auto-pruned.
