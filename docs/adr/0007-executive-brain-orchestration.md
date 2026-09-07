# ADR 0007: ExecutiveBrain as Orchestration Layer

Status: Accepted

## Context

ADR 0006 introduced the Engine Workflow Runtime. The ExecutiveBrain previously handled planning, execution, reflection, and recovery directly — implementing its own step execution loop, provider calls, and heuristic fallbacks. With the new engine available, the Brain should delegate these responsibilities and become a pure orchestration layer.

The key question is: what should the ExecutiveBrain still own versus what should it delegate?

## Decision

The ExecutiveBrain becomes an orchestration layer that:

1. **Creates sessions** via `SessionRuntime.createSession()` for each task.
2. **Delegates planning** to the `Planner` class, which decomposes goals into DAGs.
3. **Builds task graphs** from `Plan.steps[]` using `TaskGraphBuilder`.
4. **Starts workflows** via `SessionRuntime.startWorkflow()`, which creates a `WorkflowEngine` and begins execution.
5. **Monitors workflow completion** by polling the engine's state.
6. **Runs reflection** after workflow completion using the `ReflectionEngine`.
7. **Triggers recovery** on failed nodes using the `RecoveryEngine`.
8. **Emits events** through the EventBus for observability.

### What changes

- `plan()` now wraps `Planner.createPlan()` and maps the engine `Plan` to the existing `Brain.plan()` interface.
- `execute()` now wraps `SessionRuntime.startWorkflow()`, waits for completion, runs post-execution reflection, and triggers recovery — rather than executing steps directly.
- `reason()` delegates to `ReflectionEngine.reflect()` to produce structured reasoning.
- `reflect()` builds a `TaskNode` and `TaskNodeResult` from the outcome and delegates to `ReflectionEngine.reflect()`.
- `ExecutiveBrainConfig` is simplified: removed `defaultPlanningProvider` and `defaultExecutionProvider` (provider routing is now the CostOptimizer's job), added `defaultRoutingPolicy`, `schedulerConfig`, `retryPolicy`, and `checkpointIntervalMs`.
- The constructor no longer accepts an optional `SemanticLayer` reference; context enrichment is handled by the `Planner` via memory store queries.

### What stays the same

- The `Brain` interface (`plan`, `execute`, `reason`, `reflect`) is unchanged.
- The `create-system.ts` wiring still creates an `ExecutiveBrain` instance.
- Event emissions for `task.created`, `task.planned`, `task.completed` are preserved.

## Consequences

**Positive:**
- ExecutiveBrain is simpler, with clear delegation boundaries.
- Engine subsystems are independently testable (46 new tests).
- Provider selection is centralized in CostOptimizer with configurable policies.
- Sessions provide undo/redo and lifecycle management.

**Negative:**
- The Brain now depends on the engine module, adding an import chain.
- The polling-based workflow completion monitoring is less efficient than a callback-based approach.
- The mapping between engine types and brain types adds a thin translation layer.

## Status

Accepted. Implemented alongside ADR 0006.
