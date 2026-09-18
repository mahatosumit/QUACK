# ADR 0042: QUACK Instruction Engine (QIE)

## Status

Accepted — 2026-09-10 (P8.1 foundation implemented; live wiring deferred to P8.4)

## Context

The P8.0 audit found that QUACK has **no model-facing instruction assembly at
all**: `ModelRequest.prompt` is a single flat string, the only production
model caller is the console stream (`/models/stream`), and the agent loop is
tool/workflow-driven with no model call. Dormant assets exist that anticipate
this need — `createPromptRegistry` (versioned prompts, unscored, unwired),
`ContextManagerNew` (identity/project context bundle, no consumer),
`ContextRetriever` (retrieval half of context assembly, output never
formatted) — plus governance machinery that any instruction layer must
respect: CapabilityBroker (fail-closed), PrivacyFirewall, MemoryPolicy,
EvidenceRecordV1/CompletionReceipt, GovernedModelRuntime.

The product objective (P8) is to let small/cost-efficient models perform
reliably inside QUACK by constructing the correct model-facing context from
runtime state — rather than making models infer QUACK's contracts from a
giant prompt.

## Decision

Introduce a canonical **Instruction Engine** subsystem in `src/instruction/`
that compiles structured runtime state into deterministic, provider-neutral
instruction plans.

**QIE is an instruction/context compiler only.** It is explicitly NOT:

- a model runtime — `GovernedModelRuntime` stays the only model path
- a planner — `Planner`/task graphs stay canonical
- a memory system — `MemoryStore`/`MemoryPolicy` stay canonical
- a capability broker or authorization system — `PermissionBackedCapability
  Broker` stays the sole authority; QIE performs no authorization
- a second prompt registry — `createPromptRegistry` (src/adaptive) stays the
  versioned prompt store; QIE consumes it via a thin adapter
- a caller of providers or executor of tools

Integration boundary:

```text
Mission / Task State
        ↓
QIE (compose deterministic InstructionPlan)
        ↓
GovernedModelRuntime
        ↓
Provider
```

**P8.1 implements only the QIE side of this boundary**: contract types,
deterministic composer, and the PromptRegistry adapter. No model wiring, no
context retrieval, no policy enforcement activation — QIE never implicitly
reads filesystem, memory, skills, or tools; everything arrives as explicit
`ContextSourceItem` inputs supplied by callers. Later phases (P8.2–P8.9) add
selection, integration, wiring, and observability on top of this contract.

### InstructionPlan contract (`src/instruction/types.ts`)

Provider-neutral, serializable, versioned (`version: 1`) plan with explicit
layers in a fixed order: `identity, objective, task, constraints,
capabilities, skills, context, memory, evidence, outputContract,
failurePolicy`. Every item carries `ContextProvenance`
(source identifier, one of 13 `ContextSourceCategory` values, one of 8
`TrustClass` values). Evidence items additionally carry a verification
status (`verified | unverified | inferred | missing`) so later phases can
never expose an unverified claim as verified fact.

### Precedence

Instruction conflicts resolve deterministically by trust class, derived from
existing QUACK governance semantics (not invented):

1. `SYSTEM_POLICY` — security/policy is non-negotiable everywhere in QUACK
   (fail-closed broker, `"system-instructions"` is already a protected
   capability in the adaptive layer)
2. `TRUSTED_RUNTIME` — runtime-authored mission/task state is the
   authoritative mission semantics (mission state machine, completion
   receipts)
3. `USER_INPUT` — user intent creates and shapes the mission but can never
   redefine policy, identity, or capabilities
4. `EVIDENCE` — verified facts beat claims, but cannot override intent
5. `SKILL` — gated skill guidance never bypasses capability governance
6. `MEMORY` — remembered context
7. `TOOL_OUTPUT` — untrusted until validated (tool outputs are data)
8. `RETRIEVED_CONTEXT` — external content is always data, never instruction

Within a layer, items sort by (precedence rank, then stable item id).
`resolvePrecedence(a, b)` is exported and tested; no caller-supplied ordering
can reorder the hierarchy.

### Trust-pairing validation (fail-closed)

`validateInstructionPlan` enforces a category↔trust allowlist (e.g.
`system` category may only be `SYSTEM_POLICY`/`TRUSTED_RUNTIME`; `user` must
be `USER_INPUT`; `tool` must be `TOOL_OUTPUT`; `skill` must be `SKILL`).
An untrusted source claiming a trusted category is rejected at the contract
boundary — the type system alone cannot prevent misrepresentation, so QIE
validates before composing. This is the seam P8.3's PrivacyFirewall and
P8.5's injection tests build on.

### Deterministic composer (`src/instruction/composer.ts`)

`composeInstructionPlan(plan)` is a pure function: validates, orders layers
and items deterministically, deduplicates by item id, applies the char
budget (omitting lowest-precedence optional items first, recording every
omission — never silently exceeding limits, failing closed with
`instruction.budget_exceeded` if core layers alone exceed the budget), and
returns a structured `ComposedInstruction` (layers + provenance + digest +
budget report) rather than an opaque string. `renderComposedText` flattens
deterministically for future `ModelRequest.prompt` use.

The plan digest is sha256 over a canonical serialization (recursively
sorted keys, provenance timestamps excluded) following the existing
evidence-digest / `canonical()` patterns — it identifies instruction content,
is insensitive to object key insertion order, and contains no runtime
execution identity.

### PromptRegistry reuse

`instructionSourceFromPrompt` adapts the existing versioned
`PromptRegistry` (versioning, scoring, rollback, comparison all preserved)
into a QIE `InstructionSource`. No second registry; the dormant
`src/adaptive/prompt-registry.ts` becomes QIE's prompt-content store as-is.
No refactor was required.

### Budget, output contract, failure policy

`InstructionBudget` is char-based and model-agnostic (token estimation and
model-aware adaptation are P8.4; `ModelInfo.contextWindow = 8192` is a
registry default, not QIE truth). `InstructionOutputContract` represents
response/structured/toolIntent/clarification/plan/verification/failure/
completion shapes reusing `JsonObject` (aligned with
`ProviderModelRequestV1.responseSchema`). `InstructionFailurePolicy`
represents allowed failure modes (`insufficient_context`,
`capability_unavailable`, `capability_denied`, `verification_required`,
`clarification_required`, `uncertain_result`) — representation only; reuse of
`QuackError` semantics happens at enforcement time (P8.4).

## Implementation update — P8.2 Context Selection (2026-09-10)

`src/instruction/selector.ts`: deterministic selection over explicitly
supplied candidates. RETRIEVAL PRODUCES CANDIDATES → SELECTOR SELECTS AND
ASSEMBLES → P8.1 COMPOSER VALIDATES AND COMPOSES. Pure function (zero
retrieval); per-candidate fail-closed eligibility with structured rejection
reasons; duplicate ids fail the whole selection closed; ranking = P8.1 trust
precedence + stable id ties; the P8.1 composer stays the single budget
authority (the selector reuses its drop decision — no duplicated budget
logic); selection report is metadata-only. 30 tests.

## Implementation update — P8.3 PrivacyFirewall admission (2026-09-10)

`src/instruction/firewall.ts`: the admission boundary between QUACK
governance sources and the P8.2 selector. The firewall decides "is this
context source allowed to enter the instruction pipeline, under what
trust/provenance, and with what restrictions" — and nothing else: it is not
a composer, renderer, budget manager, precedence engine, or retriever, and
it performs zero I/O. Governance lanes are keyed on the P8.1 trust class
(the trust class IS the lane):

- `SYSTEM_POLICY`/`TRUSTED_RUNTIME` items require an authorized runtime
  source (`authorities.runtimeSources`) — policy provenance cannot be
  forged by metadata.
- `SKILL` items require lifecycle backing (`data.skillId` ∈ admitted
  skills, per ADR 0041) — skills cannot self-escalate.
- `MEMORY` items require `data.memoryId` ∈ admitted memory ids
  (MemoryPolicy-passed upstream) — memory is data, never policy.
- `EVIDENCE` items require a valid status AND `data.evidenceId` ∈ existing
  evidence records — unverified claims never enter as verified.
- `capability`-category items may only declare capabilities ⊆ granted
  capability ids — capability text inside ordinary data grants nothing.
- Sensitive content (ADR 0041 classifier, reused as-is) is REJECTED with
  class names only — never rewritten, never echoed. Redaction, when wanted,
  happens upstream; this boundary is admission-or-rejection.

Authority views are caller-supplied snapshots — the firewall queries no
broker, registry, or store. Admitted candidates are returned unchanged;
duplicate ids fail the whole batch (P8.2 semantics). 37 tests.

## Implementation update — P8.4 Governed Model Adaptation (2026-09-10)

`src/instruction/model-adapter.ts`: the translation boundary between the
composed instruction and the EXISTING model runtime. Ownership: QIE owns
WHAT the model receives; `GovernedModelRuntime` (ADR 0036, unchanged) owns
WHETHER/HOW it reaches a model; providers own protocol transport only.

- `adaptComposedInstruction(composed, options)` is a pure deterministic
  translator into the existing provider-neutral `ModelRequest`: the prompt
  is the byte-identical P8.1 `renderComposedText` output; identity (digest,
  missionId, taskId, plan version, output-contract kind) rides in request
  `metadata` — the P8.1 digest is preserved verbatim, never regenerated.
  Fails closed on missing/invalid digest, missing mission identity,
  unsupported plan version, unknown output-contract kind, or empty rendering.
- `invokeGovernedInstruction(runtime, composed, context, options)` validates,
  adapts, and dispatches through the existing governed runtime with the full
  execution context so `provider.invoke` authority resolves before provider
  contact. No retry, no fallback path, no retrieval; denials and provider
  errors pass through with existing `QuackResult` semantics.
- No role mapping was invented: existing providers (Ollama flat prompt,
  OpenAI-compatible single user message) are preserved; QIE authority is
  carried inside the rendered instruction (`[TRUSTED]/[USER]/[DATA]` labels,
  fixed layer order), never by provider role assignment.
- Output contracts are CARRIED (rendered section + metadata), not enforced —
  current providers have no response-schema capability, so no schema
  enforcement is claimed. Token estimation is not derived from the char
  budget; `maxTokens`/`temperature`/`model`/`capability` remain explicit
  caller options (no model routing added).
- `src/models/*` and `src/providers/*` are untouched. 25 tests.

## Implementation update — P8.5 Injection Defense Enforcement (2026-09-10)

`src/instruction/injection-defense.ts`: the final pre-dispatch tripwire
between the composed instruction (P8.1) and the governed model runtime
(P8.4). The security property is structural, not textual:

> P8.5 prevents untrusted context from acquiring instruction authority
> through the QIE execution boundary. Data remains data.

Two clearly separated mechanisms:

**Structural enforcement (fail-closed rejections).** Every dispatch
(`invokeGovernedInstruction`) re-verifies the composed instruction before
adaptation: digest correspondence (the P8.1 canonical SHA-256 is recomputed
over layers/identity/output-contract/failure-policy — any post-composition
mutation breaks correspondence and is rejected), trust/category pairing,
evidence status validity, duplicate ids, provenance shape, and render-safe
item ids. Item ids are the only raw-rendered field in the model-facing
text; an id that could forge rendered structure (newlines, headers, trust
tags) is rejected — never rewritten. Violations never reach the runtime,
and there is no fallback path: one rejection, zero retries, zero ungoverned
alternates. Rejected instructions produce structured, metadata-safe
errors (`instruction.defense_*` codes) that never echo payload content.

**Heuristic detection (defense-in-depth flags).** A small deterministic
pattern family (fixed vocabulary of kinds: instruction_override,
authority_claim, policy_claim, capability_claim, privilege_claim,
verification_claim, role_marker, runtime_bypass, secret_disclosure) scans
item data. Flags are metadata-only (item id, trust, category, kind names —
never matched content) and ride in request metadata under `injectionFlags`.
A match changes NOTHING: content is preserved byte-identically, trust and
precedence are untouched, and the instruction still dispatches. Detection
is NOT trust: "looks like an injection attempt" never means "therefore
trusted" or "therefore deleted". The ADR 0041 PrivacyFirewall classifier
is NOT reused here — it classifies sensitive data classes (secrets, keys)
with different semantics, and P8.3 already applies it at admission.

Digest integrity: enforcement recomputes but never replaces the P8.1
digest; passing instructions retain exact digest/content correspondence.
No second digest, timestamp, or random id is introduced.

Provider bypass: `invokeGovernedInstruction` remains the only QIE
execution path to a model; enforcement is inlined ahead of adaptation, so
no QIE dispatch can skip it. Providers and `src/models/*` are unchanged
and remain pure protocol transport.

Limitations (honest): P8.5 does not and cannot guarantee that a model
will never *comply* with instruction-like data content — the
model-facing text still contains the (labeled, JSON-escaped) payload.
What it guarantees is that such content never *acquires authority*:
trust lanes, precedence, capability grants, policy, and instruction
identity are all structural and unaffected by payload language. Semantic
prompt-injection hardening of model behavior itself (e.g., structured
role channels) is a provider-contract question deferred with P8.4's
role-mapping decision. 52 adversarial tests.

## Implementation update — P8.6 Harness Instruction Scoring (2026-09-11)

Two QIE-side modules and an additive harness extension:

- `src/instruction/records.ts`: `GovernedInstructionRecord` — the durable,
  METADATA-ONLY account of one governed dispatch (digest, mission/task
  identity, plan version, output-contract kind, outcome, per-layer
  trust census, budget facts, injection flag count + flags). Built from
  the composed instruction + its defense result, so a record cannot
  disagree with what was enforced. `parseInstructionRecord` is the
  fail-closed intake for persisted records: unknown outcomes, forged
  non-sha256 digests, malformed census, or flag-count mismatches are
  rejected — tampered records can never silently enter evaluation.
  Records never contain item data or prompt text (content-leak tested).
- `src/instruction/evaluator.ts`: pure `scoreInstructionQuality` over
  records — instructionIntegrity (dispatched vs. rejected share),
  contextProvenance (authoritative-lane presence),
  budgetDiscipline (recorded omissions vs. within-budget assembly).
  Deterministic, order-independent; zero records yield an honest neutral
  result (never rewarded, never hidden).
- Harness integration (no second evaluator): `MissionTrace` gains an
  optional `instruction` records array (additive; traces persist as JSON
  payloads in the existing repository — no migration);
  `collectMetrics` derives the dispatch census; `MissionEvaluator`
  adds the three instruction dimensions (absent when no records — the
  P5 contract is untouched) and surfaces rejected dispatches as an
  `instruction.rejected` failure so instruction-layer fail-closures are
  visible in evaluation. Dependency direction is one-way:
  harness → instruction records/evaluator; QIE never imports harness.

18 tests: `src/instruction/records.test.ts`.

## Implementation update — P8.7 Instruction Observability (2026-09-11)

`src/instruction/observer.ts` + dispatch-seam wiring — NO second event
system and NO second record shape:

- `instruction.dispatched` / `instruction.rejected` are added to the
  EXISTING `QuackEventType` union and emitted on the existing EventBus,
  so every existing surface (SSE `/events` bridge, dashboards, audit
  feeds) receives instruction telemetry exactly like any other runtime
  event. Payloads are METADATA-ONLY (record id, mission/task identity,
  digest, outcome, item/omission/flag counts) — never item data, prompt
  text, or matched injection content (content-leak tested).
- `InstructionObserver` implements the `InstructionDispatchObserver`
  seam declared in records.ts: it builds the P8.6
  `GovernedInstructionRecord` (single record shape, no widening), emits
  the bus event, retains a bounded recent-record window (default 200,
  deterministic eviction), and exposes a metadata-only `summary()` for
  dashboard aggregation. Event-sink or observer failures are captured
  and never break a governed dispatch — observability can never fail
  the dispatch path (tested with a throwing sink and a crashing
  observer).
- `invokeGovernedInstruction` gained an optional trailing `observer`
  parameter: defense/adaptation rejections emit
  `instruction.rejected` (with the defense error code), and post-dispatch
  outcomes classify as `dispatched` / `denied`
  (`model.permission_denied`) / `provider_error`. Observation happens
  strictly AFTER the dispatch decision; results are identical with and
  without an observer (tested byte-identical digests/metadata). Without
  an observer the function is unchanged — P8.4/P8.5 callers keep their
  exact signature and behavior.
- Dashboard state (`buildDashboardState`) aggregates
  `harness.instruction` telemetry (dispatch/dispatched/rejected/denied/
  provider_error/flag counts + distinct mission count) from
  trace-attached P8.6 records — metadata only.

12 tests: `src/instruction/observer.test.ts` (10) + dashboard
aggregation (2).

## Implementation update — P8.8 Studio/CLI Inspection (2026-09-11)

Inspection surfaces over the P8.6/P8.7 metadata-only records — no new
routes, endpoints, or stores:

- Studio Trace Detail gains a "Governed instructions" panel rendering
  `trace.instruction` records (digest prefix, outcome badge, defense
  error code, per-layer census, item/omission/flag counts, dispatch
  time) with an honest empty state; the panel states explicitly that
  instruction content is never stored or rendered. The Evidence view
  gains an "Instruction telemetry" section consuming the P8.7
  `harness.instruction` dashboard aggregate (dispatch/dispatched/
  rejected/denied/provider-error/flag counts + mission count) with the
  same metadata-only labeling; the evaluation-history dimension badges
  now include the instruction (I) dimension when present. Live SSE
  refresh subscribes to `instruction.dispatched`/`instruction.rejected`
  and re-renders the evidence/trace surfaces on telemetry updates.
- CLI: `quack instructions [--mission <id>]` lists the same records
  from the EXISTING trace repository (no new store). Every stored
  record passes through the P8.6 fail-closed `parseInstructionRecord`
  before rendering: tampered records are excluded and counted
  (`invalidRecordCount`), never rendered as trustworthy. `--json`
  emits the full metadata; human output shows digest prefixes only.
- `docs/cli/CLI.md` documents the new command.

Tests: studio contract regexes (6) + CLI parse/behavior (2, including
tamper exclusion and mission filtering).

## Implementation update — P8.9 Research/SDK Surface (2026-09-11)

Final P8 phase: the QIE contract becomes a public export surface for
external research harnesses and SDK consumers.

- `src/index.ts` (the `@quack/os` package root) re-exports the full
  `src/instruction/index.js` surface — contract constants
  (`INSTRUCTION_PLAN_VERSION`, `INSTRUCTION_LAYER_ORDER`,
  `TRUST_CLASS_PRECEDENCE`, `CATEGORY_TRUST_PAIRING`), validation,
  composition/rendering, selection, firewall admission, governed
  adaptation/dispatch, injection defense, P8.6 records/scoring, and the
  P8.7 observer. Name-collision-free (verified by typecheck). What is
  deliberately NOT exported: no model runtime, no planner, no memory,
  no capability authority, no prompt-registry mutation — QIE stays an
  instruction compiler; `invokeGovernedInstruction` takes a
  caller-supplied governed runtime so research harnesses keep backend
  control.
- `sdk/src/index.ts` re-exports the same surface (functions + full type
  list) through `@quack/sdk`; `sdk/README.md` documents it;
  `docs/research/INSTRUCTION_ENGINE_RESEARCH_SURFACE.md` (new) defines
  the research integration pattern (deterministic compose→defense→
  adapt→dispatch→score loop, digest-based replay verification,
  metadata-only scoring so datasets never ship prompt text). The
  research doc is added to the packaged docs allowlists
  (`package.json`, `packaging/public-files.json`).
- SDK contract tests (`sdk/test/client.test.mjs`, +2): exported-surface
  coverage and end-to-end determinism through the published package
  path (digest equality on cloned plans, defense pass, verbatim digest
  in adapted metadata, record scoring, tamper rejection).

Verification: root typecheck + `typecheck --workspace @quack/sdk` clean;
root suite 1700+17 pass / 0 fail; SDK tests 5/5.

## Consequences

Positive: one canonical home for instruction assembly; deterministic and
replayable via digest; injection-resistant by construction (trust must be
declared and validated, never inferred from content); dormant PromptRegistry
gains an owner without churn; zero impact on existing runtime paths (pure
addition, no callers changed).

Negative: the contract is not yet consumed by any runtime path (intentional —
P8.4 wires it); trust-pairing allowlist must be extended as new context
categories appear; char-based budget is a proxy for token budget until model
adaptation exists.

Risk mitigation: validation fails closed; composer is pure and side-effect
free (deep-frozen input test); precedence is exported and unit-tested against
injection-shaped conflicts.

## Alternatives Considered

- **Reuse `ContextManagerNew`/`ContextRetriever` as the assembly layer** —
  rejected: they are context *sources* (retrieval), not instruction
  compilers; QIE accepts their outputs later as `ContextSourceItem`s
  (P8.2), and merging them now would create the second prompt system the
  audit warned against.
- **Giant system-prompt string constant** — rejected: the entire P8
  objective is to make context construction state-driven and inspectable.
- **Type-level-only trust enforcement (branded types)** — rejected as
  insufficient: untrusted content can claim any shape at runtime; the
  validator is the actual boundary. Types carry the information; validation
  enforces it.
- **Wire QIE into `/models/stream` now** — rejected: P8.1 is a foundation
  phase; premature wiring would freeze the contract before P8.2 selection
  semantics exist.

## Verification

`src/instruction/composer.test.ts` (22 tests): plan construction and
required-field enforcement; digest and composition determinism (including
object key insertion order); deterministic layer order and within-layer
precedence ordering; provenance/category survival through composition;
documented conflict precedence; budget representation, omission recording,
and fail-closed budget excess; deterministic output-contract serialization;
untrusted-source-cannot-be-authoritative validation; purity (deep-frozen
input unchanged); duplicate-id dedup.

Full repository suite result recorded in `CURRENT_STATE.md` P8.1 gate row.
