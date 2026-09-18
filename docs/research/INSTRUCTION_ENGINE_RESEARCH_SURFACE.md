# QUACK Instruction Engine (QIE) External Research & SDK Surface

**Mission**: Publish the QIE deterministic instruction contract so external
research harnesses and model evaluators can reproduce, replay, and score
QUACK's model-facing instruction assembly without QUACK runtime internals.

**Date**: 2026-09-11
**Status**: P8.9 — QIE public export surface (ADR 0042, final P8 phase)
**Sources**: ADR 0042; `src/instruction/*`; `sdk/src/index.ts`

---

## 1. What the research problem is

Small/cost-efficient models fail inside agent runtimes not because of
reasoning limits but because the runtime hands them an unstructured,
untrustable prompt blob. Evaluating "which context assembly makes small
models reliable" requires an assembly process that is:

1. **deterministic** — same inputs → byte-identical model-facing text;
2. **identity-carrying** — every instruction has a content digest, so
   any drift between what was assembled and what was sent is detectable;
3. **trust-explicit** — context provenance (policy/runtime/user/evidence/
   skill/memory/tool/retrieved) is structural, never inferred from text;
4. **fail-closed** — structural violations reject before dispatch, so a
   "successful" run can never be built on a mutated or forged instruction.

QIE (P8.1–P8.8) provides exactly this inside QUACK. P8.9 exposes it as a
public package/SDK surface so external research can drive it directly.

## 2. The exported research contract

From `@quack/os` (and re-exported by `@quack/sdk`), the QIE surface:

```text
Contract      INSTRUCTION_PLAN_VERSION, INSTRUCTION_LAYER_ORDER,
              TRUST_CLASS_PRECEDENCE, CATEGORY_TRUST_PAIRING,
              createInstructionPlan, validateInstructionPlan,
              collectPlanIssues, resolvePrecedence, trustClassRank
Composition   composeInstructionPlan, renderComposedText, canonicalJson
Selection     selectContext (+ DEFAULT_CATEGORY_LAYER)
Firewall      admitContext (caller-supplied authority snapshots)
Dispatch      adaptComposedInstruction, invokeGovernedInstruction
Defense       enforceInstructionDefense, flagsToMetadata, assertDispatchable
Records       buildInstructionRecord, parseInstructionRecord,
              recordToJsonObject, distinctTrustClasses
Scoring       scoreInstructionQuality, dominantTrustLane
Observation   InstructionObserver (instruction.dispatched/rejected events)
```

All functions are pure (no I/O, no clock, no randomness) except
`invokeGovernedInstruction`, which takes a caller-supplied governed
runtime — researchers keep full control of the model backend.

## 3. Research harness integration pattern

A minimal reproducible evaluation loop for an external harness:

```text
1. build InstructionPlan        (explicit items + provenance + budget)
2. composeInstructionPlan       → ComposedInstruction + sha256 digest
3. enforceInstructionDefense    → structural verdict + injection flags
4. adaptComposedInstruction      → provider-neutral ModelRequest
5. invokeGovernedInstruction    → researcher's governed runtime
   (optional InstructionObserver → P8.6 records + bus events)
6. scoreInstructionQuality      → integrity/provenance/budget dimensions
7. compare digests across runs   → determinism proof
```

Key reproducibility properties (all covered by existing tests):

- **Determinism**: identical plans compose to identical digests and
  byte-identical rendered text — key insertion order irrelevant
  (canonical JSON with recursively sorted keys).
- **Replayability**: the digest identifies instruction content; a stored
  `GovernedInstructionRecord` (metadata-only) lets a harness verify after
  the fact that the dispatched instruction matched the composed one
  (P8.5 recomputes correspondence at dispatch time).
- **Adversarial grounding**: injection-shaped content in data lanes is
  preserved byte-identically (defense flags it in metadata) while never
  acquiring authority — a harness can measure model compliance rates
  against known-hostile payloads without the harness itself becoming
  untrustworthy.
- **Scoring without content**: P8.6 quality dimensions are computed from
  metadata-only records, so research datasets never need to ship prompt
  text to reproduce scores.

## 4. What is deliberately NOT exported

QIE stays an instruction/context compiler (ADR 0042):

- no model runtime — `GovernedModelRuntime` remains the only model path
  inside QUACK; research harnesses bring their own governed backend;
- no planner, memory, capability authority, or prompt-registry mutation;
- no second evaluator — P8.6 scoring extends the existing
  `MissionEvaluator`, and external scoring consumes the same record shape.

## 5. SDK consumer example

```typescript
import {
  createInstructionPlan, composeInstructionPlan, renderComposedText,
  enforceInstructionDefense, scoreInstructionQuality, buildInstructionRecord,
} from "@quack/sdk";

const plan = createInstructionPlan({
  missionId: "research-1",
  layers: [/* items with explicit provenance/trust */],
  budget: { maxInstructionChars: 32_000, reservedOutputChars: 4_000 },
  outputContract: { kind: "structuredResponse" },
  failurePolicy: { allowedModes: ["insufficient_context"], preferAdmission: true },
});
if (!plan.ok) throw new Error(plan.error.message);
const composed = composeInstructionPlan(plan.data);
if (!composed.ok || !composed.composed) throw new Error("composition failed");
const defense = enforceInstructionDefense(composed.composed);
if (!defense.ok) throw new Error(defense.error.message);
// renderComposedText(composed.composed) is the exact model-facing text;
// composed.composed.digest is its content identity — log both, replay later.
```

## 6. Verification

- Root `src/index.ts` re-exports the full `src/instruction/index.js`
  surface (name-collision-free; `npm run typecheck` clean).
- SDK re-exports with `npm run typecheck --workspace @quack/sdk` clean.
- SDK contract test `sdk/test/client.test.mjs` covers exported functions
  and determinism behavior through the published package path.
- All 1700+17 root tests + QIE suites (104 instruction tests) pass with
  the exports in place.
