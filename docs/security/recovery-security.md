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

## Multi-process recovery — UNSUPPORTED (legacy session-runtime path)

The coordination primitive exists and is tested, but the JSON recovery
stores (`JsonFileTaskStore`, `JsonFileCheckpointStore`,
`JsonFileJournalStore`) do NOT check or use it. `QuackRuntime.resumeMission`
does not acquire a lease. Two processes sharing one `dataDir` must not
run recovery concurrently through the LEGACY session-runtime path — the ADR
0028/0031 boundary stands for that path. (The GOVERNED mission loop is now
coordinated — see the P15 section below.)

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

## Production coordination and release hardening (P15, ADR 0049) — SUPPORTED

The P14 statement "does not use the SQLite coordination primitive" is
superseded for the governed loop: P15 wires `GovernedMissionLoop` onto the
EXISTING ADR 0031 primitive (`governed:<missionId>` namespace, same DB the
legacy runtime uses). All adversarially verified (88 P15 tests):

- **Exactly one authoritative executor per mission** (single-host): every
  `run()` acquires the mission lease first; the race loser fails closed
  with `mission.ownership_busy` — never an unowned run next to a live
  owner (real 2-process fork race verified).
- **Fenced durable writes**: a takeover-losing process stops writing
  durable mission state (guard lifecycle gating; fenced final save);
  a stale owner can never clobber the new owner's records.
- **Crash takeover without surgery**: lease expiry + atomic takeover with
  a monotonic fencing epoch; heartbeat-only owners are never stolen from.
- **Scoped orphan reconciliation**: only the leased mission's in-flight
  DISPATCHING records are parked; a live process's other-mission steps are
  never touched by a dataDir sharer.
- **Coordination failures fail closed**: corrupt or unavailable
  coordination DB surfaces `mission.ownership_unavailable` — the mission
  is never run unowned next to an unverifiable coordination state.
- **Durable approvals (P15-B)**: requests park durably before the callback;
  GRANTED/DENIED decisions persist (DENIED can never be upgraded by
  re-asking); consumption persists (no replay); server-side TTL evaluated
  against the server clock (client fields cannot extend). SECURITY FIX:
  the persisted reason (which embeds model-derived intent text) is redacted
  through the repository redaction authority BEFORE persistence — durable
  approval records are metadata-only by construction.
- **Trusted ambiguous reconciliation (P15-C)**: AMBIGUOUS leaves parking
  ONLY through identity-bound durable evidence + trusted probes
  (PASSED → COMPLETED with provenance and evidence digest; observable
  absence of the declared effect → FAILED; INCONCLUSIVE/missing/foreign/
  conflicting/malformed → stays AMBIGUOUS). The strategy comes from the
  REGISTERED adapter (deployer data), never re-read from model output.
  No trusted verifier = parked forever (P14 semantics preserved).
- **Crash matrix (P15-E)**: real SIGKILL at the deterministic durable-write
  boundaries — no duplicate execution, no budget reset, no approval bypass,
  AMBIGUOUS stays parked, no cross-mission settlement, at most one
  authoritative recovery owner, terminal runs never replay.
- **Fail-closed hardening (P15-F)**: malformed persisted state on every
  durable surface, backend unavailability, contention, stale ownership,
  invalid adapter descriptors — no governance failure becomes permissive;
  settlement failures are emitted, never swallowed.

Honesty boundaries (unchanged): **single-host** coordination only — no
distributed consensus, no multi-host fencing; **at-most-once**, never
exactly-once; integrity digests, **not authenticity** against an attacker
with write access to the dataDir; automatic ambiguous resolution only
where a trusted verifier exists. Release qualification: CONDITIONAL PASS
(see CURRENT_STATE.md for the full gate record).
