# ADR 0048: Durable Mission Recovery and Verified Actions (P14)

Date: 2026-09-13
Status: Accepted
Phase: P14 — Durable Mission Recovery + Verified Actions
Predecessors: ADR 0045 (governed mission loop), ADR 0046 (secure execution), ADR 0047 (real isolation backends)

## Context

P13 delivered safe bounded execution: CapabilityBroker authorization →
execution policy → real isolation backends → trusted evidence → probe
verification → durable settlement, with at-most-once step dispatch and
crash-window reconciliation at the step level. P13 deliberately stopped
before four capabilities:

1. **Mid-run durable recovery** — a process crash mid-mission left a
   non-terminal run record that the P11 loop treated as terminal
   (`stored.stopReason ?? "STOP_GOAL_ACHIEVED"`), so a crashed run could
   never resume, and budget counters reconstructed to zero (a budget-reset
   exploit).
2. **Approval runner** — IRREVERSIBLE and DESTRUCTIVE actions failed closed
   unconditionally (correct, but unusable: no governed path existed for an
   operator to approve one).
3. **Production workload adapters** — the P13 adapter registry shipped
   empty; no capability was isolation-eligible in production wiring.
4. **Recovery observability** — no checkpoint record, no recovery events,
   no inspection surfaces.

## Decision

P14 turns the governed runtime from "safe bounded execution" into
"recoverable, verification-aware, production-capable governed execution"
while preserving the P8–P13 authority model exactly: one CapabilityBroker,
one EventBus, one evaluator, one QIE pipeline, one mission authority, one
execution authority. **No new authorities were introduced.** Recovery and
approval orchestrate existing records and seams; they never authorize or
execute anything themselves.

### 1. Durable mission checkpoint (`src/runtime/mission-lifecycle/mission-recovery.ts`)

A **MissionCheckpoint** is a metadata-only, digest-protected record of
trusted runtime state: mission identity, canonical mission state, next
step index, last settled step, ambiguous step, cumulative budget counters,
and sha256 digests binding it to the journal and run records it was derived
from.

- Deterministic identity: `(missionId, runId, journalDigest, runDigest)`.
- Tamper-evidence: `missionCheckpointDigest` over the canonical
  (key-sorted) form; `parseMissionCheckpoint` fails closed on unknown
  schema versions, unknown fields, malformed values, and digest mismatch.
- Cross-mission reuse impossible: loading a checkpoint file whose
  self-claimed `missionId` does not match the requested id throws
  (identity mismatch).
- **Never persisted**: chain-of-thought, prompts, raw arguments, secrets,
  credentials, arbitrary model context. Checkpoints store counters and
  digests only (proven by test R46: a secret-bearing goal never appears in
  the serialized checkpoint).
- The checkpoint never blocks the run: write failures are surfaced as
  `mission.recovery_ambiguous` events while the journal + run record stay
  authoritative (proven by test R35).

### 2. Recovery state machine

Recovery states are explicit and fenced (`assertRecoveryTransition`):

```
CLEAN, RECOVERING, SAFE_TO_RESUME, REQUIRES_VERIFICATION, AMBIGUOUS, TERMINAL
```

Legal transitions only. `AMBIGUOUS → RUNNING`-equivalent resume does not
exist without trusted reconciliation; `REQUIRES_VERIFICATION` cannot
re-enter `RECOVERING`; `TERMINAL` transitions to nothing. The mission state
machine (ADR 0045) owns the actual mission-state transitions — recovery
composes only legal chains through it:

```
RUNNING/STARTING/WAITING → INTERRUPTED → RECOVERING → RUNNING
BLOCKED → WAITING → INTERRUPTED → RECOVERING → RUNNING
CREATED/QUEUED → admission chain
RECOVERING → RUNNING (died mid-recovery; reconciliation re-ran)
```

### 3. Mid-run crash recovery (`reconcileMission`)

On restart, `GovernedMissionLoop.run` over a stored non-terminal run:

1. Runs the existing P12 journal orphan pass (`reconcileOrphans`) —
   DISPATCHING attempts become AMBIGUOUS.
2. Reconciles durable records into a `RecoveryDecision`:
   - **Terminal run** (explicit stopReason) → TERMINAL; resume refused
     (unchanged P11 idempotent-replay refusal).
   - **Ambiguous attempt exists** (AMBIGUOUS, or DISPATCHING read during
     recovery — a crash window by definition) → REQUIRES_VERIFICATION, no
     resume point. The runtime NEVER re-dispatches an uncertain action and
     never steps over one. Resolution requires trusted evidence or an
     explicit operator refusal; there is no automatic AMBIGUOUS → retry.
   - **All settled** → SAFE_TO_RESUME with the safe boundary at
     `max(lastSettledStep + 1, run-record cursor)`. Verified/settled steps
     are stepped OVER — never re-executed.
3. Restores consumed budget (below), transitions the mission through the
   canonical crash chain, and resumes at the safe boundary.

### 4. Budget recovery

Each iteration record now carries `usageSnapshot` — the cumulative
(modelCalls, toolCalls, cost) counters at step end. `appendIteration` folds
it into `run.usage`; `restoreUsage` reconstructs consumed budget on
restart as the conservative maximum of the record's counters and the last
snapshot. **A restart can only under-report remaining budget, never grant
budget back.** An exhausted crashed budget terminates with the honest stop
reason and zero additional model dispatches (R4/R4b/R37).

### 5. Crash windows (P14.7)

| Window | State on recovery | Behavior |
|---|---|---|
| A: before dispatch | no journal record | SAFE_TO_RESUME; step restarts cleanly |
| B: after dispatch, before settle | DISPATCHING → AMBIGUOUS | REQUIRES_VERIFICATION; parked |
| C: during execution | DISPATCHING → AMBIGUOUS | REQUIRES_VERIFICATION; parked |
| D: after execution, before evidence | DISPATCHING → AMBIGUOUS | parked; verification never survives (P13 evidence reconcile) |
| E: after evidence, before verification | PENDING-cleanup evidence | reconciled UNCERTAIN/UNVERIFIED |
| F: after verification, before settlement | settled journal missing | parked (verification not trusted) |
| G: after settlement, before checkpoint | settled journal present | SAFE_TO_RESUME; the loop re-checkpoints |

Windows B–F never assume success. Window G is closed structurally: the
loop writes a checkpoint after every settled iteration and its durable
records.

### 6. Replay protection (P14.5)

P13 at-most-once semantics are preserved unchanged: `(missionId, stepIndex,
capability)` keys reserve exactly once across processes (R5 proves a fresh
journal over the same durable files cannot re-reserve a settled step).
Recovery adds no redispatch path — ambiguity parks, it never retries.

### 7. Approval runner (`src/runtime/mission-lifecycle/approval-contract.ts`)

**Authorization ≠ approval.** The broker still decides capability; the
approval runner decides whether a human accepts the irreversible
consequence of THIS EXACT action. The P13 hard fail-closed throw in the
harness is replaced by a governed gate:

```
MODEL PROPOSES → BROKER AUTHORIZATION → RISK = IRREVERSIBLE/DESTRUCTIVE
  → HUMAN APPROVAL CALLBACK (identity-bound, digest-bound, single-use)
  → EXECUTION POLICY → ISOLATION → EXECUTION → VERIFICATION
```

- **Identity binding**: `canonicalProposalDigest` = sha256 over the
  canonical form of (capability, arguments, intent, missionId, stepIndex).
  Approval(A) ≠ Approval(B) unless the digests are equal — approvals never
  transfer across mission, step, capability, arguments, or policy (P14.24,
  proven by R11–R14).
- **Single use**: a GRANTED record is CONSUMED at exactly one dispatch;
  replay is refused (R10/R19).
- **Model cannot approve**: forbidden-approver identities (the proposing
  actor, "model", "system", …) are refused before the callback runs (R15);
  model-supplied approval fields in proposals are data and grant nothing
  (R16 — the harness consults only the trusted runner).
- **No runner wired** → still P13 fail-closed behavior (R18).
- **Tamper-evidence**: approval records are digest-protected and fail-closed
  on parse (unknown fields, contradictions, digest mismatch) (R9).
- **Honest ceiling, documented**: the approval store trusts digest
  integrity for write-attacker scenarios (F9 boundary); the enforcement
  points are the runner's semantic checks and the harness's single
  consumption path.
- Console (stdin y/N) and auto-DENY callbacks ship; the runtime wires the
  console callback for the governed mission loop.

### 8. Verification for irreversible actions (P14.11)

Approval unlocks execution; it never fabricates verification. An approved
destructive action with no trusted probe stays honestly
`EXECUTION_VERIFIED`-never: execution status SUCCEEDED + verification
INCONCLUSIVE = EXECUTION_COMPLETED/UNVERIFIED (R20/R21). Where safe probes
exist, they decide VERIFIED/UNVERIFIED from runtime evidence alone (P13
unchanged).

### 9. Adapter contract extension + first production adapters

Every adapter must now declare (registration fails closed on every
violation):

- `verification` strategy — `deterministic_result` (with probes),
  `filesystem_probe`, or honest `none` (with reason). Missing/invalid
  declarations reject (R23).
- `riskLevel` — READ_ONLY/REVERSIBLE only; destructive workloads are NOT
  isolation-eligible (they need the approval contract first).
- `network: DENY`, `credentials: NONE`, `filesystem: WORKSPACE_ONLY` —
  v1 adapters may not demand more.
- `timeoutMs` ceiling, `argumentSchema`, strict argument validation
  (unknown top-level fields REJECT — R49/R50).

The first production adapters registered by `registerProductionAdapters`
(trusted deployer wiring in `swe-system`, synchronous,
content-identity-checked materialization under the OS temp dir):

- **`quack.text.transform`** — deterministic bounded-text transform.
- **`quack.data.process`** — deterministic structured-data processing
  (sort + bounded stats).

Both are READ_ONLY, schema-validated, verified by deterministic result
probes, and were smoke-tested through the REAL OS-process backend. No
shell, no subprocess, no eval, no network client, no arbitrary code
execution exists anywhere on the path (R45: shell-metacharacter payloads
transform AS TEXT). The model can only NAME a registered capability; it
can never select, register, or configure adapters (R25/R26/R48).

### 10. Observability

Metadata-only events on the existing EventBus:
`mission.recovery_started`, `mission.recovery_completed`,
`mission.recovery_ambiguous`, `mission.checkpoint_written`,
`mission.approval_requested`, `mission.approval_granted`,
`mission.approval_denied`, `execution.verification_pending`,
`execution.verification_completed`. Payloads carry ids, states, and
counters — never goals, prompts, or arguments (R46/PROD-3).

### 11. Surfaces

- **Server** `GET /governed-missions`: adds `recovery` (state,
  nextStepIndex, lastSettledStep, ambiguousStep) and `checkpoint` fields —
  read-only metadata.
- **Studio**: a Recovery route renders Mission → Recovery (state, next
  step, last settled step, ambiguous step, checkpoint) and Step →
  Verification (RUNNING/RECOVERING/WAITING_APPROVAL/VERIFIED/UNVERIFIED/
  AMBIGUOUS). No force-resume, skip-step, or verification-override control
  exists; AMBIGUOUS renders parked; UNVERIFIED never borrows VERIFIED
  styling; WAITING_APPROVAL derives from the approval surface, distinct
  from execution state.
- **CLI**: `quack govmission recover <id>` — inspection only (durable
  recovery state + checkpoint). No `--force`, `--skip-approval`,
  `--ignore-isolation`, or `--resume-unsafe` flag exists or will exist.
- **SDK**: provider-neutral exports — checkpoint contract
  (build/parse/digest/stores), `reconcileMission`,
  `assertRecoveryTransition`, the approval contract
  (ApprovalRunner/canonicalProposalDigest/parseApprovalRecord/callbacks),
  `registerProductionAdapters`, `WorkloadAdapterRegistry`, and the
  inspection types (`MissionCheckpoint`, `RecoveryState`, `RecoveryInfo`,
  `ApprovalInfo`, `ApprovalRecord`, `AdapterInfo`,
  `MissionCheckpointInfo`). No privileged recovery functions, approval
  callbacks beyond the defaults, broker internals, or backend handles.

### 12. Security matrix (R1–R50)

`src/runtime/mission-lifecycle/p14-recovery-security.test.ts` — 55 tests
proving the adversarial properties: checkpoint tamper/identity/schema
(R1–R3), budget reset (R4/R4b/R37), replay (R5–R7), evidence identity (R8),
approval forgery/replay/binding (R9–R14), model self-approval and token
smuggling (R15/R16), risk downgrade (R17), destructive without/with
approval (R18/R18b/R19), irreversible verification honesty (R20–R22),
adapter forgery/duplicates/model-selection (R23–R26), unsupported
isolation/downgrades (R27/R28), crash windows (R29–R33), settlement and
cleanup failures (R34–R36), cross-mission/cross-step reuse (R38–R41),
recovery authority bypass (R42), construction fencing (R43), direct
execution bypass (R44), shell injection (R45), credential leakage (R46),
trusted-store blast radius (R47), extension execution (R48), malformed
and oversized arguments (R49/R50), plus the recovery, approval, and
adapter properties as fenced assertions.

## Honest claims and non-claims

**At-most-once, NOT exactly-once.** The journal guarantees a step is
dispatched at most once per (mission, step, capability). An ambiguous step
means the external effect is UNKNOWN — it may have happened, partially
happened, or not happened. No exactly-once claim is made anywhere.

**Recovery restores state, never authority.**
`Authority_after_restart ≤ Authority_before_restart`: recovery never
grants capability (R42 — an unprovisioned mission resumes and is still
broker-denied), and the recovery-state fence has no transition that
reaches resume from an unresolved ambiguous state.

**Process isolation guarantees** are the P13 honest set: PROCESS and
ENVIRONMENT ENFORCED on the OS-process backend; filesystem BEST_EFFORT
(same OS user); network DENY-only; secrets unsupported. Container
isolation remains availability-probed (Docker-gated tests skip
honestly on hosts without the daemon).

**What is still not supported:**
- No automatic resolution of ambiguous steps (operator decision required).
- No workflow-level (multi-mission) recovery.
- No approval TTL/expiry on the runner contract (the P1 queue keeps its
  own expiry; the runner consumes decisions, it does not park them).
- Adapters are READ_ONLY transforms only; no write-filesystem, network,
  or credential-demanding adapter will register in v1.
- Extension packages remain non-executable catalog entries; no extension
  can register an adapter.

## Consequences

- A crashed governed mission now resumes at a verified safe boundary with
  its budget intact, or parks honestly — never blindly replays.
- IRREVERSIBLE/DESTRUCTIVE actions have a governed human-approval path
  where an operator surface exists, and remain fail-closed without one.
- The adapter registry now has real, minimal, production-safe entries;
  the extension boundary is unchanged.
- All P11–P13 tests pass unmodified in semantics (two tmpdir-sweep
  assertions were narrowed to their own executions' directories because
  parallel process-spawning suites made whole-tmpdir sweeps
  unassertable; the cleanup invariants are preserved and still proven).
