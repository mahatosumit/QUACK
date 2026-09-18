# QUACK OS — Client Event Contract

The runtime `EventBus` (`src/events/event-bus.ts`) defines ~100 event types.
This contract selects the **client-facing subset** — the events surfaces
(Studio, Console, SDK tooling) may rely on and render. It is a *projection* of
the one bus (Principle 3); SSE (`GET /events`) is currently the only
client-facing transport, and it already carries the full envelope below.

## Envelope (existing, stable)

```json
{
  "id": "event_…",            // unique, monotonic per process
  "type": "mission.started",  // QuackEventType union member
  "timestamp": "2026-09-09T…Z",
  "taskId": "task_…",         // optional
  "actor": "user",           // default "runtime"
  "payload": { … }
}
```

## Client-facing groups (types that exist today)

### MISSION
`task.created`, `task.planned`, `task.started`, `task.completed`,
`task.failed`, `mission.started`, `mission.resumed`, `mission.completed`,
`mission.failed`, `mission.cancelled`, `mission.recovery_started`,
`mission.recovery_completed`

### NODE / WORKFLOW
`workflow.created`, `workflow.started`, `workflow.completed`,
`workflow.failed`, `workflow.paused`, `workflow.resumed`,
`workflow.cancelled`, `node.created`, `node.ready`, `node.started`,
`node.completed`, `node.failed`, `node.skipped`, `node.retrying`, `node.paused`

### CAPABILITY
`capability.requested`, `capability.checked`, `capability.allowed`,
`capability.denied`, `capability.decided`, `permission.requested`,
`permission.decided`

### TOOL / ACTION
`tool.requested`, `tool.completed`

### MODEL / PROVIDER
`provider.requested`, `provider.completed`

### MODEL STREAM (P4 governed streaming)
`model.stream.chunk`

Genuine governed model stream chunks from `POST /models/stream`
(`GovernedModelRuntime.stream`, broker-gated per call). Chunk text is
redacted at the wire boundary. Denial fails closed before any provider
is contacted (terminal chunk carries `denied: true`).

### EVIDENCE / VERIFICATION / RECEIPT
Evidence and verification surface inside the trace/receipt objects
(`trace.created`; receipt in `task.result.receipt`) rather than as granular
events today.

### APPROVAL (P1 Approval Center)
`approval.requested`, `approval.decided`

Emitted only when the system was started with a queue-backed approver
(`QueuedApprovalCallback`). Expired requests resolve as denied; decisions
arrive through the Mission API.

### RECOVERY / OWNERSHIP
`recovery.started`, `recovery.completed`, `checkpoint.created`,
`checkpoint.restored`, `journal.written`, `ownership.acquired`,
`ownership.rejected`, `ownership.heartbeat`, `ownership.lost`,
`ownership.released`

### EVALUATION / HARNESS
`evaluation.started`, `evaluation.completed`, `trace.created`,
`harness.execution.completed`, `harness.authorization`

### SESSION / SYSTEM
`session.created`, `session.ended`, `session.paused`, `session.resumed`,
`skill.*` (lifecycle events — skills views), `loop.started`,
`loop.iteration`, `loop.completed`, `loop.failed`

## Internal-only (do NOT build product UI against these)

`loop.wake.*` (13 internal wake reasons — loop-internal), `skill.compile.*`
(compiler internals), `code.*` (self-modification pipeline),
`improvement.*`, `experiment.*`, `proposal.*` (improvement loop internals —
surfaces read their stores, not these events), `memory.written` (internal;
memory views read the store), `reflect.*`.

## Semantics and guarantees

- **Redaction:** every event crossing SSE is redacted with `redactSecrets`;
  payloads never carry credentials (verified by redaction tests). Client
  contract additions must preserve this.
- **Authentication:** SSE requires the same session as all API routes
  (Bearer token or `quack_session` cookie; loopback-only server).
- **Ordering:** events are ordered per-process; cross-process ordering comes
  from timestamps and the durable audit log. There is **no replay/resume
  guarantee on the SSE stream today** — clients that need history read the
  trace/task stores. **Planned (P3):** reconnect guidance + trace backfill
  on reconnect.
- **Payload stability:** existing payload shapes are stable; additive changes
  only. Breaking changes to a client-facing payload require a contract
  version note in this file.
- **Compatibility:** new event types may be added; clients must ignore
  unknown types.

## Future events (explicitly NOT implemented today)

None currently. (Clients must still ignore unknown event types.)

Do not document or render these as existing until the emitting code ships.
