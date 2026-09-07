# ADR 0028: Interrupted-Mission Recovery

## Status
Accepted — 2026-09-05

## Context

ADR 0006 introduced checkpointing, but its store was in-memory and admitted
that "the in-memory checkpoint store does not survive process restarts." ADR
0027 consolidated all public mission execution through
`QuackRuntime → SessionRuntime → DefaultLoopDriver → WorkflowEngine → CapabilityBroker → explicit verification`.
Process death mid-mission previously lost execution identity, could repeat
completed side effects, and had no governed resume entry point.

## Decision

Interrupted-mission recovery is implemented through the existing canonical
runtime. No recovery runtime, resume agent loop, recovery scheduler, or second
checkpoint authority is introduced.

### Durable identities

When a runtime is constructed with a `dataDir`, `QuackRuntime` persists the
task and its `ExecutionIdentity` together before planning begins:

- `missionId` — the mission (defaults to the task id)
- `executionId` — equals the durable task id; one execution per task
- `taskId` — the neutral task record owning the identity
- `sessionId`, `workflowId` — the session and workflow executing the mission
- `actor` (and optional `agentId`/`skillId`) — bound into the identity

Tool invocations are identified by `sha256(executionId, nodeId, index)` with a
per-attempt `attemptId` (`<invocationId>:<attempt>`). No parallel identity
system is created; all identifiers are derived from the task the user started.

### Checkpoint ownership

`SessionRuntime` is the sole owner of canonical execution checkpoints, via
`initializeExecution` / `loadExecution` / `updateExecution`. Mutations are
serialized per execution, deep-cloned across the boundary, and validated by
`assertRecoveryCheckpoint` before load and after every mutation. The durable
store is `JsonFileCheckpointStore`: a `{ version: 1, checkpoints: [...] }`
envelope, atomic replacement, malformed/duplicate/unsupported-version
rejection at load time, and a single-writer queue. A failed write never
corrupts the previous visible state, and rejecting an unsupported version
preserves the original file bytes untouched.

### Recovery state machine

`ExecutionRecovery.status` reuses the canonical mission lifecycle state
machine (`src/runtime/mission-lifecycle/mission-state-machine.ts`):
`STARTING → RUNNING`, `RUNNING → INTERRUPTED`, `INTERRUPTED → RECOVERING`,
`RECOVERING → RUNNING`, plus terminal `SUCCEEDED / FAILED / CANCELLED /
TIMED_OUT` and a `BLOCKED` reconciliation state. All transitions go through
`planMissionTransition`; illegal transitions throw. No new lifecycle state was
invented for recovery beyond what the state machine already defines.

### Side-effect policy

Each durable tool dispatch is journaled as an `InvocationRecord`
(`STARTED → COMPLETED | FAILED`) before and after the call. The runtime records
the tool's effective `retrySafety`; absent metadata becomes `UNKNOWN`:

| Class | Recovery behavior |
| --- | --- |
| `READ_ONLY` | Retryable with a fresh attempt |
| `IDEMPOTENT_WRITE` | Retryable with the same stable `idempotencyKey`, new `attemptId` |
| `NON_IDEMPOTENT_WRITE` | `STARTED`-without-outcome fails closed: execution transitions to `BLOCKED` and requires explicit reconciliation |
| `DESTRUCTIVE` | Same fail-closed treatment as non-idempotent writes |
| `UNKNOWN` (default) | Fail closed |

Retry permission is re-validated at resume time: the recovered safety class
must still match the currently registered tool metadata, so a tool that later
loses its idempotency declaration cannot be replayed from a stale record.
Both `idempotencyKey` and `attemptId` are threaded into the tool execution
context so tools can deduplicate themselves.

### Verification binding

Host-created workflow evidence (`EvidenceRecordV1` citing mission, execution,
task, and workflow state) is persisted in the checkpoint before verification runs. The
stored verification record cites that evidence id, and
`assertRecoveryCheckpoint` rejects checkpoints whose verification is not
bound to the checkpoint's own evidence. A resumed execution reuses its own
durable evidence and, once persisted, its stored verification — evidence from
another execution cannot validate the recovered one.

### Recovery entry point

`QuackRuntime.resumeMission(taskId)`:

1. Rejects concurrent resume of the same execution (`recovery.busy`);
   a single runtime owns each execution at a time.
2. Loads the task and its `ExecutionIdentity`; verifies identity consistency.
3. Loads and validates the durable checkpoint; missing or invalid checkpoints
   fail closed (`recovery.invalid_checkpoint`) without replay. A created task
   interrupted during planning may have no checkpoint; planning can safely run
   again because durable tool dispatch cannot begin until checkpoint creation.
4. Terminal checkpoint states terminate the task without re-execution;
   `BLOCKED` returns `recovery.reconciliation_required`.
5. Ambiguous `STARTED` invocations without a retryable class move the
   execution to `BLOCKED` instead of replaying.
6. Otherwise the execution transitions
   `RUNNING → INTERRUPTED → RECOVERING → RUNNING` and re-enters `runTask`
   with the persisted graph, budget, deadline, node-skill bindings, invocation
   journal, and evidence — i.e., the same `SessionRuntime → DefaultLoopDriver →
   WorkflowEngine → CapabilityBroker → verification` path.

## Supported / unsupported

Supported:

- process kill/restart at any boundary: before a node starts, after a node
  starts, during planning, inside a read-only tool call, after a tool result is
  acknowledged, during verification, and after verification before finalization
- idempotent retry with stable `idempotencyKey` and fresh `attemptId`
- replay-free reuse of acknowledged tool outcomes
- fail-closed reconciliation for ambiguous non-idempotent/destructive effects
- repeated resume of a terminal mission returns its stored result
- malformed or unsupported checkpoint versions reject repeatedly without
  modifying stored bytes
- single-process duplicate-resume prevention

Unsupported:

- multi-process or distributed recovery: the task store and checkpoint store
  serialize within one runtime instance only; two processes sharing one
  `dataDir` must not run recovery concurrently (no cross-process lock exists)
- automatic replay of ambiguous non-idempotent side effects
- resume for runtimes without a `dataDir` (checkpoints are in-memory;
  `resumeMission` fails closed when no durable checkpoint exists)
- the `QuackRuntimeV1.resume(missionId)` contract declaration, which remains
  an unimplemented interface member and is not wired to CLI/API/server/SDK

## Consequences

- Recovery correctness reduces to checkpoint integrity plus the invocation
  journal; both are validated on every load and mutation.
- Tools that fail to declare `retrySafety` degrade safely to `UNKNOWN`.
- The old in-memory `CheckpointStore`/`CheckpointManager` path remains for
  non-durable sessions and undo/redo snapshots; it is not a recovery path.
- `SessionRuntime.pauseWorkflow`/`resumeWorkflow` and
  `DefaultLoopDriver.pause/resume` remain in-memory cooperative pause only;
  they are not crash recovery and are not documented as such.

## Verification

- `src/runtime/interrupted-recovery.test.ts`: real child-process `SIGKILL`
  crashes at seven boundaries (`planning`, `planned`, `node-started`, `tool-entered`,
  `acknowledged`, `verifying`, `finalizing`), each resumed by a fresh runtime,
  asserting exact tool-call and verification counts, stable idempotency keys,
  fresh attempt ids, and idempotent re-resume. Additional cases cover all
  fail-closed retry classes, retry-safe acknowledged failures, metadata and
  capability revalidation, foreign evidence and receipts, failed/cancelled/
  timed-out terminal reopening, missing persisted budget fields, unsupported
  checkpoint versions, the required `dataDir` contract, and single-process
  duplicate ownership (`recovery.busy`).
- `src/runtime/mission-lifecycle/mission-state-machine.test.ts`: exhaustive
  legal/illegal transition coverage.
