# ADR 0035: Governed Delegation Runtime

## Status

Accepted — 2026-09-06

## Context

Delegation was MISSING: `maxDelegationDepth` was a dormant budget integer
(forced to 0 in `create-system.ts`), capability grants already supported
attenuated derivation (`deriveGrant` with subset enforcement), and the
organization layer exposed only message routing. There was no runtime that
spawned child executions under parent authority.

## Decision

`src/runtime/delegation.ts` defines `DelegationRuntime`. Delegation reuses
the canonical execution path — a child is an ordinary task submitted through
`QuackRuntime.submitGoal` with a derived, agent-scoped capability grant.
**No second orchestration path exists.**

### Delegation identity

`DelegationRequest` carries the parent mission and execution id, the child
goal, actor, child agent id, requested capabilities and scope, reason,
approver, cancellation, and deadline. Every request validates identity,
capabilities, and deadline before any authority is derived.

### Capability attenuation

The child grant is derived from the configured parent grant through the
existing `CapabilityGrantRegistry.deriveGrant`, which enforces: a child
cannot change mission, widen skill scope, exceed parent capabilities, outlive
the parent expiration, or widen scope restrictions. Derivation failure fails
closed with `delegation.attenuation_denied` and no record is created. The
child grant is revoked when the child completes, fails, is cancelled, or
cannot start — no authority residue outlives a delegation.

### Lifecycle

`DelegationRecord` states: `REQUESTED → ACCEPTED → RUNNING → COMPLETED |
FAILED | CANCELLED | BLOCKED`, using explicit transitions with timestamps.
Depth is tracked per chain: each delegation record stores its depth, and
`depthOf(executionId)` resolves parent chains; requests exceeding
`maxDepth` fail closed with `delegation.depth_exceeded`.

### Recovery

Children run through the canonical runtime, so they inherit ADR 0028
recovery semantics unchanged: durable execution identity, journaled
invocations, retry-safety fail-closed behavior. Delegation introduces no
separate recovery mechanism.

### Evidence

A child's completion is trusted only through its durable receipt chain
(ADR 0033): `DelegationRecord.childReceipt` is populated from the child
task's `result.receipt`, and `assertChildReceipt` rejects children that
completed without a verified `PASSED` receipt citing evidence. The parent
never trusts a bare child success status.

### Duplicate guard

One active delegation per (parent execution, goal): terminal records free
the slot; an in-flight duplicate fails closed with `delegation.duplicate`.

## Consequences

- Delegation exists as governed parent → child execution with monotonic
  capability attenuation through the canonical runtime.
- Parents can only accept verified, receipt-cited child evidence.
- `create-system.ts`'s `maxDelegationDepth: 0` remains a composition choice
  (delegation disabled in the default neutral composition until wired);
  enabling it is a bounded config change plus a parent grant.
- Multi-child parallel delegation orchestration (fan-out aggregation) is not
  included; the single-child boundary is the tested unit.

## Verification

`src/runtime/delegation.test.ts` (7 tests): successful delegation through the
canonical runtime returning a verified receipt chain with grant revocation;
authority-widening escalation fails closed at derivation; depth ceiling;
in-flight duplicate rejection; identity/capability validation; failed child
start records FAILED and revokes the grant; `assertChildReceipt` rejects
forged, unverified, and incomplete child results.

Full repository suite: 1,334 ordinary tests + 17 serial tests, 0 failures;
root and SDK typechecks, build, and lint pass.