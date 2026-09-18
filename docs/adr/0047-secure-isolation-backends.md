# ADR 0047: Real Isolation Backends and Verified Execution

## Status

Accepted — 2026-09-12

## Context

P12 (ADR 0046) established the execution policy layer: the canonical
`ExecutionPolicy`, honest `IsolationState` classification, at-most-once step
dispatch, and runtime-evidence execution states. What P12 explicitly did NOT
provide:

1. A real isolation backend. `POLICY_RESTRICTED` was — and remains for
   host-function capabilities — broker-policy enforcement inside the trusted
   process. The ADR 0039 worker-thread backend existed for skill module
   workloads but was wired nowhere in the governed loop and is not a
   security boundary (threads share the host process, `process.env` is
   visible, network is uncontainable).
2. Capability negotiation. Nothing mapped a trusted isolation requirement
   onto an actually available backend with fail-closed semantics.
3. Execution evidence. Nothing recorded, in a tamper-evident and
   identity-bound way, what an isolated execution actually did.
4. Probe-runner verification. `trust_executed` success stayed
   `EXECUTION_COMPLETED` (UNVERIFIED); IRREVERSIBLE/DESTRUCTIVE execution
   remained fail-closed "without a runner".

## Decision

P13 adds REAL isolation backends and runtime-derived verification while
preserving the P12 doctrine: **AUTHORIZATION ≠ ISOLATION ≠ VERIFICATION**.
The one CapabilityBroker still decides WHETHER; the policy decides HOW;
backends decide WHERE; the probe runner decides WHAT ACTUALLY HAPPENED.
Zero new brokers, event buses, evaluators, or execution authorities.

```
ActionProposal (P11, server-derived)
    → CapabilityBroker authorization (unchanged)
    → ExecutionPolicy (P12, unchanged)
    → WorkloadAdapterRegistry (NEW: deployer-registered capability→module map)
    → IsolationBackendRegistry.resolve (NEW: SUPPORTED ∧ AVAILABLE ∧ enforceable)
    → IsolationSupervisor (NEW: trusted lifecycle)
    → ProcessIsolationBackend | ContainerIsolationBackend (NEW: real isolation)
    → ExecutionEvidence (NEW: identity-bound, digested, durable)
    → ProbeRunner (NEW: runtime-derived verification)
    → ExecutionState classification (P12, now with VERIFIED reachable)
    → StepAttemptJournal settlement (P12, unchanged)
```

### 1. Backend contract extension (`src/isolation/contract.ts`)

`ProbeableIsolationBackend` adds `availability()`. Four distinct notions,
never conflated: **SUPPORTED** (backend class implements the level),
**AVAILABLE** (host provides the mechanism right now), **ENFORCEABLE**
(the guarantee record backs the request), **VERIFIABLE** (evidence + probes
exist). A supported-but-unavailable backend never executes.

### 2. Capability negotiation (`src/isolation/backend-resolver.ts`)

`IsolationBackendRegistry.resolve(requiredLevel, profile)` walks registered
backends in registration order (strongest-first is the deployer's
responsibility). A backend qualifies only when it supports the level, its
availability probe passes, and its guarantee record is not UNSUPPORTED for
the process dimension. No match → `UNRESOLVED` → the supervisor DENIES.
**There is no downgrade path and no policy-only fallback for an
isolation-requiring execution.** Backend ids are deployer vocabulary;
model output has no field that reaches resolution (P12 parser shapes hold:
S1-S3 adversarial proofs in `secure-isolation.security.test.ts`).

### 3. Process backend (`src/isolation/process-backend.ts`) — REAL

Module workloads run in a dedicated OS child process through the governed
`executeProcess` abstraction (argv-only, no shell):

- **ENFORCED process boundary**: separate OS process; tree-kill on
  timeout/cancellation (taskkill /T on Windows, SIGKILL on POSIX).
- **ENFORCED environment**: the child's environment block contains ONLY
  the runner spec — an explicitly constructed env, never `process.env`.
  Host-planted secrets and custom host values do NOT cross (proven by
  test). Platform honesty: Windows injects OS-identity variables
  (SYSTEMROOT, default system PATH, TEMP…) into every child regardless of
  the passed block; these are platform defaults, not inherited host
  values, and are documented as such.
- **ENFORCED wall-clock, cancellation, output bytes**: bounded capture at
  the supervisor boundary; oversized output is dropped, never previewed.
- **BEST_EFFORT filesystem**: the child runs as the same OS user;
  containment is the IO-boundary validator (`resolveInside`) inside the
  workload kit plus entry-resolution checks before spawn. Never claimed
  as more.
- **UNSUPPORTED network**: a plain child process has normal network reach.
  The backend refuses ALLOWLIST networking (fail-closed) — only DENY is
  honest. Network isolation requires the container backend.
- **UNSUPPORTED secrets**: profiles naming secrets fail closed.

### 4. Container backend (`src/isolation/container-backend.ts`) — REAL

Docker-compatible CLI backend for `CONTAINER_ISOLATED`, kernel-enforced:

- `--network none` (network namespace removed — verified by an in-container
  fetch failing), `--memory` cgroup limit (verified by kernel OOM kill),
  `--read-only` rootfs with readonly bind-mounted workspace copy and
  tmpfs `/tmp`, `--cap-drop ALL`, `no-new-privileges`, `--pids-limit`,
  `--user 65534:65534`, pinned `node:22-alpine3.20` image.
- Workspace provisioning copies the governed workspace subtree into a
  scratch dir (symlinks rejected — junction/symlink escape prevention);
  only that copy is mounted, read-only, into the container. The host
  workspace is never mounted wholesale.
- Availability is **environment-dependent by design**: the probe checks
  the docker CLI AND daemon, cached with a bounded window. Unavailable
  (daemon down, CI runners without docker) → resolution UNRESOLVED → DENY.
  Enforcement tests run only against a live daemon (opt-in
  `QUACK_P13_CONTAINER=1`); the fail-closed path is tested everywhere.
- ALLOWLIST networking fails closed (network-none is the only enforceable
  network mode in v1); secrets fail closed.

### 5. Trusted supervisor (`src/isolation/supervisor.ts`)

Owns the isolated lifecycle on behalf of the trusted runtime: construct →
resolve (deny on UNRESOLVED, durable denial evidence) → create isolated
environment → launch → enforce timeout → monitor cancellation → contain
output → record evidence → terminate → cleanup → settle verification.
The workload can never control its own final execution state. Two TRUSTED
workspace modes:

- **Adapter-backed**: fresh per-execution isolated dir under the trusted
  workspace root; ONLY the registered entry module is materialized into
  it; removed with bounded retries on every terminal path; cleanup failure
  is recorded (`CLEANUP_FAILED` + `execution.cleanup_failed` event), never
  hidden.
- **Caller-managed** (no adapter source): the profile's workspace root is
  the caller-constructed governed workspace; the supervisor never deletes
  caller state.

A backend that THROWS settles cleanup UNCERTAIN and verification UNVERIFIED
(crash-window doctrine).

### 6. Execution evidence (`src/isolation/execution-evidence.ts`)

Identity-bound to (missionId, stepIndex, capability, executionId, backendId)
with a sha256 digest over the canonical form. Metadata only: exit state,
timestamps, isolation level, backend guarantee record, output DIGEST +
byte counts — never chain-of-thought, environment dumps, secrets, or
unrestricted output. `parseExecutionEvidence` fails closed on wrong
version, malformed identity, digest mismatch (tampering), unknown states.
`evidenceMatchesIdentity` is the binding check: cross-mission, cross-step,
and cross-execution reuse all fail. Durable JSON store with atomic writes;
`reconcileOrphans()` transitions crash-window PENDING-cleanup records to
UNCERTAIN/UNVERIFIED — verification never survives an uncertain crash
window, and orphans are never re-executed.

### 7. Probe runner (`src/isolation/probe-runner.ts`)

NOT a second execution authority. It verifies ALREADY-AUTHORIZED,
ALREADY-EXECUTED actions against runtime evidence only: the
harness-captured `ActionResultV1`, supervisor facts, and governed-workspace
filesystem observations. `output_field`/`status_equals`/`no_error` probes
read runtime state; `external_check` fails closed (executing another
capability for verification would be a second authority — refused).
`trust_executed` stays honestly INCONCLUSIVE/UNVERIFIED. The model cannot
supply verification results: probe provenance is runtime-declared only
(S38 proof). With the probe runner, `EXECUTION_VERIFIED` becomes reachable
through the existing P12 classifier; IRREVERSIBLE/DESTRUCTIVE execution
remains fail-closed pending a dedicated approval-runner contract.

### 8. Workload adapter registry (`src/isolation/workload-adapter.ts`)

Every executable isolated workload has an EXPLICIT deployer-registered
adapter: capability id → entry module (relative, traversal-free) +
required level + argument validation + trusted source directory. There is
no path from capability name → arbitrary command, model string → code,
tool argument → shell, or user/model input → module path. The supervisor
materializes ONLY the registered entry from the trusted source directory
into the isolated workspace. Unknown capability → DENY. Production wiring
(`swe-system.ts`) registers both backends but starts with an EMPTY
adapter registry: no capability silently becomes isolation-eligible.

### 9. Harness integration (`harness.ts`)

After broker authorization (the broker stays the single authority —
isolation decides WHERE, not WHETHER), the harness checks the adapter
registry. A REGISTERED adapter routes execution through the supervisor;
the result carries `providerId: "isolation:<backend>"`. Capabilities
without an adapter keep the honest POLICY_RESTRICTED host path — no
silent move in either direction. Isolated-path timeouts/cancellations set
the P12 runtime-observed evidence flags; output passes the same
`clampOutputBytes` containment; verification runs the probe runner and
settles VERIFIED/FAILED/INCONCLUSIVE into evidence via
`settleVerification` (identity-checked, fail-closed). The loop records
`observations.backend` (metadata-only), surfaced through server
(`/governed-missions`) and CLI.

### 10. Observability, SDK, CLI/server

Metadata-only events: `isolation.backend_selected`, `isolation.unresolved`,
`execution.isolation_ready`, `execution.verified`, `execution.unverified`,
`execution.cleanup_failed`. SDK exposes provider-neutral inspection types
(`IsolationBackendInfo`, `ExecutionEvidence`, `VerificationResult`) — no
Docker clients, process handles, supervisor primitives, filesystem or
credential surfaces. CLI/server show backend identity alongside the P12
isolation/execution-state fields. No CLI flag can weaken isolation (none
exists).

## Platform honesty (P13.21)

Isolation availability is **environment-dependent**:

| Platform | os-process | docker-container |
| --- | --- | --- |
| Windows (dev) | available | available iff Docker Desktop daemon is running |
| Linux CI (ubuntu) | available | available (daemon present); enforcement tests opt-in |
| Windows/macOS CI | available | daemon absent → backend UNRESOLVED → DENY |

The runtime selects only an actually enforceable backend. If the required
backend is unavailable: FAIL CLOSED, durable denial, never downgrade.
The QUACK runtime is NOT "sandboxed" as a whole — only adapter-registered
capabilities executing through a real backend are isolated; host-function
capabilities remain honestly POLICY_RESTRICTED.

## Security-review fix round (P13 review findings 1-11)

An independent security review produced twelve findings; six were fixed
before this round (adapter tri-state REJECTED→DENY downgrade gate, container
start wall-clock + settlement margin, materializeEntry lstat/symlink
rejection, container entry-containment, redactPath metadata scrubbing,
resolver ENFORCED-process requirement). This round closes the remaining
findings; none of the earlier fixes regressed.

### F10 — stepIndex identity binding + journal-settlement fail-closed

Evidence `stepIndex` is the RUNTIME's canonical mission step index, threaded
from `governed-mission-loop` through `HarnessExecutionContext.stepIndex` into
`supervisor.execute` and `settleVerification`. It is never derived from model
output, never supplied by a proposal payload, and never a constant: a harness
execution context without a canonical stepIndex DENIES isolated execution
fail-closed (misattributed evidence is worse than no evidence). Mismatched
stepIndex at settlement refuses (`evidenceMatchesIdentity`).

Journal settlement is part of the verdict, not an afterthought:

- `settleVerification` failures PROPAGATE; the harness downgrades the
  reported verdict to INCONCLUSIVE (never PASSED/VERIFIED) with the
  settlement failure surfaced in the verification message and the
  `execution.unverified` event. The old `.catch(() => undefined)` swallow
  is gone.
- When the composition provides a durable evidence store, settlement must
  also produce a LOADABLE record; an unloadable verified state is
  INCONCLUSIVE.
- The governed loop's step journal: a settlement failure (after one bounded
  retry) classifies the step AMBIGUOUS, records
  `journalSettlement: FAILED` + `mission.journal_settlement_failed`, and
  stops the mission — a COMPLETED/VERIFIED claim over an unconfirmable
  journal is never reported. The workload may still have executed; the
  honest state is "unknown outcome", not "success".

Principle: verification succeeds → durable settlement fails → reported
verdict = INCONCLUSIVE. Fail-closed preserved.

### F5 — trusted-store / isolated-workspace separation

Adapter-mode isolated workspaces now live under a DEDICATED root
(`$TMPDIR/quack-isolated-workspaces`), never under the trusted `dataDir`.
Previously the supervisor's workspace root was `config.dataDir` itself:
per-execution isolated directories were created BESIDE grants, mission
journals, execution evidence, memory, and every other durable trusted
store — giving a same-user workload an unnecessarily broad blast radius
over trusted state.

Boundary now: `dataDir` is exclusively trusted runtime persistence;
the dedicated workspace root is untrusted, bounded (per-execution dirs),
lifecycle-managed (removed with bounded retries on every terminal path),
and never treated as trusted state. Cleanup is best-effort after bounded
retries; failure is recorded honestly (`CLEANUP_FAILED` evidence +
`execution.cleanup_failed` event) rather than hidden. Trusted store paths
are never exposed to isolated execution: the backend receives only the
governed workspace root.

### F6 — filesystem-effect verification beyond lexical containment

`verifyFilesystemEffect` previously trusted a path whose STRING resolved
inside the workspace. Now, after lexical validation (absolute/traversal
rejection), it validates filesystem identity: every intermediate directory
component must be a real directory (lstat — symlinks/junctions/reparse
points rejected, not followed), and the final path must resolve via
realpath back INSIDE the resolved workspace root. Symlink escape, nested
symlink (directory-component) escape, and realpath-outside-workspace all
fail closed; the existing lexical protections are unchanged.

TOCTOU honesty: resolve-then-stat is not atomic. A same-user attacker
swapping a directory entry between resolution and observation can race the
probe. The boundary that removes this race is the container backend (no
shared host filesystem); the process backend's fs probes inherit the race
and it is documented rather than pretended solved.

### F9 — evidence SHA-256 trust boundary (documented, deliberately unkeyed)

The evidence digest is an INTEGRITY/CONTENT-IDENTITY mechanism, NOT an
authentication mechanism. It detects accidental corruption and tampering by
parties who cannot re-digest. An attacker WITH WRITE access to the evidence
store can forge a parseable record (documented and proven by test); the
digest does NOT defend against that attacker. HMAC was evaluated and
deliberately rejected: the same attacker who can rewrite the evidence store
reads the HMAC key from the process environment/config, so a keyed digest
adds key-management complexity without moving the actual boundary. The real
defenses are: the host OS trust boundary around `dataDir`, the identity
binding at settlement (a forged record cannot satisfy a DIFFERENT
execution's verification), and CapabilityBroker authorization of every
execution path. Revisit keyed integrity only if a future threat model adds
an attacker who can rewrite evidence but not grants/policy.

### Regression requirement honored

Old behavior that allowed PROCESS_ISOLATED policy + in-process host
implementation → execution was unsafe and is now DENIED. Tests that
previously encoded the permissive behavior were updated to expect denial;
the downgrade gate was not weakened to keep any test green.

## The three architectural tests

1. **Backend disappears** → AUTHORIZED ACTION → UNRESOLVED → DENIED →
   NO EXECUTION (proven: ARCH-1, SUP-2, CT-3/CT-6, S6).
2. **Model claims success** → UNTRUSTED → probes over runtime evidence
   decide VERIFIED/UNVERIFIED/FAILED (proven: ARCH-2, INT-2, S38).
3. **Workload attempts escape** → blocked at the boundary → execution
   failure / blocked-effect result → durable evidence, no authority
   escalation (proven: ARCH-3, S15, CT-9).

## Verification

- `process-backend.security.test.ts` (17): env sealing, planted-secret
  isolation, timeout/cancel enforcement, traversal, output containment,
  resolver negotiation.
- `container-backend.security.test.ts` (10): availability honesty,
  fail-closed daemon-down, ALLOWLIST refusal, secrets refusal; live-daemon
  enforcement (network namespace sealed; kernel OOM kill) behind
  QUACK_P13_CONTAINER=1.
- `supervisor.security.test.ts` (20): full lifecycle, denial evidence,
  evidence identity binding, digest tamper rejection, crash-window
  reconciliation, probe behavior, adapter rules, observability.
- `secure-isolation.integration.test.ts` (7): end-to-end chain — broker →
  adapter → supervisor → real process → probe VERIFIED; hostile payloads
  stay data; broker denial precedes isolation.
- `secure-isolation.security.test.ts` (36): the S-matrix — model influence,
  downgrade, forgery, replay, boundary escapes, concurrency isolation,
  masquerading backends, the three architectural tests.
- `secure-isolation.review-fixes.test.ts` (16): the review-fix round —
  adapter-REJECTED DENY with zero host dispatch, required isolation
  without adapter DENY, BEST_EFFORT-process resolver rejection, symlink
  entry DENY, evidence stepIndex alignment + mismatch rejection,
  settlement-failure verdict downgrade (INCONCLUSIVE, never PASSED), loop
  journal-settlement AMBIGUOUS classification, symlink/nested-symlink/
  realpath fs-probe escapes, trusted-store/workspace separation, SHA-256
  trust-boundary consequences.
- Full repository regression: see CURRENT_STATE.md for counts.

## Explicit limitations

- The process backend is NOT a security sandbox: filesystem containment is
  BEST_EFFORT (same OS user), network is UNSUPPORTED. Only the container
  backend enforces OS-level filesystem/network/memory boundaries, and it
  requires a live Docker daemon with the pinned Node image.
- Filesystem-effect probes on the process backend carry a documented
  TOCTOU race (resolve-then-stat is not atomic against a same-user
  attacker); the container backend removes it by not sharing the host
  filesystem.
- The evidence digest is content identity, not authenticity against a
  store-write attacker (F9 boundary, above).
- Only `module`-shaped workloads cross the isolation boundary. Registered
  host functions cannot be moved into a backend without an adapter
  contract; they stay POLICY_RESTRICTED.
- Exactly-once execution is NOT claimed anywhere. At-most-once dispatch
  (P12 journal) plus crash-window AMBIGUOUS/UNCERTAIN reconciliation is the
  honest guarantee; a journal-settlement failure now classifies the step
  AMBIGUOUS rather than reporting an unconfirmable outcome.
- Isolated-workspace cleanup is best-effort after bounded retries; failure
  is recorded (CLEANUP_FAILED + event), never hidden, and the OS eventually
  reclaims its tmpdir.
- No secret mediation exists across any backend boundary; secret-demanding
  profiles fail closed.
- Memory/CPU limits are ENFORCED only on the container backend (cgroups);
  the process backend reports resources BEST_EFFORT (termination at
  wall-clock only).
- `external_check` probes are not implemented (fail-closed INCONCLUSIVE) —
  a future contract could allow verifying one capability via another under
  explicit authority.
- P10 extensions remain REGISTERED/ADMITTED/NOT-EXECUTABLE. An isolation
  backend is not — and cannot become — a path to execute extension
  packages: extension ids have no workload adapter (S28 proof).
