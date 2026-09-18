# QUACK Data Lifecycle

**Version:** 1.0.0 — P16 deployment qualification

Persistent-data lifecycle for the qualified single-host topology. Every claim
is classified as IMPLEMENTED, BEST_EFFORT, UNSUPPORTED, or NOT_CLAIMED.

## Where data lives

One local filesystem `dataDir` (default `~/.quack` / `QUACK_DATA_DIR`) holds
all durable state: — IMPLEMENTED (single-host, one dataDir).

| Store | Path (under dataDir) | Format |
|---|---|---|
| Mission run records | `governed-missions/<mission>.json` | versioned JSON, fail-closed parse |
| Step-attempt journal | `step-attempts/` | versioned JSON, at-most-once dispatch |
| Mission checkpoints | `mission-checkpoints/` | versioned JSON, digest-bound |
| Durable approvals | `approvals/` | versioned JSON, TTL-bound, single-use |
| Execution evidence | `execution-evidence/` | identity-bound, digest-integrity |
| Capability grants | `security/capability-grants.json` | versioned JSON |
| Coordination leases | `coordination.sqlite` | SQLite (node:sqlite) |
| Core storage | `quack.sqlite` | SQLite, forward-only migrations 001-004 |
| Audit log | `audit.jsonl` | JSONL, redacted |

All JSON stores are versioned and fail closed on malformed/unknown versions —
corrupt or future-versioned records throw on load; they are never silently
coerced (P15/P16 qualification evidence).

## Lifecycle stages

### Creation / startup

Startup reconciles durable records before anything executes: DISPATCHING
orphans park AMBIGUOUS (at-most-once), interrupted-in-approval-gate
reservations release only on durable PENDING evidence, AMBIGUOUS attempts
reconcile only through trusted evidence-bound probes. A stored TERMINAL run
refuses replay. — IMPLEMENTED (START-1..8).

### Operation

- Coordination leases gate single-executor authority per mission within the
  host; heartbeats renew; stale leases are taken over with a fencing bump. —
  IMPLEMENTED (single host only; UNSUPPORTED across hosts).
- Budgets/approvals are durable: consumed counters persist across restarts
  and are never reset by failure, restart, or provider loss. — IMPLEMENTED.

### Shutdown

Graceful shutdown settles in-flight awaits, closes the listener, and leaves
durable state intact; no fabricated terminal state is written. — IMPLEMENTED
(STOP-1..2).

### Backup

- Format `quack-solo-backup-v1` — IMPLEMENTED.
  Real backup/restore path: run records, journals, checkpoints, approvals,
  evidence, coordination DB. Secrets are EXCLUDED by construction (BKR
  qualification; planted-credential scans). WAITING_APPROVAL requests are
  preserved; AMBIGUOUS steps remain parked in the restored dataDir.
- Corrupt, partial, or incompatible backups are rejected (digest + version
  fail-closed). Restore is atomic with rollback on failure. — IMPLEMENTED.

### Migration

- **Forward-only SQLite migrations 001-004** — IMPLEMENTED.
  Idempotent, deterministic digests, no privilege escalation. Future
  (higher) schema versions fail closed. Downgrade is UNSUPPORTED by design.

### Recovery

Recovery semantics (P15): interrupted missions reconcile to a safe boundary;
AMBIGUOUS steps stay parked without trusted verification; crashed executions
never re-dispatch. — IMPLEMENTED within the tested procedures.

## Secrets in the lifecycle

Secrets never persist: they live in environment variables, pass through the
SecretProvider boundary at boot, are redacted from every observability
surface, and are excluded from backups. Restoring a backup never restores a
credential. — IMPLEMENTED (SEC-1..10, BKR-5).

## What is NOT claimed

- Distributed/multi-host data management — UNSUPPORTED.
- Cryptographic authenticity against a full dataDir-write attacker — NOT
  CLAIMED (integrity: yes, digests + fail-closed parse; authenticity against
  an attacker who can write the dataDir: no).
- Arbitrary disaster-recovery guarantees beyond the tested backup/restore
  procedures — NOT_CLAIMED.
- Universal ambiguity resolution (every AMBIGUOUS step resolving without a
  trusted probe) — NOT_CLAIMED; unresolved ambiguity parks honestly.

## Related documents

- [PRODUCTION_TOPOLOGY.md](PRODUCTION_TOPOLOGY.md)
- [RELEASE_QUALIFICATION.md](RELEASE_QUALIFICATION.md)
- [../production/BACKUP_AND_RECOVERY.md](../production/BACKUP_AND_RECOVERY.md)
