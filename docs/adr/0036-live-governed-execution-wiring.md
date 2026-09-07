# ADR 0036: Live Governed Execution Wiring

## Status

Accepted — 2026-09-06

## Context

Phase 2 introduced the governed surfaces (`GovernedProviderRouter`,
`ToolMaterialization`, `GovernedHookExecutor`, `DelegationRuntime`) but the
live compositions still exposed ungoverned dispatch paths: the SWE
distribution exposed a raw `ModelRuntime` whose `generate`/`stream` fetched
provider endpoints with no capability check; `GovernedProviderRouter` was
constructed but never reachable from a live caller; plugin hooks had no
runtime emission points; `DelegationRuntime` was never composed into
`createQuackSystem`; MCP action evidence lacked operation identity and retry
safety.

## Decision

### Governed model dispatch (`src/models/governed-runtime.ts`)

`GovernedModelRuntime` wraps a `ModelRuntime` and resolves the
`provider.invoke` capability through the `CapabilityBroker` for every
`generate`/`stream` call, carrying mission/task/agent/skill/actor identity
and cancellation, with mid-flight revalidation. Denial fails closed with
`model.permission_denied` before any provider contact. `selectModel` stays
ungated: it is a registry metadata lookup with no network I/O.

`governModelRuntime` returns a `ModelRuntime`-typed proxy whose own
`generate`/`stream` are shadowed by non-configurable gated versions. The SWE
composition exposes this proxy as `system.modelRuntime` (plus an explicit
`governedModelRuntime` and `governedProviderRouter`), so the ungoverned path
is not reachable through the system surface. Calling the gated surface
without an execution context fails closed
(`model.execution_context_required`).

### Runtime hook events (`src/extensions/hook-bridge.ts`)

`RuntimeHookBridge` subscribes to canonical runtime events
(`task.created/started/completed/failed`, `tool.requested/completed`,
`capability.decided`, `memory.written`) and dispatches admitted plugin hooks
of the matching kind through `GovernedHookExecutor`. Hooks stay observers:
payloads are the event data, dispatch is broker-governed, failures/timeouts/
denials are contained per hook, and dispatch records are kept for audit.
`createQuackSystem` builds `GovernedHook`s from admitted plugin
contributions and exposes `system.hookBridge`.

### Delegation composition (`src/system/create-system.ts`, `src/runtime/delegation.ts`)

`createQuackSystem` wires `DelegationRuntime` when `delegationMaxDepth > 0`
and a parent grant is configured (explicit `delegationParentGrantId`, or
exactly one seeded mission grant). Default remains disabled (depth 0). The
child submit path is the canonical `runtime.submitGoal`. Fan-out aggregation
(`delegateFanOut`) runs children in request order; the parent completes only
when every child produced a verified receipt (`PARTIAL` otherwise; empty
fan-out is `FAILED`). Depth ceilings, duplicate guards, and grant revocation
on termination are unchanged from ADR 0035.

### MCP evidence normalization (`src/actions/runtime.ts`)

MCP action evidence now cites the governed operation identity: `operationId`
(execution id), `retrySafety` derived from the descriptor's side-effect and
idempotency (`READ_ONLY`/`IDEMPOTENT_WRITE`/`NON_IDEMPOTENT_WRITE`/
`DESTRUCTIVE`), `requiredPermissions`, `providerVersion`, and `namespace`
(provider id). MCP dispatch was already broker-gated; this completes
materialization in evidence without a new authority path.

## Consequences

- No live dispatch seam on the SWE or neutral system surface can bypass the
  capability broker for model/provider generation.
- Hooks fire on real runtime events under governed authority, without any
  ability to mutate authoritative state.
- Delegation is a bounded composition choice: disabled by default, enabled
  only with a depth ceiling and a parent grant.
- MCP evidence is attributable to operation identity and retry safety.

## Verification

- `src/models/governed-runtime.test.ts` (7), `src/distributions/governed-surfaces.test.ts` (1)
- `src/extensions/hook-bridge.test.ts` (6), `src/system/hook-wiring.test.ts` (1)
- `src/runtime/delegation.test.ts` (12 incl. 5 fan-out), `src/system/delegation-wiring.test.ts` (1)
- `src/actions/*.test.js` (16) incl. MCP integration
- Full repository suite: 1,372 ordinary + 17 serial tests, 0 failures; root
  and SDK typechecks, build, lint pass; SDK package tests 3/3.