# Workflow SDK Documentation

The QUACK `WorkflowEngine` implements directed acyclic graph (DAG) task execution with checkpoint components. Checkpoint persistence does not by itself provide process-restart recovery.

## Defining a Workflow

Workflows consist of `TaskNode` elements connected via a `TaskGraph`.

```typescript
export interface TaskNode {
  readonly id: string;
  readonly dependencies: readonly string[]; // IDs of tasks that must complete first
  readonly timeoutMs: number;
  readonly retryPolicy: RetryPolicy;
  readonly requiredTools: readonly string[];
}
```

## Checkpointing
The engine can persist workflow snapshots through its configured checkpoint store. No automatic workflow-node resume after process death is established by the current production entry points. A stored snapshot is not proof that interrupted effects have been reconciled. Native harness checkpoint/resume is separately unsupported.

## Metrics & Observability
Every node execution records telemetry (time, cost, tokens, tool usage) to the `JsonFileJournalStore`. You can query this via `engine.getJournal()`.
