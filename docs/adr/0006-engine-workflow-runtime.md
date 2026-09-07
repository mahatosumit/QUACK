# ADR 0006: Engine Workflow Runtime

Status: Accepted

## Context

Phase 2.5 introduced the Semantic Intelligence Layer, giving the ExecutiveBrain structured workspace understanding. However, the Brain remained a monolithic orchestrator that managed planning, execution, and reflection in one class with sequential step logic. This approach has several limitations:

- **No parallel execution**: Steps run sequentially, missing parallelism opportunities.
- **No DAG dependency resolution**: Steps are a flat array with basic dependency tracking.
- **No pause/resume/cancel**: Long-running workflows cannot be interrupted.
- **No checkpointing**: Workflow state is lost on crash or restart.
- **No reflection loop**: Execution runs to completion without mid-workflow reflection.
- **No recovery strategies**: Failures cause the entire workflow to fail.
- **Tight coupling**: ExecutiveBrain is tightly coupled to step execution logic.

A new generic workflow runtime is needed to decouple orchestration from execution, enable DAG-based task graphs, and support production features like pause/resume/checkpointing/recovery.

## Decision

Create a standalone **Engine module** (`src/engine/`) that provides a generic workflow runtime. The runtime is composed of 10 subsystems:

### Subsystems

1. **Task Graph (DAG)**: `TaskGraph`, `TaskNode`, `TaskNodeStatus`, `TaskNodePriority`, `TaskGraphBuilder` (fluent API), `TaskGraphExecutor` (state machine)
2. **Planner**: Goal decomposition into a 7-phase pipeline (analyze → context → plan → execute → validate → test → verify), risk estimation, cost estimation, permission identification
3. **Workflow Engine**: Start/pause/resume/cancel workflows, node-level timeout enforcement, automatic checkpointing, event-driven reflection and recovery loops
4. **Scheduler**: Priority queue management, parallel execution enforcement, throughput tracking, stats collection
5. **Reflection Engine**: Post-execution analysis, retry/escalation decisions, alternative strategy generation, confidence scoring, memory update extraction
6. **Recovery Engine**: Backoff strategies (fixed/linear/exponential/jitter), failure classification (transient/permanent/unknown), recovery plan generation (retry/different tool/escalate)
7. **Checkpoint System**: Save/load/list/delete/prune checkpoints, automatic periodic checkpointing during workflow execution
8. **Execution Journal**: Append-only event store, query/replay/stats, typed entry system
9. **Cost & Provider Optimizer**: Provider capability profiles, policy-based routing (cost_first/fastest_first/capability_first/local_first/balanced), cost estimation
10. **Session Runtime**: Session lifecycle management, workflow scoping, snapshot/undo/redo, engine lifecycle coordination

### Architecture

```
Engine (src/engine/)
├── types.ts              — Core types (Task Graph, Planner, Workflow, Scheduler, Reflection, Recovery, Checkpoint, Journal, Cost/Provider, Session)
├── planner.ts            — Goal decomposition → DAG
├── task-graph.ts         — Builder + Executor (state machine)
├── workflow-engine.ts    — Start/pause/resume/cancel loops
├── scheduler.ts          — Priority queue + parallel execution
├── reflection-engine.ts  — Post-execution analysis
├── recovery-engine.ts    — Backoff + failure classification + recovery plans
├── checkpoint-system.ts  — Checkpoint persistence
├── execution-journal.ts  — Append-only event store
├── cost-optimizer.ts     — Provider capability routing
├── session-runtime.ts    — Session lifecycle + undo/redo
└── index.ts              — Facade exports
```

### Event Integration

Each subsystem emits events through the EventBus. New event types span workflow lifecycle (`workflow.*`), node lifecycle (`node.*`), reflection (`reflect.*`), recovery (`recovery.*`), checkpoint (`checkpoint.*`), session (`session.*`), and journal events.

## Consequences

**Positive:**
- ExecutiveBrain is decoupled from execution logic and becomes a thin orchestration layer.
- Workflows can run in parallel with DAG dependency resolution.
- Workflows can be paused, resumed, cancelled, checkpointed, and recovered.
- The engine is provider-independent and reusable for future agent types (Coding, Research, Robotics).
- The scheduler enforces backpressure and resource limits.
- The cost optimizer enables intelligent provider selection.
- All 80 existing tests remain green; 46 new tests cover engine modules.

**Negative:**
- Additional abstraction layer increases system complexity.
- Session Runtime is in-memory only; file-based persistence is deferred.
- Workflow Engine simulation mode (for testing) is not yet implemented.
- The in-memory checkpoint store does not survive process restarts.

## Status

Accepted. Implementation in progress as Phase 2.8.
