# ADR 0009: Scheduler & Recovery Strategy

Status: Accepted

## Context

The Workflow Engine requires two critical sub-systems: a **Scheduler** that manages concurrency and prioritization, and a **Recovery Engine** that handles failures with appropriate backoff and escalation strategies.

These must work together to enforce resource limits, maximize throughput, and ensure robustness.

## Decision

### Scheduler Design

The `ExecutionScheduler` manages a priority queue and enforces a configurable parallel execution limit.

```
incoming nodes → priority sort → queue → dequeue (up to maxParallel) → running set
```

Key behaviors:
- **Priority sorting**: Nodes are sorted by priority (`critical > high > medium > low`) on enqueue. Within the same priority, insertion order is preserved (stable sort).
- **Parallel limit**: `maxParallelNodes` configures the maximum number of concurrently executing nodes.
- **Throughput tracking**: Stats track average wait time, average execution time, and 60-second throughput window.
- **Backpressure**: `canAccept()` and `isFull()` signals allow the workflow engine to know when to stop scheduling.

Config:
```typescript
interface SchedulerConfig {
  maxParallelNodes: number;        // Max concurrent node executions
  defaultTimeoutMs: number;        // Default timeout for nodes without explicit timeout
  queuePollIntervalMs: number;     // Polling interval for the workflow engine loop
}
```

### Recovery Strategy

The `RecoveryEngine` handles failures through a multi-strategy approach:

#### Failure Classification

Failures are classified into three categories:

| Category | Examples | Action |
|----------|----------|--------|
| **transient** | timeout, rate limit, network error, busy | Retry with backoff |
| **permanent** | permission denied, not found, syntax error | Escalate immediately |
| **unknown** | Unclassified errors | Treat as transient |

#### Backoff Strategies

| Strategy | Formula | Use Case |
|----------|---------|----------|
| **fixed** | `baseDelayMs` | Deterministic retry interval |
| **linear** | `baseDelayMs × (attempt + 1)` | Predictable increasing delay |
| **exponential** | `min(baseDelayMs × 2^attempt, maxDelayMs)` | Aggressive backoff for rate limits |
| **jitter** | `random(exp/2, exp)` | Spread retries across time |

#### Recovery Actions

| Action | When | Behavior |
|--------|------|----------|
| `retry` | Transient failure, retries remaining | Wait backoff delay, re-enter scheduling |
| `retry_different_tool` | Tool-specific failure | Try alternative tool |
| `retry_different_provider` | Provider-specific failure | Try alternative provider (future) |
| `rollback` | Partial failure in dependent workflow | Undo completed nodes |
| `skip` | Non-critical node | Mark as skipped, continue |
| `escalate` | Permanent failure or max retries | Halt workflow, notify |
| `abort` | Catastrophic failure | Halt all execution |

#### Integration with Workflow Engine

The workflow engine calls `RecoveryEngine.buildRecoveryPlan()` after each node failure. It:
1. Checks if the failure is permanent → escalate
2. Checks if retries are exhausted → escalate
3. Checks if a different tool should be tried → retry_different_tool
4. Otherwise → retry with computed backoff

The engine then pauses the failed node (for retry duration) and re-enters it into scheduling as `pending`.

## Consequences

**Positive:**
- Scheduler enforces resource limits and prevents runaway parallelism.
- Recovery handles real-world failure modes (timeouts, rate limits, permission errors).
- Backoff strategies protect external services from retry storms.
- All strategies are configurable and observable.

**Negative:**
- No preemption — a high-priority node cannot interrupt a running low-priority node.
- No gang scheduling — nodes that should run together are not coordinated.
- Recovery retry is purely time-based; no adaptive backoff based on system load.
- Retry with different provider is declared but not yet wired through the engine.

## Status

Accepted. Scheduler implemented in `src/engine/scheduler.ts`. Recovery implemented in `src/engine/recovery-engine.ts`.
