# ADR 0032: Unified Provider/Tool Materialization

## Status

Accepted — 2026-09-06

## Context

The Phase 2 audit found two gaps in the provider/tool materialization boundary:

1. **Provider generation bypassed the capability broker.** `CapabilityProviderRouter`
   (`src/providers/kernel.ts`) gated routing by privacy policy, model capability,
   and circuit state, but resolved no capability authority. Nothing enforced the
   existing `provider.invoke` permission before `provider.generate()` ran.
2. **No unified executable representation.** Runtime tool dispatch
   (`QuackRuntime.executeTool`) was already capability-gated and
   revalidated before dispatch, but the tool itself received only a thin
   context (`taskId`, `actor`, `signal`, `deadline`, `idempotencyKey`,
   `attemptId`). Provider identity, operation identity, execution/session
   identity, namespace, and provenance were not made explicit at the seam, so
   each provider would have had to invent its own identity logic.

## Decision

### Tool materialization contract

`src/tools/materialization.ts` defines `ToolMaterialization`: a frozen,
validated, explicit executable representation of a tool or provider operation.
It preserves, as applicable:

- provider identity and version
- tool identity
- capability id that authorizes execution
- mission / task / execution / session identity
- actor, agent, skill identity
- namespace
- operation identity (stable `operationId`, defaulting to a generated id)
- deadline and cancellation
- retry safety (`READ_ONLY`, `IDEMPOTENT_WRITE`, `NON_IDEMPOTENT_WRITE`,
  `DESTRUCTIVE`, `UNKNOWN` — unchanged from ADR 0028 recovery classes)
- provenance (tool/provider identity plus `runtime` / `extension` / `plugin`
  source)

`materializeTool(input)` is the single identity-construction path; providers do
not duplicate identity generation. Invalid identity, retry safety, or deadline
fail closed before dispatch.

`createGovernedToolExecutor(materialization, executor)` is the dispatch
boundary: it rejects tool-id mismatch at dispatch, rejects cancelled
execution, and forwards the materialized identity (task, actor, session,
operation, deadline, cancellation) to the underlying executor. Authority is
enforced by the runtime's existing capability resolution before dispatch;
materialization never grants authority.

`materializationSnapshot` projects the envelope to JSON-safe data for events
and logs without the live `AbortSignal`.

### Governed provider dispatch

`src/providers/governed-router.ts` defines `GovernedProviderRouter`, which
wraps the existing `CapabilityProviderRouter`. Before routing, it builds a
`provider.invoke` capability request from the execution context (mission,
task, actor, agent, skill) via the existing `buildToolCapabilityRequest`
factory, resolves it through the `CapabilityBroker`, and revalidates
authority before dispatch. Denial fails closed with a normalized
`POLICY_DENIED` `ProviderRoutingError` before any provider is contacted.

`createQuackSystem` now exposes `governedProviderRouter` alongside the raw
`capabilityRouter`; the raw router remains a pure policy/capability/circuit
component, and governed dispatch is the authority-enforcing boundary.

## Consequences

- Tool and provider operations now have one explicit identity contract; no
  provider manufactures its own authority or identity.
- The provider bypass is closed for the canonical path: model generation must
  resolve `provider.invoke` through the broker before contacting any provider.
- Existing single-process recovery semantics, retry classes, and the
  fail-closed ambiguous-effect behavior are unchanged.
- The thin `ToolExecutionContext` remains backward compatible; the
  materialization envelope is the richer explicit contract used at governed
  seams.

## Verification

- `src/tools/materialization.test.ts` (9 tests): valid materialization, all
  identity fields, invalid/missing identity, invalid retry safety, invalid
  deadline, minimal input, retry-class preservation, dispatch identity
  mismatch, cancelled dispatch, identity forwarding, JSON-safe snapshot.
- `src/providers/governed-router.test.ts` (3 tests): broker resolution happens
  before provider contact with full execution identity, denial fails closed
  with `POLICY_DENIED` before any provider call, mid-flight revalidation
  failure rejects before generation.
- Full repository suite: 1,306 ordinary tests + 17 serial self-modification
  tests, 0 failures; root and SDK typechecks, build, and lint pass.