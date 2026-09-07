# Action / Result Contract Spec

Status: **canonical contract — Phase 2 of production hardening**
Pair with: `src/runtime/mission-lifecycle/action-contract.ts`

---

## 1. Purpose

Two action contracts already exist in the repo:

- **`ActionRequestV1` / `ActionResultV1` / `ActionDescriptorV1`**
  (`src/contracts/v1/contracts.ts:209-266`) — the **provider-facing**
  contract. Minimal: `actionId`, `input`, `dryRun`, `idempotencyKey`.
  Versioned via `contractVersion`. This contract is correct and stays
  untouched.
- **`ActionRuntime`** (`src/actions/runtime.ts`) — the harness boundary
  that already enforces schema validation, permission checks, approval,
  idempotency at the boundary, evidence recording, audit, cancellation,
  and reconciliation. Audit §26 calls this "the only properly durable,
  idempotency-keyed, reconcilable execution primitive in the repo."

What was missing (audit §6, §25.1, §28.14, §29):

- a **loop-facing** proposal shape that carries the full prompt §6 surface:
  capability, intent, risk level, timeout, idempotency key, expected
  effect, and verification strategy;
- a **decision-vs-execution boundary** so the planner/model does not call
  `restart_service()` directly (audit §6);
- **expected-effect & verification strategy** on proposals — today
  `AgentLoop.verify()` (agent-loop/index.ts:450-460) defaults to "execution
  succeeded ⇒ verification passed," which is the audit §25.1 unsafe
  assumption;
- **executed-vs-goal-success separation** (audit §29) — execution success
  is not goal success;
- a **sandbox classification** so the harness knows what execution class
  it is invoking (audit §38).

`ActionProposal` + `ResultVerification` below add these to the runtime
without replacing the v1 contracts.

---

## 2. Types

### 2.1 Risk level

```
type ExecutionRiskLevel =
  | "READ_ONLY"
  | "REVERSIBLE"
  | "IRREVERSIBLE"
  | "DESTRUCTIVE";
```

This is the runtime's canonical action-risk dimension. It maps onto the
existing `ActionRiskClass` (`src/contracts/v1/contracts.ts:199`) and onto
`classifyPermissionAction`'s `READ | REVERSIBLE_CHANGE | IRREVERSIBLE_ACTION`
(`src/security/capability-broker.ts:359`), which audit §23.6 flagged as
the only classifier the prompt asked for that already exists but is used
only for audit context. This contract promotes it to the proposal
dimension.

| This contract's `ExecutionRiskLevel` | Maps from `ActionRiskClass` (v1) | Maps from `classifyPermissionAction` |
|---|---|---|
| `READ_ONLY` | `READ_ONLY` | `READ` |
| `REVERSIBLE` | `LOW_RISK_WRITE` | `REVERSIBLE_CHANGE` |
| `IRREVERSIBLE` | `DATA_MODIFICATION`, `EXTERNAL_COMMUNICATION`, `SECURITY_SENSITIVE`, `ADMINISTRATIVE` | `IRREVERSIBLE_ACTION` |
| `DESTRUCTIVE` | `DESTRUCTIVE`, `FINANCIAL` | `IRREVERSIBLE_ACTION` (with marker) |

The `DESTRUCTIVE` split exists because operational policy (human approval,
dry-run requirement) wants to single out combinations that are both
irreversible **and** catastrophic if carried out by mistake.

### 2.2 Sandbox class

```
type ExecutionSandbox =
  | "IN_PROCESS_TRUSTED"
  | "LOCAL_ISOLATED"
  | "EXTERNAL_TRUSTED"
  | "EXTERNAL_UNTRUSTED"
  | "PHYSICAL"
  | "HUMAN";
```

Directly from audit §38. The harness classifies every capability it
invokes. `PHYSICAL` is reserved for future NAVIQ capabilities (audit §20);
`HUMAN` is the human-in-the-loop approval path (audit §19). The current
runtime only has `IN_PROCESS_TRUSTED` (in-process tools), `EXTERNAL_TRUSTED`
(MCP, REST), and (eventually) `HUMAN`. The contract is defined even where
the runtime does not yet exercise it.

### 2.3 Action proposal

```ts
interface ActionProposal {
  id: string;              // createId("proposal")
  missionId: string;
  capability: string;      // resolved capability id (was "actionId" in v1)
  providerId?: string;     // resolves via CapabilityRouter (Phase 4)
  arguments: JsonObject;
  intent: string;          // human-readable reason
  riskLevel: ExecutionRiskLevel;
  sandbox: ExecutionSandbox;
  idempotencyKey?: string; // REQUIRED for non-read side effects (enforced at harness)
  timeoutMs: number;
  expectedEffect?: ExpectedEffect;
  verificationStrategy?: VerificationStrategy;
  selectionReason: string; // why the planner picked this capability
  proposedAt: IsoTimestamp;
  proposedBy: string;      // "agent-loop" | "planner" | "human" | ...
}
```

`lowerProposal(proposal): ActionRequestV1` lowers this to the provider-
facing v1 request: `capability → actionId`, `arguments → input`,
`idempotencyKey → idempotencyKey`, `dryRun → false`. The harness never
sees the proposal directly; it receives the v1 request. The loop loses
no information because the proposal carries the full audit surface.

### 2.4 Expected effect + verification

```ts
interface ExpectedEffect {
  description: string;
  successProbes: readonly EffectProbe[];
}

type EffectProbe =
  | { kind: "output_field"; path: string; equals?|notEquals?|contains?|matches? }
  | { kind: "status_equals"; value: string }
  | { kind: "no_error" }
  | { kind: "external_check"; capability: string; arguments: JsonObject; assertion: string };

type VerificationStrategy =
  | { kind: "trust_executed"; reason: string }
  | { kind: "probe_external_state"; capability: string; arguments: JsonObject; expected: ExpectedEffect }
  | { kind: "evaluator_with_objective"; objectiveId: string; reason: string }
  | { kind: "human_confirm"; actor: string };
```

`verifyActionResult(proposal, result, runner?)` returns a
`ResultVerification` with `status ∈ PASSED | FAILED | INCONCLUSIVE | SKIPPED`:

- **SKIPPED** — proposal has no `verificationStrategy` or no
  `expectedEffect` on a non-trust strategy. Phase 3 makes a strategy
  *required* on any `riskLevel >= IRREVERSIBLE` proposal; until then a
  missing strategy is SKIP, not silent PASS (audit §25.1).
- **FAILED** — action did not `SUCCEEDED`, *or* the verification strategy
  ran and the expected effect probes did not pass.
- **INCONCLUSIVE** — strategy requires an external probe runner but none
  is supplied, or a probe's `output_field` path is absent on the result.
- **PASSED** — strategy ran and the probes matched.

`checkExpectedEffect(result, expected)` returns
`{ status, failures: readonly string[] }`. The loop records the failures
on the iteration record (Phase 4). Probes intentionally fall back to
`INCONCLUSIVE` rather than assuming "missing => passed" (audit §25.1).

### 2.5 Outcome

```ts
interface ActionOutcome {
  proposalId: string;
  executionId: string;
  missionId: string;
  executedAt: IsoTimestamp;
  actionResult: ActionResultV1;     // the v1 result from ActionRuntime.execute
  verification?: ResultVerification; // verifyActionResult output, if invoked
}
```

`ActionResultV1` (v1) keeps its current shape: `executionId`, `providerId`,
`actionId`, `status`, `output`, `evidenceIds`, `compensationToken`. The
outcome wraps it with the verification record so the loop can record
"action executed + verified" as one atomic observation.

---

## 3. Decision / Execution Boundary

```
Planner / Model
   produces ActionProposal (no infrastructure access)
       │
       ▼
Authorization Gate (Phase 7 — Policy / Permission)
   rejects or ratifies the proposal
       │
       ▼
Capability Router (Phase 4)
   resolves providerId from capability + sandbox
       │
       ▼
Harness (existing ActionRuntime.execute)
   lowerProposal → ActionRequestV1 → descriptor lookup →
   schema validation → permission check → idempotency gate →
   ledger record → provider.execute → result
       │
       ▼
verifyActionResult (this contract)
   runs the proposal's verification strategy against the result
```

The planner only ever produces an `ActionProposal`. It cannot call
`restart_service()` directly. The proposal becomes `ActionRequestV1`
only inside `ActionRuntime.execute`, behind the existing permission +
schema + idempotency + ledger gates. This is the audit §6 hard
requirement plus the prompt's §5 separation.

---

## 4. Idempotency (audit §15, §19)

`ActionProposal.idempotencyKey` is **optional** on the type but
**required** at the harness for any non-read side effect — enforced
inheritedly from `ActionRuntime` runtime.ts:116-120:

```
if (!descriptor.idempotent && descriptor.sideEffect !== "read" && !request.idempotencyKey)
   → DENY: "Non-idempotent write actions require an idempotency key."
```

This means a proposal with `riskLevel ∈ {REVERSIBLE, IRREVERSIBLE,
DESTRUCTIVE}` and no idempotency key is rejected by the harness before
the provider is called. The runtime's database-level guarantee is
`idx_action_ledger_idempotency` (storage/sqlite.ts:461) — same idempotency
key cannot produce two committed side effects (audit §34 invariant).

Audit §19 flagged that tool execution (`QuackRuntime.executeTool`) has no
idempotency key at all today. Phase 4 lifts `ActionRuntime`'s behavior
to the tool boundary. The proposal carries the key today; the harness
will start demanding it from tool execution in Phase 4.

---

## 5. Verification (audit §18, §25.1, §29)

The default verification strategy is **trust_executed** — execution
succeeded ⇒ verification passed — explicitly named so that the
audit §25.1 unsafe assumption stops being the **implicit** default and
becomes an **explicit** opt-in the planner declares in prose (`reason`).
Phase 3 will make `verificationStrategy` mandatory when `riskLevel >=
IRREVERSIBLE`; until then, missing strategy = SKIP (not PASS), and a SKIP
outcome is recorded on the iteration record so post-hoc audit can
distinguish "verified" from "not verified."

Probes intentionally degrade to INCONCLUSIVE rather than happy-path PASS
when the output field is missing. The audit's example (§18):

```
command:       restart server
result:        command returned 0
actual system:  server still unavailable
```

…only becomes survivable when the planner attaches
`probe_external_state` against the `/healthz` endpoint. There is no
silent PASS path.

Goal-progress evaluation (audit §29) is **separate** from action
verification: action verification answers "did the expected
*side-effect* occur?" Goal progress answers "did the *mission* advance?"
The latter is the loop's evaluator, Phase 3.

---

## 6. Test plan (Phase 2)

`src/runtime/mission-lifecycle/action-contract.test.ts` — 17 tests:

- `createProposal` assigns id + proposedAt.
- `lowerProposal` round-trips capability ↔ actionId, threads arguments,
  keeps and omits idempotency key, never sets dry-run.
- `executionContextFor` threads missionId/executionId/actor and the
  default `QUACK_CONTRACT_VERSION`; passes signal/deadline through.
- `verifyActionResult` SKIPS with no strategy, FAILS on `result.status
  != SUCCEEDED`, PASSES on `trust_executed`, and returns INCONCLUSIVE on
  `probe_external_state` without a runner.
- `checkExpectedEffect` PASSED/FAILED/INCONCLUSIVE on every probe kind:
  `status_equals`, `output_field` (equals / notEquals / contains /
  matches), `no_error`, plus aggregation of multiple failures.

Coverage includes the executed-vs-goal-success separation: a
`SUCCEEDED` result with no verification strategy is `SKIPPED`, not
`PASSED`. This is the contract's load-bearing separation.

Phase 4 will wire `verifyActionResult` into `ActionRuntime.execute`'s
post-execution path through `ActionRuntimeDependencies.recordEvidence`
so the verification record becomes evidence-backed. Phase 7 makes
`authorization` part of the flow.

---

## 7. Migration gaps (vs audit)

- **§6 — Separate decision from execution.** Resolved: the planner
  produces `ActionProposal`; the harness consumes `ActionRequestV1`.
  Phase 3 replaces `AgentLoop.selectAction` (index.ts:412-421, which
  picks the first executable graph node) with `ActionProposal`
  generation.
- **§25.1 — "Finished plan == achieved goal."** Resolved:
  `ResultVerification` is recorded; `verifyActionResult` does not assume
  missing strategy ⇒ PASS.
- **§26 — Retry ownership.** Partially addressed here: idempotency key
  is the proposal's, not the caller's. Phase 5 owns the retry policy.
- **§28.14 — No `expected_effect` / `verification_strategy`.** Resolved:
  both fields exist on `ActionProposal`.
- **§29 — Execution success vs goal progress.** Resolved:
  `ActionOutcome.actionResult` is execution success;
  `ActionOutcome.verification` is post-execution effect check; goal
  progress is Phase 3's evaluator (separate).
- **§38 — Sandbox classification.** Resolved: `ExecutionSandbox` on
  every proposal; Phase 4 maps "physical" capabilities to NAVIQ.

---

## 8. Out of scope for this contract

- Authorizing the proposal (Phase 7).
- Resolving `providerId` from `capability` + `sandbox` (Phase 4).
- Persisting `ActionOutcome` to SQLite (Phase 6).
- Wiring `verifyActionResult` into `ActionRuntime.execute`'s evidence +
  reconciliation path (Phase 4).
- Making `verificationStrategy` required on irreversible proposals
  (Phase 3, enforced by the loop).
- Loop-level stop reasons from terminal states (`STOP_BUDGET_EXCEEDED`
  etc., Phase 3).
