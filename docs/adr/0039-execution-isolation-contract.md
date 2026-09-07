# ADR 0039: Execution Isolation Contract and Worker Backend

## Status

Accepted — 2026-09-06

## Context

Phase 3 requires sandbox/isolated execution without hard-coding the runtime
to one mechanism and without false security claims. Existing "sandbox"
surfaces (`plugins/sandbox.ts`, `skills/sandbox-runtime.ts`) are declarative
policy validators, and `mcp-transports.ts` correctly refuses an ISOLATED
profile because no launcher exists.

## Decision

### Isolation contract (`src/isolation/contract.ts`)

A narrow backend-agnostic abstraction:

- `IsolationLevel`: `IN_PROCESS` (no isolation; never presented as
  sandboxing), `WORKER_PROCESS` (crash/resource containment, not a security
  boundary), `CONTAINER_ISOLATED` and `FUTURE_STRONG_ISOLATION` (reserved;
  must fail closed where unsupported).
- `IsolationProfile`: conservative default-deny policy — filesystem is
  workspace-scoped, network is `DENY` by default (`ALLOWLIST` requires
  explicit hosts/schemes), environment is explicitly materialized variables
  (never `process.env`), secrets require explicit listing and are rejected
  for `IN_PROCESS`, resources are bounded with a mandatory wall-clock limit.
- `IsolationBackend`: `supportedLevels`, per-dimension `guarantees`
  (`ENFORCED`/`BEST_EFFORT`/`UNSUPPORTED`), and `execute(request)` returning
  a structured `IsolationResult` with provenance (backend id, profile level,
  start/end times). `validateIsolationProfile` rejects contradictory
  policies. `effectiveGuarantees` reports honest per-request guarantees.
- Workloads cross the boundary as `module` entries; host closures are
  rejected. The workload receives only `IsolatedIo` (workspace root,
  materialized environment, signal) — no host registries, brokers, or
  runtime APIs.

### Worker backend (`src/isolation/worker-backend.ts`)

`WorkerProcessIsolationBackend` implements `WORKER_PROCESS` on
`node:worker_threads` (no new dependencies; works on Windows and Linux):

- ENFORCED wall-clock timeout and cancellation: the worker is terminated and
  the result is deterministic (`TIMED_OUT`/`CANCELLED`).
- ENFORCED environment materialization: the worker receives only policy
  variables via `workerData`.
- BEST_EFFORT filesystem containment: paths resolve through an
  IO-boundary validator inside the worker that rejects traversal outside the
  workspace root.
- UNSUPPORTED network and secret mediation (worker threads share the host
  process). Secrets fail closed at validation.
- Container/strong isolation and function workloads fail closed as
  `UNSUPPORTED`.
- Cleanup: worker termination plus temp-directory removal with bounded
  retries on every terminal path (success, failure, timeout, cancellation).

### Honest guarantee classification

| Dimension | Guarantee |
| --- | --- |
| Environment materialization | ENFORCED |
| Wall-clock timeout / cancellation | ENFORCED |
| Crash containment | BEST_EFFORT |
| Filesystem containment | BEST_EFFORT (policy validation at IO boundary; shared host process) |
| Memory/CPU bounds | BEST_EFFORT (termination at timeout; no cgroup enforcement) |
| Network isolation | UNSUPPORTED |
| Secret isolation | UNSUPPORTED |
| Process-count limits | UNSUPPORTED |

This backend is NOT a security sandbox equivalent to a container or VM, and
documentation must not claim so. Untrusted executable workloads that need
OS-level isolation remain a future capability (container/microVM backend
behind the same contract).

## Consequences

- The runtime depends on the isolation contract, never on worker_threads
  specifics.
- `CONTAINER_ISOLATED` stays fail-closed until a real container backend is
  implemented and verified (including Windows semantics).
- Evidence integration is ready: results carry mission/task/execution
  provenance and can feed the existing evidence pipeline without becoming a
  new completion source (checkpoint + `CompletionReceiptV1` remain
  authoritative).

## Verification

- `src/isolation/contract.test.ts` (4): profile validation, secret fail-closed
  for IN_PROCESS, honest guarantees per backend/level, request identity.
- `src/isolation/worker-backend.security.test.ts` (13) adversarial suite:
  module execution with materialized env; traversal and absolute-path escape
  blocked; host-env boundary documented honestly; planted-secret reachability
  documented; infinite-loop termination; crash containment; cancellation;
  container/strong isolation fail-closed; function workloads rejected;
  malformed results; cleanup with no leaked temp directories; output bounds.
- Full repository suite: 1,372 ordinary + 17 serial tests, 0 failures.