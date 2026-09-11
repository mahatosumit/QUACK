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
await client.submitGoal("summarize the workspace documents");
await client.shutdown();
```

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

## Requirements

- Node.js 20+
- TypeScript 5+
