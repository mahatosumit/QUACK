# ADR 0050: Canonical Mission Entry Contract

Date: 2026-09-23
Status: Accepted
Phase: Runtime convergence
Predecessors: ADR 0045 (governed mission runtime), ADR 0049 (production coordination)

## Context

QUACK exposed two production execution entry points. Static graph work entered
through `QuackRuntime.submitGoal`, while model-in-the-loop work called
`GovernedMissionLoop.run` directly from API, server, and CLI surfaces. Both
paths reused the CapabilityBroker, but clients still selected and invoked a
lifecycle owner themselves. Adding desktop, gateway, and scheduler clients to
that split would make two authorities permanent.

## Decision

`QuackRuntime.submitMission(MissionRequest)` is the canonical product entry
point. `MissionRequest` carries objective, identity, origin, mode, profile,
routing preference, budgets, declared permissions, constraints, verification
criteria, cancellation, and deadline without granting any authority.

The runtime owns engine selection:

- `dag` is the built-in strategy and continues through `SessionRuntime`,
  `DefaultLoopDriver`, `WorkflowEngine`, and `ExecutionScheduler`;
- `governed` is a trusted composition adapter over the existing
  `GovernedMissionLoop`; it is registered once by the SWE composition root;
- duplicate engine registration and result identity substitution fail closed;
- permission declarations become grants only in the trusted composition and
  every actual operation remains subject to CapabilityBroker resolution.

`submitGoal` remains as a compatibility adapter and delegates to
`submitMission(engine: "dag")`. API submissions, HTTP mission creation,
governed CLI execution, and the TypeScript SDK now enter through
`submitMission`. Governed status/recovery readers may continue inspecting the
existing durable run and checkpoint stores; inspection is not execution.

Modes (`build`, `plan`, `review`, `mission`) are policy inputs to the same
runtime. The runtime enforces a mode ceiling before broker resolution:

- `build` and `mission` may request any valid permission, but still require a
  matching grant and broker policy decision;
- `plan` is read-only by default and can request a mutating permission only
  when the caller explicitly declares it, after which normal approval and
  broker checks still apply;
- `review` remains read-only even when the mission already has a broader grant
  or the request declares a mutating permission.

The mode and explicitly approved permission set are stored in durable DAG
execution identity and restored during recovery. The governed loop carries the
same values into its execution harness, so neither engine can widen mode policy.

## Security invariants

1. Engine registration is trusted composition, not plugin discovery.
2. An adapter cannot replace the runtime-selected mission id, engine, or mode.
3. Declaring a permission is not authorization; the broker remains the only
   action authority.
4. The governed adapter calls the existing governed loop and execution
   surfaces; it does not introduce a new broker, event bus, memory authority,
   or tool executor.
5. Prepared DAGs still execute through normal authorization and verification.
6. A mode declaration can only reduce authority. It cannot create a grant or
   bypass an approval, and recovery preserves the original ceiling.

## Compatibility and migration

- Existing `submitGoal` callers continue to receive `QuackResult<Task>`.
- Existing governed run/checkpoint types and read APIs remain available during
  migration.
- Direct construction of `GovernedMissionLoop` remains public for tests and
  advanced embedding, but product surfaces must not call it for execution.
- A later compatibility release may deprecate direct loop execution after all
  supported clients use the canonical entry contract.

## Consequences

QUACK now has one client-facing mission admission point and a normalized,
provider-neutral result. This is the prerequisite for consistent desktop,
gateway, scheduler, mode-policy, routing, evidence, and observability work.

This slice does not merge the governed loop's durable run/checkpoint schema
with the DAG task/session schema. That storage convergence remains the next
runtime phase and must preserve ADR 0048/0049 recovery guarantees.
