# ADR 0046: Secure Execution and Isolation

## Status

Accepted — 2026-09-12

## Context

P11 (ADR 0045) delivered the governed mission loop: the model proposes, the
parser validates fail-closed, the one CapabilityBroker authorizes, existing
surfaces execute. What P11 did NOT provide:

1. A **canonical, serializable execution policy** describing HOW a
   capability may run. Effective timeout was computed from
   `min(proposal.timeoutMs, descriptor, riskTier)` — the proposal's own
   timeout value fed the calculation (defense-in-depth weakness: model
   output influencing a runtime limit, even though the parser clamped it).
2. An **honest isolation contract** for mission-loop execution. The governed
   path executes registered host functions (action providers, core tools)
   inside the host process. Nothing labeled what boundary that actually is.
3. **Crash-window replay protection at the step level.** The ActionRuntime
   idempotency ledger dedupes by request hash `{actionId, input, dryRun}`;
   two different ARGUMENTS for the same (mission, step, capability) are
   different requests, so a crash between "model proposed" and "settled"
   could re-execute with fresh arguments after restart.
4. **Explicit execution-state classification.** "Execution returned
   SUCCEEDED" was implicitly treated as the terminal truth of the step;
   no distinction between completed, verified, timed out, cancelled,
   denied, or ambiguous outcomes.
5. **Bounded output containment** at the governed execution boundary.

## Decision

P12 adds a POLICY-ENFORCEMENT layer over the existing authorities. Zero new
brokers, event buses, evaluators, or execution paths. The architecture:

```
ActionProposal (P11, server-derived)
    → CapabilityBroker authorization (existing, unchanged)
    → ExecutionPolicy (NEW: canonical, deterministic, server-derived)
    → IsolationState (NEW: honest classification, fail-closed)
    → existing execution surfaces (ActionRuntime / runtime.executeTool)
    → output containment (NEW: boundary clamp)
    → ExecutionState classification (NEW: runtime evidence only)
    → StepAttemptJournal settlement (NEW: at-most-once dispatch)
    → MissionRuntime state update (existing, unchanged)
```

### 1. Execution policy (`src/runtime/mission-lifecycle/execution-policy.ts`)

`resolveExecutionPolicy(input)` derives the policy EXCLUSIVELY from
runtime-trusted inputs: descriptor risk class, descriptor timeout,
risk-tier ceilings, and deployer configuration. **Proposal payloads are not
consulted at all** — the harness now uses `policy.timeoutMs` and never
`proposal.timeoutMs`. The policy carries: capability, provider kind, risk
level, timeout, isolation state + requirement + backend, filesystem/network
(`CAPABILITY_SCOPED` — broker-scoped, explicitly NOT a sandbox claim),
credentials (`BROKER_AUTHORIZED_ONLY`), limits (attempts=1, output bytes,
concurrency, memoryBytes=null), cancellation mode, and the verification
rule for irreversible actions (`FAIL_CLOSED_WITHOUT_RUNNER`).

Deterministic and serializable: canonical sorted-key form with a sha256
digest. `parseExecutionPolicy` fails closed on unknown fields, wrong
version, semantic violations, digest mismatch — and rejects any policy
claiming an ENFORCED memory limit (this runtime cannot enforce memory; a
policy claiming it is dishonest by definition).

### 2. Isolation honesty (`IsolationState`)

Distinct from the ADR 0039 `IsolationLevel` (skill workload request
vocabulary), `IsolationState` names what the governed path can PROVE:

- `POLICY_RESTRICTED` — registered host functions under broker policy.
  This is the DEFAULT and it is a policy boundary, never labeled a sandbox.
- `PROCESS_ISOLATED` — only when a real `IsolationBackend` supporting the
  required level is wired (none is, in v1 compositions).
- `OS_ISOLATED` — container-level; no backend exists; cannot be granted.
- `FAILED_CLOSED` — a trusted configuration demanded isolation that no
  backend provides. The execution is DENIED, a durable
  `execution.denied` event is emitted, and there is NO silent downgrade.
- `UNISOLATED` — reserved for surfaces that honestly run without broker
  policy; not produced by the governed path.

Rule: required isolation unavailable → deny → never "execute anyway".

### 3. At-most-once dispatch (`step-attempt-journal.ts`)

`StepAttemptJournal` (JSON-file durable, or in-memory) records
`DISPATCHING` BEFORE the harness dispatches, and settles to
`COMPLETED | FAILED | AMBIGUOUS` after settlement, classified from runtime
evidence only. Key = `missionId:stepIndex:capability`.

- Timeout, cancellation, and harness throws settle `AMBIGUOUS` (the
  external effect may have happened).
- Crash between reserve and settle leaves `DISPATCHING`; on the next
  `run()` (or `reconcileOrphans()` at composition time) it transitions to
  `AMBIGUOUS` and is **never re-dispatched**.
- `reserve()` is idempotent-refusing: an existing attempt key blocks any
  second dispatch across process restarts.

Exactly-once is NOT claimed. This is replay-protected at-most-once
dispatch; ambiguous attempts require verification or operator decision.

### 4. Execution-state classification

`classifyExecutionState` maps runtime evidence to:
`EXECUTION_VERIFIED | EXECUTION_COMPLETED | EXECUTION_FAILED |
EXECUTION_TIMED_OUT | EXECUTION_CANCELLED | EXECUTION_DENIED |
EXECUTION_AMBIGUOUS`. "SUCCEEDED without verification evidence" is
`EXECUTION_COMPLETED`, never `EXECUTION_VERIFIED` — the model/provider
cannot self-report verified success. The classification is persisted in
the iteration record's observations and surfaced through CLI/Server/Studio.

### 5. Containment (enforced vs advisory)

- **Wall-clock timeout: ENFORCED** — harness AbortController timer +
  deadline; policy-owned ceiling; timeout is a deterministic failure, no
  hidden retry (the loop's bounded model/parse retries never re-dispatch
  a settled step).
- **Output bytes: ENFORCED** — `clampOutputBytes` at the harness boundary;
  oversized output is DROPPED (never previewed — a preview could leak
  credentials) and replaced by `{quackTruncated, byteLength, limitBytes}`.
- **Attempts: ENFORCED** — maxAttempts=1 per (mission, step, capability),
  durable journal.
- **Concurrency: ENFORCED in-process** — `maxConcurrentSteps` guard;
  exhaustion fails closed with `mission.concurrency_exhausted`, never
  unbounded queueing. Cross-process concurrency beyond the journal's
  reserve semantics is out of scope.
- **Memory bytes: ADVISORY (null)** — Node.js on this runtime cannot
  reliably enforce per-execution memory; the policy serializes null and
  `parseExecutionPolicy` rejects any claim otherwise.

### 6. Cancellation

Operator cancellation flows through the existing loop AbortSignal into the
harness; settlement is awaited (P11 behavior preserved), the journal
settles AMBIGUOUS, and re-runs of the mission are refused. Cancellation
never leaves work silently running in the background: the harness awaits
settlement even after abort.

## What P12 is NOT

- **Not a sandbox.** No OS-level, container, or VM isolation exists for
  the governed path. `POLICY_RESTRICTED` is broker-policy enforcement of
  registered host functions — the same trust boundary as P11, now
  explicitly named and never overstated.
- **Not extension execution.** P10 packages remain REGISTERED/ADMITTED/
  NOT-EXECUTABLE. Proposing an extension id as a capability fails at the
  parser (unknown capability). No adapter loads extension content.
- **Not provider-specific.** The policy is provider-neutral; provider
  behavior beyond the descriptor contract never influences policy fields.
- **Not a second authority.** Authorization remains the one
  CapabilityBroker; the policy governs HOW, not WHETHER.

## What P13/P14 would need

For real process/OS isolation of governed actions: a production
`IsolationBackend` binding (the ADR 0039 worker backend is real for
module workloads — crash/timeout/env containment — but is NOT a security
boundary and is inapplicable to registered host functions), a container/
microVM backend with per-capability adapter contracts, probe-runner
verification to unlock IRREVERSIBLE execution, and cross-process
coordination of the concurrency bound. The fail-closed isolation gate is
the seam they plug into: they make more levels SUPPORTED; nothing else
changes.

## Security boundaries

1. Model output can request a capability; it never determines risk,
   sandbox, timeout, limits, credentials, or verification (parser shape
   rules + policy derivation; P12 adversarial matrix S1-S5).
2. Required-but-unavailable isolation DENIES with a durable event; no
   downgrade path exists (S22/S23).
3. Timeout/cancellation/crash leave the step AMBIGUOUS and permanently
   non-re-dispatchable (S11-S13).
4. Oversized output is dropped, flagged, never previewed (S15); oversized
   arguments never reach dispatch (S16, P11 parser).
5. Events are metadata-only: policy digest, timeout value, capability id,
   states — no prompts, model output, arguments, or secrets.
6. The journal fails closed on tampered/forged records (identity checks
   on load; terminal states cannot be re-opened by re-reservation).

## Verification

- `execution-policy.test.ts` — 15 unit tests: determinism, digest
  stability, fail-closed parse (unknown fields, tampering, dishonest
  memory claims), isolation matrix, classification, output containment,
  journal reserve/settle/orphan-reconciliation/durability/tampering.
- `secure-execution.security.test.ts` — 26 adversarial tests (S1-S26):
  escalation, forgery, replay, containment, injection, bypass, isolation
  failure, resource exhaustion, cross-mission isolation, journal
  tampering.
- Existing suites preserved: governed-loop (P11) 16/16, security 12/12,
  harness, state machine, server, Studio, CLI, SDK — all green.

## Explicit limitations

- `POLICY_RESTRICTED` is policy enforcement, not isolation. A compromised
  host function still runs in-process; only the broker stands between a
  proposal and that function.
- Worker isolation (ADR 0039) exists for skill module workloads but is
  NOT wired into the governed loop — host functions cannot be moved into
  it without an adapter contract, and it is not a security boundary today.
- Memory limits are advisory-only and serialized as null.
- The concurrency bound is per-process; the durable journal bounds
  duplicate dispatch, not simultaneous cross-process execution of
  DIFFERENT steps.
- No probe-runner verification: `trust_executed` success stays
  `EXECUTION_COMPLETED` (UNVERIFIED); IRREVERSIBLE/DESTRUCTIVE execution
  remains fail-closed unsupported.
