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
