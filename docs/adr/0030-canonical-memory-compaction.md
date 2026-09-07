# ADR 0030: Canonical Memory Compaction

## Status

Accepted — 2026-09-06

## Context

The canonical `MemoryStore` boundary (ADR 0029) supported `write` and `search`
only. Nothing bounded growth or removed redundant records, so long-running
missions accumulated duplicate and stale entries in local in-memory and JSON
storage. `QUACK.md` section 8 defines compaction semantics: discard repetitive
chatter while never compacting away validated knowledge, security decisions,
evidence links, acceptance criteria, unresolved risks, pending approvals, user
constraints, or destructive actions.

Compaction must be host-owned and deterministic. It cannot depend on an LLM or
provider-side consolidation that could silently drop protected facts, and a
remote provider cannot be assumed to honor host semantics.

## Decision

`MemoryStore` gains an optional `compact` operation. Both canonical local
implementations (`InMemoryMemoryStore`, `JsonFileMemoryStore`) implement it;
the memory-provider binding does not and reports compaction unsupported (its
provider-owned consolidation is out of scope, matching ADR 0029).

### Semantics

`compact(options)` performs one deterministic pass over all stored records:

- Records older than an optional `olderThan` timestamp are dropped, unless
  protected.
- Records are grouped by `scope`. A per-scope `maxItemsPerScope` bound keeps
  the newest records in that scope.
- Duplicate content within a scope is collapsed, keeping the newest copy.
- A protected record is never removed: `validated-knowledge` class
  (`memoryClass === "validated-knowledge"`), or an explicit `protected` /
  `protect` metadata marker. Protected records are also exempt from
  deduplication, so two protected records with identical content both survive.

The per-scope retention bound applies only to ordinary records. Protected
records always survive, so a bound cannot compact away knowledge that the
host marked as durable. `protect: false` disables the protection carve-out for
all paths consistently.

Compaction is deterministic, requires no external service, and returns a
`MemoryCompactResult` reporting removed and kept counts. The JSON store
persists the compacted set atomically; the in-memory store mutates its visible
cache only after a successful pass.

## Consequences

- Local memory can now be bounded and de-duplicated without an LLM or a
  provider dependency.
- Existing behavior is unchanged until `compact` is explicitly called; no
  automatic compaction is scheduled.
- Protected knowledge survives any bound or age policy by construction.
- Provider-owned consolidation and automatic/background compaction scheduling
  remain unsupported.

## Verification

`src/memory/memory.test.ts` covers per-scope bounding, protected-record
survival beyond a bound, within-scope deduplication, age-based pruning, JSON
persistence across instances, and `isProtectedMemoryRecord` recognition.