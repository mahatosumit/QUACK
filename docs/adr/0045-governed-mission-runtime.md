# ADR 0045: Governed Mission Execution Loop

## Status

Accepted — 2026-09-12

## Context

P8 delivered the QUACK Instruction Engine (QIE — ADR 0042): deterministic
instruction composition, context selection, privacy firewall, governed model
adaptation, injection defense, and dispatch records. P9 delivered governed
semantic memory (ADR 0043). P10 delivered the governed extension ecosystem
foundation (ADR 0044 — non-executable by design).

However, no production path today runs a MISSION through a
model-in-the-loop: `QuackRuntime.runTask` plans once with a heuristic
template planner and executes a static task graph; the model is never asked
what to do next, and the fully-tested QIE pipeline
(`invokeGovernedInstruction`) has zero production callers. Equally, the
executive-loop contract (`src/runtime/mission-lifecycle/executive-loop.ts`),
the `ActionProposal` contract, and the `DefaultExecutionHarness`
(propose → validate → authorize → execute → verify) exist and are tested,
but no live path produces `IterationRecord`s or drives the harness.

P11 is the missing assembly: the first REAL governed mission execution
loop that connects USER → MISSION → QIE → GOVERNED MODEL → ACTION
PROPOSAL → CAPABILITY AUTHORITY → EXECUTION → OBSERVATION → EVALUATION →
STATE UPDATE, with deterministic recovery and idempotency.

## Decision

### Architecture (one loop added, zero new authorities)

`GovernedMissionLoop` (new: `src/runtime/mission-lifecycle/governed-mission-loop.ts`)
implements the EXISTING executive-loop contract (`LoopRun`,
`IterationRecord`, `appendIteration`, `detectStall`, `evaluateBudget`,
`StopReason`) and consumes the EXISTING authorities:

```
MISSION (objective + actor + budget)
  → MISSION STATE (existing 12-state MissionState machine, fenced transitions)
  → CONTEXT PREPARATION (deterministic layer construction)
      - objective/task/constraints (TRUSTED_RUNTIME — host-owned)
      - governed semantic memory retrieval (P9, MEMORY trust, P8.3 firewall)
  → QIE (P8 pipeline, mandatory, no bypass)
      selectContext → composeInstructionPlan → enforceInstructionDefense
  → GOVERNED MODEL RUNTIME (existing, broker-gated provider.invoke)
      via invokeGovernedInstruction — FIRST production consumer
  → ACTION PROPOSAL (new strict fail-closed parser)
  → VALIDATION + CAPABILITY BROKER (existing DefaultExecutionHarness:
      descriptor/tool permissions — never model-declared)
  → EXECUTION (existing ActionRuntime / runtime.executeTool)
  → OBSERVATION (ActionResultV1 + ResultVerification)
  → EVALUATION (existing MissionEvaluator dimensions — observation only)
  → MISSION STATE UPDATE (deterministic transition policy)
  → NEXT STEP / COMPLETION / FAILURE / CANCELLATION
```

The model NEVER executes anything. The model proposes; the parser
validates; the harness authorizes through the ONE `CapabilityBroker`;
existing surfaces execute. There is no fallback execution path.

### Mission identity and lifecycle

P11 reuses the canonical `MissionState` machine
(`mission-state-machine.ts`) — no new states, no new transition table.
`CREATED` → `RUNNING` via the `start` trigger; `WAITING`, `BLOCKED`,
`INTERRUPTED`, `RECOVERING` remain available; terminal `SUCCEEDED`,
`FAILED`, `CANCELLED`, `TIMED_OUT` are protected by
`assertMissionTransition` (invalid transitions throw
`IllegalMissionTransitionError`). Mission identity is a caller-supplied
`missionId` plus the `LoopRun` run identity; ids are `createId`-prefixed
strings (runtime-scoped identity, NOT used as deterministic decision
inputs — determinism lives in the state/step/plan layers).

### Mission step model

Steps are `IterationRecord`s from the existing executive-loop contract
(`runId`, `missionId`, `iterationId`, `index`, `phase`, `goal`,
`observations`, `workingContext`, `candidateActions`, `selectedAction`,
`permissionDecision`, `executionResult`, `verification`, `nextStep`,
`stopReason`). P11 persists the structured record ONLY — raw model text is
reduced to the validated proposal (capability, arguments, intent) and
bounded outcome facts. Hidden chain-of-thought is never persisted.

### Model invocation boundary

Every model call goes through
`invokeGovernedInstruction(governedModelRuntime, composed, context,
options, observer)` (P8). The P8.5 injection defense runs before
adaptation; the P8.1 digest is preserved in request metadata; the
`InstructionObserver` emits the existing `instruction.dispatched` /
`instruction.rejected` events. Direct `ModelRuntime` calls are a
boundary violation. Output contract kind is `toolIntent`
(`InstructionOutputKind`), `schemaRef: "quack:action-proposal:v1"`.

### Action representation and the proposal parser (the new trust boundary)

The loop-facing proposal is the EXISTING `ActionProposal`
(`action-contract.ts`). The new piece is a strict fail-closed parser
(`parseActionProposal`):

- Model output must be parseable as JSON matching
  `quack:action-proposal:v1`: `{ capability, arguments, intent, done,
  finalMessage?, requestedCapabilities? }`.
- Unknown capability (not an action-provider descriptor id and not a
  registered tool id) → fail closed.
- `requestedCapabilities` from the model are RECORDED, never honored —
  authority derives exclusively from `descriptor.requiredPermissions` /
  `tool.describe().permissions` inside the harness.
- `riskLevel`, `sandbox`, `timeoutMs`, and `idempotencyKey` are
  DERIVED SERVER-SIDE (risk from descriptor `riskClass` mapping, timeout
  from risk-tier defaults, idempotency key from
  `sha256(missionId:stepIndex:capability)`); model-supplied values for
  these fields are ignored.
- Oversized arguments (over `maxArgumentsChars`) and unexpected
  top-level fields are rejected.
- Malformed output consumes a bounded retry (see recovery), then the
  mission fails closed.

### Capability authorization boundary

The existing `DefaultExecutionHarness` authorizes every proposal through
the ONE `CapabilityBroker` (`buildToolCapabilityRequest` with mission and
actor identity), revalidates authority immediately before dispatch, and
emits `harness.authorization` events. Denial produces a `DENIED`
`ActionOutcome` and never executes. High-risk permissions keep the
existing `RiskAwareApprovalPolicy` / approver semantics.

### Execution boundary

Execution happens ONLY through the harness: `ActionRuntime.execute`
(action providers) or the policy-enforced `runtime.executeTool` (core
tools) via `HarnessConfig.executeTool`. v1 scope is READ_ONLY and
REVERSIBLE risk levels only — the harness intentionally fails closed on
IRREVERSIBLE/DESTRUCTIVE proposals (a verification probe runner is future
work). No `child_process`, shell, network, filesystem, or credential
access is introduced by P11. P10 extensions remain
REGISTERED/ADMITTED/NOT-EXECUTABLE — the loop never executes extension
package content.

### Determinism

- Layer construction, plan composition, selection, defense, and
  adaptation are the existing deterministic P8 primitives (identical
  inputs → byte-identical prompt).
- Step identity: `stepId = sha256(missionId:index:capability)` — stable
  across restarts, usable as an idempotency key.
- Loop decisions (continue/complete/fail/stop) are a pure function of
  mission state, iteration records, and budget usage — no clock/random
  inputs in decision logic. Wall-clock is used ONLY for budget deadlines
  and record timestamps (observability), never as decision identity.
- Event ordering follows execution order; payloads are bounded metadata.

### Recovery and bounded retries

- Model failure / malformed output / capability denial / execution
  failure each map to a deterministic per-step policy: bounded
  `maxRetriesPerStep` (default 2) with an explicit retry counter on the
  iteration record; exceeding the bound fails the step and the mission
  fails closed. No infinite loops, no hidden backoff, no fallback
  provider, no silent re-planning.
- Duplicate-step defense: if the step's idempotency key already exists in
  the `ActionExecutionLedger` as SUCCEEDED, the loop resumes from the
  next step instead of re-executing (idempotent replay).
- Crash recovery (honest v1 scope): the `LoopRun` is persisted as a JSON
  record per mission (atomic write, validation-on-load, directory-
  enumerated listing under `<dataDir>/governed-missions/`); a stored
  TERMINAL run refuses re-execution (`mission.loop_already_terminal`),
  and a stored non-terminal run continues from its recorded iterations.
  MID-RUN durable resume of arbitrary OODA state is NOT claimed — that
  requires mapping `LoopRun` onto the existing `ExecutionRecovery`
  checkpoint model and is future work.
- Ambiguous action outcomes (the action may have already executed) fail
  closed through the existing ambiguous-invocation semantics; the loop
  never blindly repeats a possibly-executed action.

### Idempotency

`missionId` + step index + capability produce a stable idempotency key.
Repeated invocation of the same step, repeated event delivery, and
process restart converge on the same ledger record. An already-completed
action is never silently re-executed (the `ActionRuntime` idempotency
ledger dedupes by request hash; the loop additionally checks step-state
before proposing).

### Event model

Existing events carry the loop: `mission.*` family already in the union,
`capability.*`, `tool.*`, `instruction.*`, `harness.authorization`,
`harness.execution.completed`, `evaluation.started/completed`. P11 adds
only the minimum new names to the `QuackEventType` union:
`mission.step.started`, `mission.step.completed`,
`mission.step.failed`, `mission.action.proposed`,
`mission.action.denied`, `mission.action.completed`,
`mission.action.failed`. Payloads are metadata-only (ids, capability
names, statuses, reasons) — no prompt text, no model output dumps, no
secrets. The Studio `liveTypes` list is extended to refresh on these.

### Traceability and evaluation

Each iteration correlates `missionId` + `runId` + `iterationId` +
proposal id + executionId. The existing `MissionEvaluator` is reused for
post-mission evaluation; P11 adds NO second evaluator. Mission-level
dimensions reuse the additive pattern (instruction integrity via P8.6
records already flowing from the observer; capability discipline already
sourced from `capability.*` events). Evaluation observes outcomes; it
never grants anything.

### Memory integration

P9 retrieval is the ONLY memory path: `retrieveSemanticMemory` →
`memoryCandidatesFromRetrieval` (MEMORY trust) → P8.3 firewall admission
→ P8.2 selector → composer. Memory content never reaches the model
outside the MEMORY trust lane, never becomes authority, and never
executes. Mission results are NOT automatically persisted to memory;
persistence requires an explicit authorized actor call (existing P9
admission path).

### Extension integration

None beyond the catalog surface. P10's non-executable boundary is
preserved verbatim; the loop does not read, load, or execute extension
package content.

### Surfaces

- **System**: `system.governedMissionLoop` on `createQuackSystem`
  (additive surface, same pattern as `system.ecosystem`). Existing
  `submitGoal`/`runTask` are untouched. The loop constructor fails fast
  when any required authority (broker, action runtime, providers, tools,
  governed model runtime, event bus) is missing — it never fabricates
  dependencies.
- **CLI**: `quack govmission run "<objective>"` and `quack govmission
  status [missionId]` over the loop (read/write through the governed
  path only), `--json`, deterministic exit codes (0 success, 1 mission
  failure, 2 usage/consent error, 3 unknown mission). `run` requires the
  operator's explicit `QUACK_GOVMISSION_PERMISSIONS` declaration including
  `provider.invoke` (medium/high-risk policy: never granted implicitly);
  the declaration seeds the mission's capability grants with the operator
  as recorded approver, and each governed run still confirms through the
  standard approval callback. Missions fail closed with
  `mission.model_error` when no model provider is reachable — the loop
  never fabricates model output.
- **Server**: `GET /governed-missions` — metadata-only run records
  (identity, state, stop reason, step views), redacted at the wire.
- **Studio**: mission-runtime visibility reuses the existing Studio
  mission surfaces; the existing mission panels already render mission
  state. New SSE refresh types wired for the new step/action events.
- **SDK**: exports the loop's stable surface
  (`GovernedMissionLoop`, `InMemoryMissionRunStore`,
  `JsonFileMissionRunStore`, `parseActionProposal`, `stepIdempotencyKey`,
  `buildIterationPlan`, `buildCapabilityIndex`, schema-ref and bound
  constants, options/result/index types) — provider-neutral, no
  broker/provider internals.

## Security boundaries

1. Model output is untrusted input; the parser is the fail-closed gate
   before any authorization.
2. Capabilities are granted ONLY by the existing broker; model-declared,
   extension-declared, and memory-carried capability claims are data.
3. Memory is data (P9); the firewall and selector enforce lanes.
4. No new exec/shell/network/fs surfaces; no secrets in events, records,
   logs, or the persisted run record.
5. Denials never execute; there is no fallback authority.
6. Budgets and stall detection bound every loop; terminal states are
   protected by the state machine.
7. The proposal parser and the loop get dedicated adversarial tests
   (forged identity, fake approval text, capability escalation, replay,
   oversized payloads, provider bypass attempts).

## Explicit limitations

- v1 executes READ_ONLY/REVERSIBLE capabilities only (harness fails
  closed on IRREVERSIBLE/DESTRUCTIVE pending a verification probe
  runner).
- No mid-run durable resume of OODA state across process restarts; v1
  persists the run record and relies on idempotent replay. Mapping
  `LoopRun` onto the `ExecutionRecovery` checkpoint model is future
  work.
- `verifyResult` inside the harness remains conservative
  (`trust_executed` → INCONCLUSIVE unless a strategy with a probe runner
  is wired).
- No model-driven planning of multi-step graphs (the loop executes one
  proposal per iteration; graph planning stays with the existing
  template planner on the `submitGoal` path).
- No autonomous execution beyond the per-mission bounded loop; no
  scheduled/background missions; no P12+ functionality.
- Studio surfaces display metadata only; no chain-of-thought is stored
  or rendered.

## Consequences

- QUACK gains its first real model-in-the-loop mission path with the QIE
  pipeline finally consumed in production, using only existing
  authorities.
- The static-graph path (`submitGoal`) and the governed loop are
  distinct, clearly labeled surfaces converging on the same broker,
  model runtime, evaluator, and event bus.
- Future phases can extend the loop (probe runners, checkpoint-based
  resume, richer step policies) without touching the contracts frozen
  here.

## Verification

- `src/runtime/mission-lifecycle/governed-mission-loop.test.ts` — state
  machine use, happy path with a stub governed runtime, parser
  fail-closed matrix, budget/stall stops, denial path, idempotent
  replay, cancellation, determinism of stepId/plan identity.
- `src/runtime/mission-lifecycle/governed-mission-loop.security.test.ts`
  — adversarial matrix: forged mission identity, fake approval,
  capability escalation via model output, memory poisoning attempts,
  replay/duplicate execution, provider bypass, oversized payloads,
  event payload leakage.
- CLI contract tests in `src/cli.test.ts`; Studio contract tests in
  `src/dashboard/web/studio.test.ts`; SDK contract test in
  `sdk/test/client.test.mjs`.
- Full regression: lint, build, ordinary, serial, security,
  models/providers, server, dashboard, CLI, ecosystem, memory,
  instruction/QIE, SDK, E2E.
