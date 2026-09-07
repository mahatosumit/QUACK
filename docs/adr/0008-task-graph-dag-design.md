# ADR 0008: Task Graph DAG Design

Status: Accepted

## Context

The engine needs to represent work as a directed acyclic graph (DAG) to enable parallel execution, dependency resolution, and critical path analysis. The existing `PlanStep[]` array with basic `dependencies` tracking is insufficient because it lacks explicit status management, priority, retry policies, and cost estimation per step.

We need a data model and an execution state machine that supports:

- Nodes with status lifecycle: `pending → ready → running → { completed | failed | skipped | cancelled | retrying | paused }`
- Explicit edges between nodes for dependency resolution
- Priority-based scheduling
- Conditional skip (skip a node if a condition is met)
- Result tracking (success/failure, output, duration, tool calls)
- Critical path analysis for performance optimization

## Decision

### Data Model

```typescript
interface TaskNode {
  id: string;                    // Unique node ID
  description: string;           // Human-readable description
  dependencies: string[];        // IDs of prerequisite nodes
  priority: TaskNodePriority;    // critical | high | medium | low
  estimatedCost: number;         // Estimated execution cost
  estimatedDurationMs: number;   // Estimated execution duration
  requiredTools: string[];       // Tools this node needs
  requiredProviderCapabilities: string[];  // Capabilities needed (tools, streaming, structured_output)
  timeoutMs: number;             // Max execution time before timeout
  retryPolicy: RetryPolicy;      // Retry configuration
  conditionalSkip?: { field: string; equals: string };  // Skip condition
  status: TaskNodeStatus;        // Current execution status
  retryCount: number;            // Current retry attempt
  result?: TaskNodeResult;       // Execution result
  startedAt?: string;            // Start timestamp
  completedAt?: string;          // Completion timestamp
}

interface TaskGraph {
  id: string;                    // Graph ID
  description: string;           // Human-readable description
  nodes: TaskNode[];             // All nodes
  edges: { from: string; to: string }[];  // Directed edges
  createdAt: string;             // Creation timestamp
  updatedAt: string;             // Last update timestamp
  metadata: JsonObject;          // Arbitrary metadata
}
```

### State Machine

Each node follows this state machine:

```
pending → ready (when all dependencies completed/skipped)
ready → running (when scheduler dequeues)
running → completed (on success)
running → failed (on error or timeout)
running → retrying (on transient failure with retries remaining)
retrying → pending (after backoff delay, re-enters scheduling)
running → paused (on external pause)
paused → running (on resume)
running → skipped (on conditional skip match)
running → cancelled (on workflow cancellation)
```

### TaskGraphBuilder

A fluent API for constructing task graphs:

```typescript
const builder = new TaskGraphBuilder({ description: "..." });
builder.addNode("id-1", { description: "...", dependencies: [], priority: "high" });
builder.addNode("id-2", { description: "...", dependencies: ["id-1"], priority: "medium" });
const graph = builder.build();
```

### TaskGraphExecutor

An execution state machine that tracks node statuses and results. Methods:
- `getReadyNodes()` — Returns nodes whose dependencies are all completed/skipped.
- `markRunning/Completed/Failed/Skipped/Retrying/Paused/Pending(nodeId)` — Transitions node status.
- `getProgress()` — Returns completed/failed/running/pending counts.
- `getCriticalPath()` — Returns the longest dependency chain.
- `isComplete()` — Returns true when all terminal states reached.

## Consequences

**Positive:**
- Clean separation between graph construction (builder) and execution state (executor).
- The state machine prevents invalid transitions and makes status observable.
- Critical path analysis enables scheduling optimizations.
- Conditional skip avoids redundant execution.

**Negative:**
- The executor modifies a copy of the graph returned by `getGraph()`, which may be confusing.
- No support for sub-graphs (nested workflows) — each workflow is a single flat DAG.
- No cycle detection at the graph level (left to caller).

## Status

Accepted. Implemented in `src/engine/task-graph.ts`.
