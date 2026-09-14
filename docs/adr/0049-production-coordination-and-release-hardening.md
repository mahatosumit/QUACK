# ADR 0049: Production Coordination and Release Hardening (P15)

Date: 2026-09-14
Status: Accepted
Phase: P15 — Production Hardening + Release Qualification
Predecessors: ADR 0045 (governed mission loop), ADR 0046 (secure execution), ADR 0047 (isolation backends), ADR 0048 (durable mission recovery and verified actions)

## Purpose

P15 hardens the P11–P14 governed runtime for realistic production
operation and qualifies the result with executable evidence. P14 delivered
durable recovery, approvals, adapters, and verification inside ONE process.
P15 answers what happens when the real world interferes: two processes share
one dataDir, an owner crashes mid-lease, a process dies inside the approval
gate, durable records are corrupt, backends disappear, and the model tries
to become an authority. The P15 change set is hardening and qualification
ONLY — it adds no new execution capability and no parallel authority.

## Production risks addressed

1. **Duplicate authoritative execution** — two CLI/server processes sharing
   one dataDir could both resume the same mission.
2. **Stale ownership** — a crashed owner's lease could block recovery
   forever, or (worse) a zombie owner could keep writing durable state next
   to the new owner.
3. **Lost approval decisions** — a crash inside the approval callback lost
   the human decision, or allowed an unbounded wait with no durable record.
4. **Ambiguity deadlock** — P14 parked AMBIGUOUS steps forever with no
   governed way out; operations needed either trusted automated
   reconciliation or an honest guarantee that parking is permanent without
   one.
5. **Persistence-layer corruption and unavailability** — malformed records,
   corrupt databases, and failing backends had to be proven fail-closed,
   never silently permissive.
6. **Secret leakage through metadata** — model-derived intent text flows
   into durable approval records; secret-shaped material had to be redacted
   before persistence (a P15-F discovered gap — fixed in this phase).

## Multi-process coordination (P15-A)

The EXISTING ADR 0031 primitive (`MissionOwnershipGuard` over the SQLite
coordination store) is reused unchanged; no new consensus mechanism exists.
`GovernedMissionLoop` acquires the mission lease (`governed:<missionId>`
namespace inside the same DB the legacy runtime uses) at every `run()` when
a coordination DB path is wired (production derives it from the dataDir):

- **Exactly one authoritative executor per mission**: the loser of a lease
  race fails closed with `mission.ownership_busy` — never an unowned run.
- **Fenced durable writes**: a takeover-losing process stops writing
  durable mission state (`durableWritesPermitted` over the guard lifecycle);
  its final save is skipped so it cannot clobber the new owner's records.
- **Crash recovery without surgery**: lease expiry + atomic takeover with a
  monotonic fencing epoch; a crashed owner requires no manual DB operation.
- **Scoped orphan reconciliation**: journal reconciliation is scoped to the
  leased mission — a live process's in-flight steps for OTHER missions are
  never parked by an unrelated dataDir sharer.
- **Coordination failures fail closed**: a corrupt or unavailable
  coordination DB surfaces `mission.ownership_unavailable` and the run
  NEVER degrades to unowned execution.

Classification: **IMPLEMENTED** (single-host, SQLite-file-scoped).
**NOT_CLAIMED**: distributed consensus, multi-host coordination, network
partition tolerance. The guarantee holds within one host's filesystem
boundaries (the dataDir trust domain established by P13/P14).

## Durable approvals (P15-B)

The P14 approval contract is unchanged (identity-bound, digest-bound,
single-use, model-proof). P15 adds the DURABLE layer
(`JsonFileApprovalStore` + `DurableApprovalRunner`, the SAME seam the
harness already consumed):

- Requests park durably BEFORE the callback (deterministic key per
  binding) — a crash mid-ask leaves a PENDING record the operator can
  still answer after restart.
- Decisions (GRANTED/DENIED) persist immediately; a DENIED binding can
  never be upgraded by re-asking; a still-live GRANTED decision is REUSED
  on restart (never re-asked).
- Consumption persists; replay of a consumed approval fails closed.
- Server-side TTL (`expiresAt` is part of the digested record): expiry is
  evaluated against the server clock at every load/consume; client or
  model fields can never extend it.
- Secret redaction (P15-F security fix): the persisted reason — which
  embeds model-derived intent text — is redacted through the single
  repository redaction authority (`redactSecrets`) BEFORE persistence;
  decisions quoting secret material are re-digested redacted. The
  canonical proposal digest semantics are unchanged (redaction touches
  only the reason metadata, never the binding).

Classification: **IMPLEMENTED** (integrity, single-host).
**NOT_CLAIMED**: cryptographic authenticity against an attacker with
write access to the dataDir (the sha256 digests are integrity, not
authentication — the documented P13/P14 trust model).

## Ambiguous-step reconciliation (P15-C)

P14 parked AMBIGUOUS forever. P15 allows leaving AMBIGUOUS through ONE
governed path — trusted, evidence-bound probe reconciliation:

```
AMBIGUOUS → durable evidence record (identity-bound) → trusted probes
  → all PASSED → COMPLETED (provenance + evidence digest)
  → any FAILED (observable absence of the declared effect) → FAILED
  → INCONCLUSIVE/missing/foreign/conflicting/malformed → stays AMBIGUOUS
```

Enforced properties: probes read DURABLE evidence records only (never
model output, never provider self-report); evidence identity must match
the EXACT attempt (`evidenceMatchesIdentity`); probes that need
observations the metadata-only evidence record does not carry honestly
fail (never a fabricated definitive negative); conflicting durable
verification records win over fresh probes; reconciliation failures park
(fail closed). The verification strategy comes from the adapter
REGISTERED for the capability (deployer-registered data via
`WorkloadAdapterRegistry.verificationStrategyFor`), never re-read from
model output at reconciliation time.

Classification: **IMPLEMENTED** where a trusted verifier exists (probe
strategies whose observations survive in the durable evidence record:
`status_equals`, `no_error`); **UNSUPPORTED** for effects whose expected
state is not runtime-observable (those stay AMBIGUOUS honestly);
**NOT_CLAIMED**: automatic resolution of all ambiguous external effects.

## Crash/restart qualification (P15-E)

The crash matrix (real SIGKILL at deterministic durable-write boundaries,
driven by the shared child-process harness) proves for each boundary:
no duplicate execution, no budget reset, no approval bypass, WAITING_
APPROVAL stays governed (durable PENDING evidence releases the
reservation — the ONE at-most-once exit with trusted pre-execution
proof), AMBIGUOUS stays parked without trusted verification, no
checkpoint privilege escalation, no cross-mission settlement, at most
one authoritative recovery owner, terminal runs never replay.

Classification: **IMPLEMENTED** for the tested boundaries (durable write
sequence: persistence → reservation → execution → settlement →
checkpoint → terminal; approval gate; recovery pass). The in-process
statement-adjacent windows are proven through seeded durable-state
assertions (the strongest deterministic evidence the architecture
supports — documented honestly in the suite header).

## Operational hardening (P15-F)

Every durable surface fails closed: malformed run records, checkpoints
(digest-first, then identity), journal records, corrupt/absent
coordination DB, lease contention, stale owners, unavailable models,
probes, approval mechanisms, persistence failures, duplicate/invalid
adapter registration. No governance failure silently becomes permissive;
settlement failures are EMITTED (never swallowed); telemetry is
metadata-only (secrets redacted before persistence).

Classification: **IMPLEMENTED**.

## Observability

New metadata-only events (coordination lifecycle, approval
parked/restored/consumed, ambiguity detected, reconciliation
attempted/verified/unresolved, recovery parking/release, adapter
admission). Payloads carry identity and state metadata only; the same
redaction authority applies. Classification: **IMPLEMENTED**.

## Security properties (qualified in P15-H)

Executable release qualification over the real runtime: single-authority
construction (one broker, one harness seam, one recovery path — no bypass
route); the model cannot approve (forbidden approvers), cannot verify
(UNVERIFIED/INCONCLUSIVE never becomes VERIFIED from self-report), cannot
choose isolation (tri-state adapter resolution: REGISTERED forces
isolation, REJECTED denies, UNREGISTERED keeps the honest host policy),
cannot touch checkpoints or recovery state; execution gates each fail
closed individually; approval identity binding / single-use / TTL /
concurrent consumption (exactly one winner); authority after restart is
monotonic-non-increasing; at-most-once reservations with honest AMBIGUOUS
for unknown effect state.

## Release qualification result

Full evidence: 2122 tests (2119 pass, 0 fail, 3 documented environment
skips — Docker daemon and Edge browser availability, each with a
fail-closed covered path), serial 2139/2136/3, selfmod 17/17, E2E 1/1,
lint + typecheck + build green, hygiene clean (no BOM, valid UTF-8, no
mojibake in the P15 delta, no secrets, no new forbidden surfaces).

**CONDITIONAL PASS.** All critical security and recovery properties pass
with executable evidence; the release scope is bounded by the explicit
limitations below (single-host coordination, at-most-once semantics,
integrity-not-authenticity, environment-dependent isolation backends).

## Explicit limitations

| Guarantee | Classification |
| --- | --- |
| Governed mission recovery, checkpoint integrity, approval identity binding, fail-closed corruption handling | IMPLEMENTED |
| Single-host multi-process coordination (one dataDir, SQLite lease + fencing) | IMPLEMENTED (within the supported single-host architecture) |
| Durable approval state (PENDING/GRANTED/DENIED/CONSUMED, server-side TTL) | IMPLEMENTED |
| Trusted ambiguous reconciliation where a verifier exists | IMPLEMENTED |
| Metadata-only observability with secret redaction at persistence | IMPLEMENTED |
| Process-backend filesystem containment, cleanup behavior | BEST_EFFORT (host process/filesystem properties) |
| Exactly-once external effects | UNSUPPORTED (at-most-once + honest AMBIGUOUS is the guarantee) |
| Arbitrary extension execution | UNSUPPORTED |
| Unrestricted network / credential access | UNSUPPORTED |
| Distributed consensus, multi-host coordination | NOT_CLAIMED |
| Cryptographic authenticity against a persistence-store-writing attacker | NOT_CLAIMED (integrity digests only) |
| Automatic resolution of all ambiguous external effects | NOT_CLAIMED |
| Autonomous irreversible execution | NOT_CLAIMED (human approval always required) |

## Consequences

- Production wiring (`swe-system`) now wires coordination, durable
  approvals, and trusted reconciliation; two processes sharing a dataDir
  can never both execute one mission.
- The P15 test surfaces (A/B/C/E/F/H suites, 88 tests) are the release
  qualification baseline — future changes must keep them green or
  explicitly re-qualify.
- The approval-record secret-redaction fix (P15-F) is a security fix to
  the P14 durable approval store: durable approval records are now
  metadata-only by construction, not by convention.
