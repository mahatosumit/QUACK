# ADR 0027: Consolidate Public Mission Execution Through QuackRuntime

## Status
Accepted — Phase 2 convergence in progress

## Implementation update — 2026-09-04

The public mission path is now:

```text
CLI / API / HTTP server / SDK / QuackRuntime
  → QuackRuntime
  → SessionRuntime
  → DefaultLoopDriver
  → WorkflowEngine / ExecutionScheduler
  → CapabilityBroker
  → explicit verification
```

`AgentLoop` remains exported only as a compatibility facade. Its `start()`
method delegates to `QuackRuntime.submitGoal()` and returns the resulting
`LoopResult`. Constructing it without a `QuackRuntime` rejects explicitly, so
it cannot revive the former independent planner/harness loop. Pause and resume
remain unsupported on the facade; cancellation propagates an abort signal to
the runtime.

This does not yet retire all compatibility surfaces. Workforce skill dispatch,
company scheduling, and direct governed tool helpers are not public mission
lifecycle entry points and remain separately classified until their callers are
migrated or isolated. They must not report mission success.

As of 2026-09-04, `CompanyTaskScheduler` is isolated as an explicitly
unsupported compatibility surface. Its task plans have no typed tool invocation
representation, so its former arbitrary executor callback cannot be converted
to governed runtime work without creating an authority escape hatch. The class
keeps its source-level API but validates and rejects before callback execution;
it no longer creates a `WorkflowEngine`, execution scheduler, checkpoint, or
journal. Company plan, lease, grant, evidence, and independent-verification
metadata remain in `MissionCompanyRuntime`.

`SkillExecutor` retains its exported compatibility API for portable skills.
As of 2026-09-04, a definition without `portableExecution` fails closed rather
than invoking its callable body directly. This is a deliberate compatibility
boundary: raw callable skills cannot demonstrate runtime authority, governed
tool dispatch, or evaluation, so they are not treated as production execution.

## Context
The analysis below is the historical pre-convergence inventory retained to
explain the decision. The implementation update above is authoritative for the
public mission lifecycle.
QUACK OS currently has **three distinct mission execution paths** in production code:

| Path | Entry Point | Components | Used By |
|------|-------------|------------|---------|
| **A (New)** | `createLoopDriver()` + Harness v2 (`QUACK_NATIVE`) | `DefaultLoopDriver` → `Harness.send()` → capability broker | CLI (`mission`, `trace`, `evaluate`, `start`), API (`submitMission`), Server (`POST /missions`), E2E tests |
| **B (Legacy)** | `QuackRuntime.submitGoal()` | `ExecutiveBrain` → `Planner` → `WorkflowEngine` → `SessionRuntime` | CLI fallback (non-mission commands), direct `submitGoal` calls |
| **C (Unused)** | `AgentLoop` class | `AgentLoop` (Observe→Plan→Act→Verify→Reflect) | **No production entry point** |

Additionally, there are **two harness implementations**:
- **Harness v1** (`system.harness`): `TraceRecorder`, `MissionEvaluator`, `ReplayEngine` — used by API for trace/eval only
- **Harness v2** (`Harness` interface + `QUACK_NATIVE`): `send()`, `start()`, `stop()` — used by LoopDriver for execution

### Evidence
- **CLI** (`src/cli.ts:423-532`): Commands `mission`, `trace`, `evaluate`, `start` explicitly use LoopDriver + Harness v2. Fallback at line 541 calls `system.runtime.submitGoal()` (Path B).
- **API** (`src/api/index.ts:42-147`): `submitMission()` creates LoopDriver + Harness v2. Uses legacy `system.harness` for trace/eval (line 93).
- **Server** (`src/server/index.ts:321`): `POST /missions` → `system.api.submitMission()` → Path A.
- **E2E Tests** (`src/system/v1-e2e.test.ts:94-144`): Uses `system.workforce.executeMission()` AND directly creates LoopDriver + Harness v2.
- **AgentLoop** (`src/agent-loop/index.ts:172`): Documented as "canonical executive runtime for a single mission" but **zero production references** outside tests.

### Problems
1. **Behavioral divergence**: Path A (LoopDriver) has explicit budget/stall/detection logic (`DefaultLoopDriver`), Path B (ExecutiveBrain) uses `WorkflowEngine` with different retry/recovery semantics.
2. **Harness duplication**: Trace/eval uses legacy harness, execution uses new harness — inconsistent observability.
3. **Dead code**: `AgentLoop` class (941 lines) is production-grade but unwired.
4. **Testing gap**: E2E tests exercise Path A; unit tests for `ExecutiveBrain`/`WorkflowEngine` exercise Path B. No test covers both.
5. **Maintenance burden**: Bug fixes must be applied in two places (e.g., capability denial handling, progress detection).

## Decision
**Consolidate all production mission execution onto Path A (LoopDriver + Harness v2).**

### Migration Steps (Dependency-Ordered)
1. **Wire `AgentLoop` as the canonical LoopDriver implementation** — Replace `DefaultLoopDriver` with `AgentLoop` (which already implements the canonical Observe→Plan→Act→Verify→Reflect loop with budget/stall detection via `ExecutiveLoop` contract). This eliminates dead code (C) and unifies the loop logic.
2. **Deprecate `ExecutiveBrain.execute()`** — Keep `ExecutiveBrain.plan()` for planning-only use cases. Remove `execute()` which duplicates LoopDriver.
3. **Unify Harness** — Migrate trace/eval to Harness v2. Remove legacy `system.harness` (`TraceRecorder`, `MissionEvaluator`, `ReplayEngine`) or make them adapters over Harness v2.
4. **Update `QuackRuntime.submitGoal()`** — Delegate to LoopDriver instead of `ExecutiveBrain.execute()`. Preserve `submitGoal` API for backward compatibility.
5. **Remove CLI fallback** — All CLI commands use LoopDriver; remove line 541 `submitGoal` fallback.

### Compatibility
- **API unchanged**: `QuackApi.submitMission()` signature stays identical.
- **CLI unchanged**: `quack mission/trace/evaluate/start` behavior preserved.
- **Server unchanged**: `POST /missions` behavior preserved.
- **Tests**: E2E tests already use Path A. Unit tests for `ExecutiveBrain.plan()` remain valid.

## Consequences

### Positive
- Single source of truth for mission execution semantics (budget, stall, progress, verification).
- `AgentLoop` becomes the production loop (matching its documentation).
- Eliminates ~500 lines of duplicate execution logic (`DefaultLoopDriver` + `ExecutiveBrain.execute`).
- Harness v2 becomes the single observability backbone.

### Negative
- `ExecutiveBrain` loses execution capability; becomes planning-only.
- `WorkflowEngine`/`SessionRuntime` no longer used for mission execution (retained for skill/workflow DAGs).
- Migration risk: subtle behavioral differences in retry/recovery must be verified.

### Risk Mitigation
- Run full test suite (1156 tests) after each step.
- E2E scenarios are the regression gate — they already exercise Path A.
- Preserve `ExecutiveBrain.plan()` for skill selection/planning use cases.

## Alternatives Considered

### 1. Consolidate on Path B (ExecutiveBrain + WorkflowEngine)
- **Rejected**: Path A has richer loop control (budget, doom-loop detection, progress detection, event wakeups). Path B's `WorkflowEngine` lacks these.

### 2. Keep both paths, add abstraction layer
- **Rejected**: Adds complexity without removing duplication. Two execution engines = two bug surfaces.

### 3. Consolidate on AgentLoop (Path C) directly
- **Rejected**: `AgentLoop` depends on `MissionManager`, `SkillRegistry`, `CapabilityBroker` — heavier deps. `LoopDriver` interface is lighter and already used by all production entry points. Better to make `AgentLoop` implement `LoopDriver`.

## Implementation Order
1. Implement `AgentLoop` as `LoopDriver` (adapter or direct impl).
2. Replace `DefaultLoopDriver` usage in CLI/API/Server/E2E with `AgentLoop`.
3. Deprecate `ExecutiveBrain.execute()`.
4. Update `QuackRuntime.submitGoal()` → LoopDriver.
5. Remove legacy harness trace/eval; migrate to Harness v2.
6. Remove CLI fallback.
7. Delete `DefaultLoopDriver` and unused `ExecutiveBrain.execute` code.

## Verification
- All 1156 tests pass.
- E2E scenarios pass.
- Manual `quack mission "goal"` produces identical trace/eval output.
- `QuackApi.submitMission()` returns same `MissionStatus` shape.

---

**Classification**: This ADR documents a structural consolidation. No behavior change for external consumers. Internal refactor only.
