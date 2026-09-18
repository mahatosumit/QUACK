# Memory architecture

## Canonical runtime ownership

QUACK exposes one runtime memory boundary through `MemoryStore`. When
`memoryProviderId` is configured, `createQuackSystem` resolves that exact
provider from the admitted extension registry and wraps it with the
runtime-owned `MemoryProviderBinding`. An admitted provider is inert until it
is explicitly selected. With no selection, the existing in-memory or JSON-file
store remains active.

The binding does not create another memory database or execution path. Reads
join the existing planner context assembly, writes occur in the canonical
mission finalization path, and both operations use the same capability broker
as governed tool execution.

```text
admitted MemoryProvider + explicit configuration
  -> MemoryProviderBinding
  -> CapabilityBroker (memory.read / memory.write)
  -> bounded provider call
  -> validated MemoryItem
  -> planner ContextFragment or runtime MemoryRecord
```

## Provider contract

A `MemoryProvider` has a stable `id` and exact `version`. It must implement
`store` and `retrieve`. `forget` and `export` remain optional contract
capabilities, discovered from method presence. The bound delete path reports
an absent `forget` operation as `memory.operation_unsupported`; `export` is not
part of the canonical `MemoryStore` mission surface in this change.

The runtime supplies a frozen context containing actor, mission, task,
execution, session, namespace, stable operation id, effective capability,
deadline, and cancellation signal. These values are host-owned. A provider
cannot supply capability authority or replace mission/execution identity.

Provider records must be valid `MemoryItem` values with JSON metadata, a
recognized type, valid timestamp and confidence, and an access policy. Store
results must preserve the input type, source, confidence, content, mission,
policy, and metadata. Malformed, duplicate, mutated, or oversized output fails
closed with a structured memory error.

## Memory classes and retention

Runtime writes use the existing Memory OS vocabulary:

| Runtime class | Provider item type | Rule |
| --- | --- | --- |
| working memory | `mission.short_term` | Mission-scoped completion state |
| experience | `skill.execution` | Execution learning attached to the mission |
| validated knowledge | `knowledge.long_term` | Requires host `validationEvidenceId` |

The adapter never promotes an unverified claim to long-term knowledge.
Completion writes carry mission-only visibility and require
`permission.memory.write`. Retrieved records are checked again by host
`MemoryPolicy` with `permission.memory.read` before they can enter context.

## Context integration

Selected provider memory is retrieved after configured context providers and
before planner invocation. Item count, serialized bytes, approximate tokens,
deadline, and cancellation are bounded by runtime configuration and the active
agent profile. Every accepted record becomes a `ContextFragment` preserving:

- provider id and provider record id as provenance;
- provider timestamp and confidence;
- memory type and effective scope;
- access policy and metadata;
- configured namespace and persistent retention.

Private, mission, and global visibility map to restricted, confidential, and
internal context classification respectively. Provider memory cannot bypass
the planner's existing context budget.

## Recovery interaction

Durable executions persist the exact memory provider id, version, and namespace
in `ExecutionIdentity`. A restart refuses to resume if the current binding does
not match all three values.

The completion write uses a stable operation id derived from the execution and
is journaled in the canonical checkpoint as `STARTED -> COMPLETED`, including
the input digest and provider record id. A completed acknowledgement is reused
without contacting the provider. A crash after `STARTED` with no durable
acknowledgement is ambiguous and moves recovery to fail-closed reconciliation;
the runtime does not repeat the write automatically.

## Bounds and failures

`memoryProviderTimeoutMs`, `memoryProviderMaxItems`,
`memoryProviderMaxBytes`, and `memoryNamespace` define the host limits. Provider
unavailability, timeout, cancellation, authority denial, invalid responses,
identity mutation, unsupported operations, and ambiguous recovery each surface
as explicit structured errors.

Vector and graph stores remain valid provider implementations when they
preserve these contracts. Provider discovery marketplaces, credential flows,
plugin hook execution, cross-process recovery, and automatic reconciliation of
ambiguous writes remain outside this binding.

## P9 semantic memory (ADR 0043)

P9 adds governed semantic memory/knowledge in `src/memory/semantic/` as a
second layer over the SAME authority components — not a second authority:

```text
SOURCE (user / mission / workspace file)
  -> admission (fail-closed: shape, scope, owner, provenance, bounds,
     duplicates, sensitive content via the ADR 0041 classifier)
  -> canonical SemanticMemoryRecord (sha256 content hash; fail-closed parse)
  -> explicit persistence (authorized actor only; a model output persists
     nothing)
  -> embedding through GovernedModelRuntime ONLY (optional discovered
     provider `embed`; broker resolves provider.invoke before contact; no
     fallback; provider-neutral contracts)
  -> derived vector index (cache entries re-validated against canonical
     chunks on every load)
  -> governed retrieval (scope/owner/lifecycle policy before ranking;
     deterministic score/chunkId/memoryId ordering)
  -> QIE ContextCandidates (trust MEMORY)
  -> P8.3 firewall (admittedMemory backing) -> P8.2 selector
  -> P8.1 composer (single budget authority) -> P8.5 defense
  -> P8.4 adapter -> GovernedModelRuntime
```

MEMORY IS DATA, NOT AUTHORITY. Content never rewrites scope, owner,
lifecycle, trust, or policy fields; retrieval relevance and embedding
scores are never authority. Poisoning defense is structural — the
adversarial suite proves escalation/override/forgery payloads stay inert
data in the MEMORY lane, and no blacklist is the defense.

Knowledge sources are inline text and workspace-local files (traversal
fails closed). URLs, remote repositories, and crawling are UNSUPPORTED.
Deletion propagates record -> index -> cache; restart recovery re-validates
the cache against canonical records so interrupted writes and tampering can
never surface as retrievable. Compaction reuses the ADR 0030 engine. The
SWE composition authorizes reads/writes/deletes through the capability
broker (`memory.read`/`memory.write`) and enables embeddings only when the
governed runtime exposes `embed`. Multi-process file writes follow the
one-process-per-data-dir constraint.
