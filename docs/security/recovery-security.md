# Recovery Security

Status: single-process recovery SUPPORTED and verified; SQLite
coordination primitive SUPPORTED and verified; **multi-process recovery
UNSUPPORTED** (recovery stores are not wired to the coordination
primitive — ADR 0031); **governed-mission durable recovery (P14) SUPPORTED
across process restarts for the governed loop** — see the last section.

## Single-process recovery (ADR 0028) — SUPPORTED

- Entry: `QuackRuntime.resumeMission` only. Concurrent resume in one
  process returns `recovery.busy`.
- `SessionRuntime` is the sole checkpoint owner: serialized mutations,
  deep-cloned records, `assertRecoveryCheckpoint` validation, atomic
  versioned writes.
- Every governed tool call is journaled `STARTED → COMPLETED | FAILED`
  with a stable idempotency key; acknowledged outcomes replay without
  re-dispatch.
- Retry-safety classes gate retries; ambiguous non-idempotent effects
  fail closed (`recovery.reconciliation_required`) — never repeated
  blindly.
- Verification is bound to the execution's own durable evidence;
  foreign/stale evidence and receipts fail checkpoint validation.
- Verified with real child-process SIGKILL crashes at seven boundaries
  (22 restart/recovery-policy cases).

## SQLite coordination primitive (ADR 0031 prerequisite) — SUPPORTED

`src/storage/coordination.ts` (`SqliteCoordinationStore`, migration
`004_coordination_leases`):

- **Atomic acquire**: `begin immediate` transaction; free/stale/released
  claims; exactly one winner in a race (verified with 4-way real-fork
  race, 12-owner acquire storm).
- **Live-lease rejection**: second owner gets BUSY while lease is valid.
- **Stale takeover**: after lease expiry another process takes ownership
  with a version bump.
- **Fencing**: `writeFenced(owner, version, payload)` rejects stale
  owners after takeover (STALE_OWNER) — an old owner cannot write after
  losing ownership. Version guessing by a foreign writer does not help
  (adversarially verified).
- **Heartbeat**: live-owner-only renewal; expired leases cannot be
  resurrected (adversarially verified).
- **Release tombstone**: keeps the fencing version monotonic across
  ownership epochs — a released resource's next owner never re-issues a
  version an old writer held.
- **Crash safety**: real SIGKILL of the lease holder mid-hold; lease
  goes stale; another process recovers ownership after expiry
  (verified with real forked processes).

Scope: **single-host multi-process coordination only.** No distributed
or HA guarantees, no cross-host fencing, no clock synchronization beyond
wall-clock lease expiry, no PID detection.

## Multi-process recovery — UNSUPPORTED

The coordination primitive exists and is tested, but the JSON recovery
stores (`JsonFileTaskStore`, `JsonFileCheckpointStore`,
`JsonFileJournalStore`) do NOT check or use it. `QuackRuntime.resumeMission`
does not acquire a lease. Two processes sharing one `dataDir` must not
run recovery concurrently — the ADR 0028/0031 boundary stands. Wiring the
recovery path onto the primitive is a separate, deliberate change.

## Recovery attack rejections (adversarially verified)

Stale-owner write after takeover (fenced), expired-lease heartbeat
resurrection (rejected), version-guessing foreign writes (rejected),
concurrent acquire storms (exactly one owner), crash-mid-hold followed by
takeover.

## Governed-mission durable recovery (P14, ADR 0048) — SUPPORTED

The governed mission loop (`GovernedMissionLoop`, ADR 0045) has its own
durable recovery over the P11–P13 records — the run store, the step-attempt
journal, and the P14 mission checkpoint. It is deliberately separate from
the ADR 0028 session-runtime recovery above (different authority chain,
different stores) and does not use the SQLite coordination primitive; the
same single-process/dataDir ownership discipline applies.

Semantics and guarantees (all adversarially verified, 55-case P14 matrix):

- **Crash detection**: a stored run WITHOUT a terminal stop reason is a
  crashed run; on the next `run` of the same mission id the loop
  reconciles durable records before doing anything else.
- **At-most-once, not exactly-once**: `(missionId, stepIndex, capability)`
  reserves exactly once across processes. An ambiguous step means the
  external effect is UNKNOWN — it may have happened, partially happened,
  or not happened. No exactly-once claim exists anywhere.
- **Ambiguity parking**: AMBIGUOUS and crash-window DISPATCHING records
  both park the mission REQUIRES_VERIFICATION. There is no
  AMBIGUOUS → resume path: the runtime never re-dispatches an uncertain
  action, never steps over one, and never converts ambiguity into success.
- **Safe boundary**: resume continues AFTER the highest settled step (and
  after the run record's cursor); verified/settled steps are never
  re-executed.
- **Budget recovery**: consumed counters restore from the persisted record
  (conservative maximum — a restart can only under-report remaining
  budget, never grant it back). Budget-reset-after-restart is refused.
- **Checkpoint integrity**: digest-protected, fail-closed on tampering,
  unknown schema, unknown fields, and cross-mission identity mismatch;
  metadata only (no prompts/arguments/secrets — verified); write failures
  never block the run (journal + run record stay authoritative).
- **Authority invariant**: `Authority_after_restart ≤ Authority_before_restart`.
  Recovery never grants capability — an unprovisioned mission resumes and
  is still broker-denied; the fenced recovery state machine has no
  transition from an unresolved ambiguous state to resume.
- **Legal transitions only**: recovery composes the canonical mission-state
  chains (INTERRUPTED → RECOVERING → RUNNING etc.) through the ADR 0045
  state machine; illegal transitions throw.

Approval contract security (same matrix): approvals are identity-bound to
the canonical digest of the exact action, single-use at exactly one
dispatch, non-transferable across mission/step/capability/arguments;
model-supplied approval fields are data; the proposing actor can never be
the approver; destructive/irreversible actions without the full
approval+verification chain keep failing closed.
