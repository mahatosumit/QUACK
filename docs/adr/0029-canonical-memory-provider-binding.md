# ADR 0029: Canonical Memory-Provider Binding

## Status

Accepted — 2026-09-06

## Context

The extension contract admitted versioned `MemoryProvider` contributions, but
the production composition did not select or execute them. Planning and
completion continued to use the built-in `MemoryStore`, so extension admission
was metadata only. Calling providers directly from planners or the runtime
would have bypassed capability authority, context bounds, and the interrupted
mission recovery rules established by ADR 0028.

QUACK also contains richer and domain-specific memory implementations. They
remain useful compatibility or specialized components, but none is a second
authority for the neutral mission runtime.

## Decision

`createQuackSystem` may select one admitted memory provider by exact configured
id. The runtime-owned `MemoryProviderBinding` implements the existing
`MemoryStore` boundary and is the only production adapter between the canonical
runtime and an extension memory provider. Admission alone has no execution
effect, and an unknown configured id fails system construction.

`store` and `retrieve` are the required provider operations. `forget` and
`export` remain optional contract capabilities discovered from method presence.
The bound delete path fails explicitly when `forget` is unsupported; `export`
is not added to the canonical mission memory surface. Duplicate provider ids
are rejected atomically by extension admission.

### Authority and identity

Every provider operation resolves `memory.read` or `memory.write` through the
existing `CapabilityBroker`, including extension policy restrictions and a
last-moment authority recheck. The provider receives a frozen, host-created
context containing mission, task, execution, session, actor, namespace,
operation id, capability, deadline, and cancellation signal. Provider data is
never treated as a grant or execution identity.

Write inputs are immutable. Returned items must preserve their input type,
source, confidence, content, related mission, access policy, and metadata.
Reads are schema-validated and then checked by host `MemoryPolicy`. Invalid,
duplicate, oversized, unauthorized, or identity-mutating results fail closed.

### Context and memory classes

Provider retrieval joins normal planner context assembly after configured
context providers. Runtime limits bound item count, bytes, approximate tokens,
deadline, and cancellation. Accepted records become ordinary
`ContextFragment` values with provider and record provenance, timestamp,
confidence, access policy, effective scope, and configured namespace.

Runtime writes map to existing Memory OS types: working memory becomes
`mission.short_term`, experience becomes `skill.execution`, and validated
knowledge becomes `knowledge.long_term` only when the host supplies validation
evidence. Provider selection therefore changes storage implementation without
changing the runtime's memory semantics.

### Durable completion writes

A durable execution records the selected provider id, version, and namespace.
Resume requires an exact match. Completion writes use a stable operation id and
are journaled in the `SessionRuntime` checkpoint before and after provider
dispatch. A `COMPLETED` acknowledgement is reused without provider access. A
`STARTED` write without acknowledgement is treated as an ambiguous side effect
and requires reconciliation; it is never automatically repeated.

## Consequences

- The canonical runtime has one memory binding and one capability path.
- Existing local in-memory and JSON behavior is unchanged when no provider is
  selected.
- Provider implementations may use vector, graph, relational, or remote
  storage while preserving QUACK identity, access, provenance, and recovery
  contracts.
- Provider marketplaces, authentication flows, executable plugin hooks,
  distributed locking, and automatic ambiguous-write reconciliation remain
  unsupported.

## Verification

`src/memory/provider-binding.test.ts` covers governed reads/writes, provenance,
bounds, timeouts, malformed and duplicate output, immutable write identity,
validated-knowledge gating, and unsupported optional operations.

`src/system/memory-provider-binding.test.ts` covers exact selection, planner
context, canonical completion writes, frozen execution identity, structured
mission failures, extension policy denial, local fallback behavior, durable
acknowledgement reuse, ambiguous-write reconciliation, and restart rejection
when provider id/version/namespace no longer match.

`src/extensions/registry.test.ts` covers duplicate memory-provider admission
without replacement.
