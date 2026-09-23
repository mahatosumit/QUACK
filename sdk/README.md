# @quack/sdk — QUACK TypeScript SDK

The official TypeScript SDK for building on the QUACK AI Operating System.

## Build from this checkout

Run these commands from the repository root:

```bash
npm install
npm run build
npm run build --workspace @quack/sdk
```

## Quick Start

```typescript
import { QuackClient } from "@quack/sdk";

const client = new QuackClient();
await client.initialize({ workspaceRoot: "./my-project" });
await client.submitMission({
  objective: "summarize the workspace documents",
  mode: "build",
});
await client.shutdown();
```

`submitGoal()` remains as a compatibility adapter for existing clients.

## API

See the [QUACK API reference](https://github.com/mahatosumit/QUACK/blob/master/docs/API_REFERENCE.md) for the current API and runtime integration notes. The packages are currently private; registry publication is a separate release decision.

## Instruction Engine (QIE) surface

The SDK exports the QUACK Instruction Engine contract (ADR 0042) for
deterministic instruction/context compilation: `createInstructionPlan`,
`composeInstructionPlan`, `renderComposedText`, `selectContext`,
`admitContext`, `adaptComposedInstruction`, `invokeGovernedInstruction`,
`enforceInstructionDefense`, `buildInstructionRecord`,
`scoreInstructionQuality`, and `InstructionObserver`, plus all contract
types. All are pure primitives (no I/O) except `invokeGovernedInstruction`,
which takes a caller-supplied governed runtime. See
`docs/research/INSTRUCTION_ENGINE_RESEARCH_SURFACE.md` for the research
integration pattern.

## Semantic Memory surface

The SDK exports the governed semantic-memory contracts (P9, ADR 0043):
`SemanticMemoryService` (the composition facade over admission ->
persistence -> governed embedding -> derived index -> retrieval),
`admitSemanticMemory`, `parseSemanticMemoryRecord`, `chunkSemanticMemory`,
`semanticContentHash`, `retrieveSemanticMemory`, `resolveKnowledgeSource`,
`memoryCandidate`/`memoryCandidatesFromRetrieval`/
`semanticMemoryAuthorities`/`pipelineMemoryToQie` (QIE integration in the
MEMORY trust lane), and `scoreMemoryQuality` (evaluation dimensions from
metadata-only evidence), plus the record/retrieval/knowledge-source types
and the `SEMANTIC_MEMORY_SCOPES`/`SEMANTIC_MEMORY_BOUNDS` constants.
Memory is data, never authority: retrieval supplies context candidates
through the existing QIE pipeline, embeddings dispatch through a
caller-supplied governed runtime, and no vector-database internals,
storage paths, provider clients, or policy objects are exported.

## Ecosystem surface

The SDK exports the governed extension-ecosystem contracts (P10, ADR
0044) — the declarative package catalog foundation: `EXTENSION_KINDS` and
`EXTENSION_LIFECYCLE_STATES` (contract vocabularies),
`validateExtensionManifest`/`parseExtensionManifest` (fail-closed manifest
validation with unknown-field rejection),
`canonicalManifestForm`/`manifestDigest` (deterministic identity over the
canonical manifest form — key order never changes identity),
`packageDigest`/`verifyPackageIntegrity` (sha256 content integrity,
honest UNSIGNED/UNVERIFIED signature states),
`extensionTrustView` (reports exactly what was verified — digests — and
nothing more), `validateLifecycleTransition`/`isTerminalState`/
`isResolvableState` (the frozen 8-state lifecycle table; REMOVED is
terminal), `resolveDependencies`/`dependencyList` (exact-version
local-only resolution; cycles and conflicts fail closed; no "latest"),
and `scoreEcosystemQuality` (metadata-only deterministic evaluation
dimensions), plus the manifest/integrity/lifecycle/registry/resolution/
evaluation types. A package manifest is data, never authority: declared
capabilities grant nothing, package content is never executed, and no
registry file paths, broker internals, package content, or execution
surfaces are exported.

## Governed Mission Runtime surface

The SDK exports the governed mission-runtime contracts (P11, ADR 0045):
`GovernedMissionLoop` (the model-in-the-loop mission executor),
`InMemoryMissionRunStore` (in-memory run-record persistence), and the
fail-closed proposal contracts `ACTION_PROPOSAL_SCHEMA_REF`,
`MAX_PROPOSAL_ARGUMENT_CHARS`, `MAX_FINAL_MESSAGE_CHARS`,
`MAX_INTENT_CHARS`, `MAX_RAW_PROPOSAL_CHARS`, `parseActionProposal`,
`stepIdempotencyKey`, `buildCapabilityIndex`, and `buildIterationPlan`,
plus the `GovernedMissionLoopOptions`/`GovernedMissionLoopResult`/
`MissionRunStore`/`ParsedProposalIntent`/`ProposalCapabilityIndex`/
`ParseProposalOptions`/`ProposalErrorCode` types.

Mission composition is provider-neutral: the loop assembles exclusively
over caller-injected existing authorities (capability broker, action
runtime, tool registry, governed model runtime, event bus, optional
harness/run store/memory retrieval). Construction fails fast when a
required authority is missing — `GovernedMissionLoop` refuses to be
built without its broker, action runtime, providers, tools, model
runtime, and events, so no ungoverned loop can ever run. The separation
of duties is absolute: the model proposes structured actions, the
existing `CapabilityBroker` alone authorizes, and the existing execution
surfaces alone execute. `parseActionProposal` is the trust boundary —
unknown capabilities, oversized arguments, and forged approval fields
fail closed, and authority fields (mission id, actor, idempotency key)
are derived server-side, never taken from model output. The loop
dispatches through the existing QIE pipeline (plan -> selection ->
composition -> defense -> governed invocation), so instruction context
never reaches the model ungoverned, and there is no direct
model-to-tool execution path and no hidden provider coupling — provider
access happens only through the injected governed model runtime under
explicit broker authorization.

## Secure Execution & Isolation surface

The SDK exports the P12 contracts (ADR 0046): the canonical
`ExecutionPolicy` builder (`resolveExecutionPolicy`, plus
`serializeExecutionPolicy`/`parseExecutionPolicy`/`policyDigest` —
deterministic, digest-stabilized, fail-closed on unknown fields and
tampering), honest isolation classification (`resolveIsolationState` —
`POLICY_RESTRICTED` is broker-policy enforcement of registered host
functions and is never a sandbox claim; unavailable required isolation
fails closed), runtime-evidence execution-state classification
(`classifyExecutionState`, `journalStateForExecution` — success without
verification is `EXECUTION_COMPLETED`, never `EXECUTION_VERIFIED`),
output containment (`clampOutputBytes` — oversized output is dropped,
never previewed), and the at-most-once step dispatch journal
(`stepAttemptKey`, `InMemoryStepAttemptJournal`,
`JsonFileStepAttemptJournal` — timeout/crash/cancellation settle AMBIGUOUS
and are never re-executed). Policy resolution is provider-neutral and
derives exclusively from runtime-trusted inputs (risk tier, descriptor
timeout, deployer configuration); model-supplied timeout/sandbox/risk
values never feed it. Memory limits are advisory (serialized `null`) and
policies claiming enforced memory limits fail validation. No broker
internals, isolation backends, or privileged execution primitives are
exported.

P13 (ADR 0047) adds provider-neutral INSPECTION types —
`IsolationBackendInfo`, `ExecutionEvidence`, `VerificationResult`, plus the
`IsolationLevel`/`IsolationState`/`ExecutionState` vocabularies — metadata
views over isolation backends (id, supported levels, honest guarantees,
availability), identity-bound execution evidence (mission/step/capability/
execution/backend, exit state, cleanup status), and runtime-derived
verification outcomes (VERIFIED only when trusted probes passed). These are
read-only views: no Docker clients, process handles, supervisor primitives,
filesystem, or credential surfaces cross the SDK boundary, and nothing in
the SDK can select or weaken a backend — isolation requirements come from
deployer configuration only.

P14 (ADR 0048) adds the durable recovery + verified-actions surface:

- **Mission checkpoints** — `MISSION_CHECKPOINT_VERSION`,
  `buildMissionCheckpoint`, `parseMissionCheckpoint`,
  `missionCheckpointDigest`, `serializeMissionCheckpoint`, and the
  `InMemoryMissionCheckpointStore`. Checkpoints are metadata-only
  (identity, cursors, budget counters, binding digests — never prompts,
  arguments, or secrets) and fail closed on tampering, unknown schema, and
  cross-mission identity mismatch.
- **Reconciliation** — `reconcileMission` derives the honest recovery
  decision from durable records: SAFE_TO_RESUME with a verified safe
  boundary, or REQUIRES_VERIFICATION when an ambiguous/dispatching attempt
  exists (never a resume point over uncertainty). `assertRecoveryTransition`
  fences the recovery state machine (CLEAN/RECOVERING/SAFE_TO_RESUME/
  REQUIRES_VERIFICATION/AMBIGUOUS/TERMINAL) — illegal transitions throw.
- **Approvals** — `ApprovalRunner`, `canonicalProposalDigest`,
  `approvalRecordDigest`, `parseApprovalRecord`, and the
  `ConsoleApprovalRunnerCallback`/`DenyApprovalRunnerCallback` defaults.
  Approval is identity-bound to the canonical digest of the exact action
  (capability, arguments, intent, mission, step), single-use (consumed at
  exactly one dispatch), and never model-grantable: the proposing actor can
  never be the approver, and model-supplied approval fields are data.
  The P15 runtime composes these through a DURABLE approval store
  (PENDING/GRANTED/DENIED/CONSUMED survive restarts; server-side TTL;
  reason text redacted before persistence) — the durability layer is a
  runtime composition detail, not a new SDK authority.
- **Adapters** — `registerProductionAdapters` and
  `WorkloadAdapterRegistry`: the first production workload adapters
  (`quack.text.transform`, `quack.data.process`) are deterministic
  READ_ONLY transforms with strict argument schemas (unknown fields
  reject), declared verification strategies, network DENY, and
  credentials NONE. The registry has no model-facing registration path.
- **Inspection types** — `RecoveryState`, `RecoveryInfo`,
  `MissionCheckpoint`, `MissionCheckpointInfo`, `ApprovalRecord`,
  `ApprovalInfo`, `AdapterInfo`, `AdapterVerificationStrategy`.

The recovery exports are inspection/composition contracts, not privileged
operations: nothing in the SDK can force a resume, resolve an ambiguous
step, forge an approval, or bypass broker authorization. Recovery resumes
only through the governed loop itself, which re-verifies every safety
condition.

## Requirements

- Node.js 20+
- TypeScript 5+
