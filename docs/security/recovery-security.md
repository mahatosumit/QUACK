# Recovery Security

Status: single-process recovery SUPPORTED and verified; SQLite
coordination primitive SUPPORTED and verified; **multi-process recovery
UNSUPPORTED** (recovery stores are not wired to the coordination
primitive — ADR 0031).

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
