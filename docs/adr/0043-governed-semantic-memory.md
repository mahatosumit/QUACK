# ADR 0043: Governed Semantic Memory and Knowledge

## Status

Accepted — 2026-09-11

## Context

P8 completed the QUACK Instruction Engine (ADR 0042): deterministic context
compilation, admission, selection, injection defense, and governed model
dispatch. QUACK's existing memory (ADR 0029/0030) is keyword-search storage
with scope labels and provider bindings — no semantic retrieval, and no
governed embedding path at all. The roadmap's P9 calls for semantic
memory/knowledge WITHOUT creating a second authority surface: the product
principle is that memory is DATA, never AUTHORITY.

A memory record may contain arbitrary text, including instruction-override
attempts, fake verification claims, or provider-manipulation prose. None of
that may change trust, capability, policy, identity, provider authority,
approval state, or execution authority. Any design that lets retrieval
relevance or embedding score influence authority is unacceptable.

## Decision

### Architecture (the P9 boundary)

One governed pipeline, reusing every existing authority component:

```
SOURCE (user / mission / workspace file)
  → MEMORY ADMISSION (P9.4, fail-closed)
  → CANONICAL MEMORY RECORD (P9.1, single source of truth)
  → EXPLICIT PERSISTENCE (P9.3/P9.6, authorized actor only)
  → EMBEDDING (P9.8, GovernedModelRuntime ONLY)
  → DERIVED INDEX (P9.10, cache re-validated against canonical records)
  → GOVERNED RETRIEVAL (P9.11, scope/owner/lifecycle policy first)
  → EXPLICIT CONTEXT CANDIDATES (P9.13, trust = MEMORY)
  → P8.3 FIREWALL (admittedMemory backing required)
  → P8.2 SELECTOR → P8.1 COMPOSER (single budget authority)
  → P8.5 DEFENSE → P8.4 ADAPTER → GovernedModelRuntime
```

`src/memory/semantic/` implements this; no other memory authority exists.

### Canonical record (P9.1/P9.7)

`SemanticMemoryRecord`: memoryId, scope, owner, content, contentHash
(sha256), provenance (sourceKind + sourceId + optional sourceRef),
lifecycle (active/retired/deleted), createdAt/updatedAt, admission metadata
(actor, policyNotes, persistence: "explicit"), optional derived embedding
metadata (providerId, model, embeddingVersion, dimensions, contentHash —
never credentials), optional bounded data metadata. `parseSemanticMemoryRecord`
is fail-closed: tampered hashes, unknown scopes, forged provenance, and
non-explicit persistence markers are excluded on load — never coerced.

Chunking is deterministic: fixed-size slices with chunk ids derived from
`sha256(memoryId:position)` — no timestamps, no random ids. Equivalent input
produces equivalent chunks.

### Scope model (P9.2)

Exactly the existing MemoryScope vocabulary: session, task, agent,
workspace, project, global. No new scopes. Retrieval filters scope + owner
BEFORE ranking: a record outside the caller's scope/owner is invisible, not
merely low-scored.

### Persistence is explicit and structural (P9.3)

`persistence: "explicit"` is a required admission field. A model output
saying "remember this forever" is not a persistence request — persistence
happens only when an authorized actor passes the admission boundary. The
SWE composition authorizes semantic-memory reads/writes/deletes through the
EXISTING capability broker (`memory.read`/`memory.write`).

### Admission (P9.4/P9.5)

`admitSemanticMemory` validates shape, scope, owner, actor, provenance,
content bounds (P9.28 table), duplicate identity, duplicate content, and
sensitive content (the ADR 0041 classifier, rejection with class names only —
never rewriting, never echoing). Fail-closed: nothing is coerced; malicious
content that passes the sensitive-content policy is admitted as inert data
whose authority fields are host-owned. Content vs metadata is structural:
authority fields are host-supplied inputs; content cannot touch them.

### Embedding governance (P9.8/P9.9)

Embeddings are provider operations. The ONLY path is
`memory content → EmbeddingRequest → GovernedModelRuntime.embed →
capability broker (provider.invoke) → provider`. Concretely:

- `ModelProvider.embed?` is an optional discovered operation
  (Ollama `/api/embeddings`, OpenAI-compatible `/embeddings`).
- `ModelRuntime.embed` selects an embedding-capable model and dispatches;
  NO fallback — a failed embedding is a structured error, never a silently
  different vector space.
- `GovernedModelRuntime.embed` resolves `provider.invoke` through the
  broker BEFORE provider contact; denial fails closed with
  `model.permission_denied`.
- `governModelRuntime` gates `embed` on the in-place surface, so the
  ungoverned path is unreachable through the proxy.
- P9.9: memory APIs consume only the provider-neutral
  `EmbeddingRequest`/`EmbeddingResponse` contracts. No vendor objects, no
  credentials, no provider clients.

The SWE composition enables embeddings ONLY when the governed runtime
exposes `embed`.

### Index is derived infrastructure (P9.10/P9.18/P9.20)

`SemanticMemoryIndex` is an in-memory cosine index over chunk vectors with
an OPTIONAL durable vector cache. The cache is pure acceleration: on load
every entry is re-validated against the canonical store's live chunks
(memoryId, contentHash, scope, owner, position, embeddingVersion); an
interrupted write, a tampered cache, or a deleted memory can never surface as
retrievable. Deletion order: canonical record first, then index entries,
then cache; recovery re-validates and drops orphans in both directions.

### Retrieval is governed and deterministic (P9.11/P9.12/P9.14/P9.16)

`retrieveSemanticMemory` applies policy (scope, owner, lifecycle,
source-kind) inside the index filter, then ranks deterministically: score
desc, chunkId asc at chunk level; score desc, memoryId asc at memory level.
Insertion order never decides. Scores are relevance only — never authority.
Every hit is an explicit reference to a canonical record with full
provenance; no text flows directly into any prompt.

### QIE integration (P9.13)

`pipelineMemoryToQie` turns retrieval hits into explicit
`ContextCandidate`s (provenance source `semantic-memory`, category
`memory`, trust `MEMORY`) and supplies the `admittedMemory` authority view
for the P8.3 firewall. The firewall, selector, composer, defense, and
adapter are the EXISTING P8 components — there is no memory prompt
composer, no manual concatenation, no selector bypass, and the P8.1
composer stays the single budget authority. Memory items always travel in
the MEMORY lane; P8.5 flags instruction-like memory content as data without
blocking or elevating it.

### Poisoning defense is structural (P9.15)

Adversarial suite (`security.test.ts`): instruction override, fake system
prompt, fake developer instruction, capability escalation, identity
escalation, provider manipulation, approval bypass, secret exfiltration
(rejected at admission by the sensitive-content policy), forged
verification (no verification field exists on semantic records — evidence
stays with the existing EvidenceRecordV1 machinery), forged provenance
(fail-closed parse), cross-scope poisoning, stale deleted memory, hidden
surviving vector, high-relevance malicious memory (relevance ≠ authority),
and insertion-order variation. The defense is the STRUCTURE: content never
upgrades authority. There is no content blacklist as the defense
mechanism.

### Evaluation and observability (P9.21/P9.22)

`scoreMemoryQuality` scores scopeCorrectness, provenanceCompleteness, and
deletionCorrectness from METADATA-ONLY evidence; `MissionEvaluator`
attaches the `memory` dimensions additively (absent without semantic
memory — the P5/P8.6 contract preserved). Ten `memory.*` event types join
the existing EventBus union; payloads are metadata-only and bounded (ids,
scopes, hashes, counts — never content). Observability failures never
break memory operations.

### Knowledge sources (P9.26)

Supported: inline text and workspace-local files (path-validated inside the
workspace root; traversal fails closed). UNSUPPORTED: URLs, remote
repositories, crawling — rejected explicitly, never silently attempted.
Ingestion flows through the same admission boundary as user memory.

### Studio / CLI / SDK (P9.23/P9.24/P9.25)

- Studio Evidence view gains a Semantic memory panel (scope, owner,
  provenance, embedding state, lifecycle; honest empty states) + the M
  evaluation dimension badge; live SSE refresh covers `memory.*` events.
- `quack memory list|inspect <id>|search <query>|delete <id>` over the
  canonical service; exit codes 0/1/2/3; `--json` output; tampered records
  excluded, never rendered.
- `@quack/sdk` exports the stable contracts (records, admission, retrieval,
  QIE candidates, evaluation, service facade). Vector-database internals,
  storage paths, provider clients, and policy objects are NOT exported.

## Consequences

- Semantic memory exists as a governed context source with the same
  fail-closed posture as the rest of the runtime.
- Embeddings require a configured embedding-capable governed provider;
  without one, the system honestly reports `memory.embeddings_disabled`
  rather than fabricating vectors.
- Multi-process concurrent writes to the semantic store follow the same
  documented constraint as the JSON task store: one process per data dir
  (P9.20; ADR 0031 multi-process recovery applies to the coordination
  store, not this file).
- A "semantic-quality" score beyond observable behavioral dimensions
  (scope correctness, provenance completeness, deletion correctness) is
  deliberately NOT invented — no defensible measurement model exists.
- URL/repository/crawl knowledge ingestion remains UNSUPPORTED pending a
  governed fetch boundary.

## Verification

- `src/memory/semantic/semantic.test.ts` — 22 tests: record contract +
  fail-closed parse, deterministic chunking, admission matrix, index
  determinism + orphan sweep, scope/owner isolation, insertion-order
  independence, deletion invisibility, store persistence/tamper
  exclusion, compaction reuse, knowledge-source bounds + traversal,
  QIE pipeline (lane + unbacked rejection), evaluation dimensions, event
  vocabulary.
- `src/memory/semantic/security.test.ts` — 17 adversarial tests (P9.15 /
  P9.27 matrix): authority escalation, cross-scope poisoning, forged
  provenance/verification, duplicate identity, high-relevance hostility,
  stale deleted memory with hand-crafted surviving cache entry, provider
  denial/malformed/no-retry, QIE bypass resistance (P8.3 unbacked
  rejection + P8.5 flag-without-elevation), crash recovery, observability
  content-leak resistance, unauthorized knowledge sources, rank-grants-
  nothing.
- `src/cli.test.ts` — P9.24 command tests (parse, list, inspect, delete,
  honest search unavailability).
- `sdk/test/client.test.mjs` — P9.25 SDK contract + service round-trip.
- Models: `GovernedModelRuntime.embed` gates `provider.invoke`; providers
  gained optional `embed` (no generation-path changes).
