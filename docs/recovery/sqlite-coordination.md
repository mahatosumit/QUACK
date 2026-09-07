# SQLite Multi-Process Coordination

Status: SUPPORTED (implemented + tested with real forked processes on
Windows runtime; Linux/macOS pending CI).

Source: `src/storage/coordination.ts` · tests:
`src/storage/coordination.test.ts` (9) + adversarial cross-suite recovery
attacks · schema: migration `004_coordination_leases` in
`src/storage/sqlite.ts`

## Model

One row per coordinated resource:

```sql
create table coordination_leases (
  resource_id text primary key,
  owner text not null,
  lease_expires_at integer not null,
  version integer not null,        -- fencing token, monotonic
  acquired_at integer not null,
  payload text
);
```

Every ownership decision runs inside a `begin immediate` transaction on
`node:sqlite` (`SqliteConnection.withDatabase`, busy_timeout 10000ms) —
the transaction IS the atomic claim step; there is no unprotected
check-then-update.

## Operations

| Operation | Semantics |
| --- | --- |
| `acquire(resource, owner)` | ACQUIRED (free / released tombstone), TAKEOVER_STALE (expired lease of a real prior owner, version+1), BUSY (live lease of another owner). Same-owner re-acquire is idempotent. |
| `heartbeat(resource, owner)` | extends lease for the LIVE owner only; expired leases never resurrect; non-owner always false |
| `release(resource, owner)` | tombstones the row (owner `""`, expiry 0) keeping the version monotonic — the next owner can never re-issue a version an old writer held |
| `current(resource)` | read lease state from any process |
| `writeFenced(resource, owner, version, payload)` | WRITTEN only for current owner + exact granted version + live lease; otherwise STALE_OWNER / NOT_OWNER |
| `readPayload(resource)` | read fenced payload from any process |

## Fencing example

```text
owner=A acquires → version=1
A writes with version=1 → WRITTEN
lease expires; B acquires → version=2 (TAKEOVER_STALE)
A writes with version=1 → STALE_OWNER (rejected)
B writes with version=2 → WRITTEN
```

## Verified with real processes (forked workers, not simulated)

1. Two+ processes race to acquire → exactly one wins (4-way race test;
   12-owner storm in adversarial suite).
2. Valid owner heartbeat extends lease across processes.
3. Second process rejected during valid lease (BUSY).
4. Stale-lease takeover after expiry.
5. Old owner cannot write after takeover (fencing).
6. Concurrent update race → single winner.
7. Process crash (real SIGKILL of lease holder mid-hold).
8. Restart + recovery after crash-expiry.
9. Windows filesystem behavior (all above run on Windows).
10. SQLite corruption/error handling — `runMigrations` itself is
    transaction-protected (a real concurrent-open race was found during
    4N testing and fixed by wrapping migration check-then-insert in
    `begin immediate`).
11. Cleanup/rollback — every operation commits or rolls back; a crash
    between operations leaves at worst an unexpired lease that later
    becomes stale and takeable, never a half-applied claim.
12. Transaction rollback — error paths roll back (verified by the
    fencing/lifecycle tests' rejection cases).

## Scope and non-goals

- **Single-host multi-process coordination only.** No distributed or
  high-availability guarantees, no cross-host fencing, no clock
  synchronization beyond wall-clock lease expiry, no PID detection.
- Wall-clock `Date.now()` is the lease clock; a host with a wildly
  skewed clock extends/shortens leases incorrectly. Single-host
  processes share one clock, which is why scope is single-host.
