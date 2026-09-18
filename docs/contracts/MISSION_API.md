# QUACK OS — Mission API Contract

The Mission API is the single submission/inspection surface for missions.
HTTP routes are served by `QuackHttpServer` (`src/server/index.ts`); the
in-process facade is `QuackApi` (`src/api/index.ts`). Every surface (CLI,
Studio, Console, SDK) uses this contract — never the runtime internals
directly.

## Transport & security (applies to every route)

- **Binding:** loopback only (`127.0.0.1`/`::1`/`localhost`); the server
  refuses non-loopback binds — remote authentication is not implemented.
- **Auth:** per-instance random 32-byte token (`Authorization: Bearer …` or
  `quack_session` HttpOnly cookie, timing-safe comparison). 401
  `request.unauthorized` without it.
- **CSRF:** non-GET/HEAD with a session cookie requires `X-QUACK-CSRF: 1`.
- **Host check:** non-loopback `Host` headers rejected (403).
- **CSP:** strict content security policy on all responses.

## Existing endpoints (verified against `src/server/index.ts`)

### Submit a mission
- **POST `/missions`** — body `{ goal, actor?, mode?, providerId?, model?,
  safetyMode?, dryRun? }`; returns `202` with a mission record
  (`{ id, state: PENDING|RUNNING|… , … }`). Execution flows
  `QuackApi.submitMission → QuackRuntime.submitGoal`. `dryRun: true`
  validates and completes without executing (honest: record states this).
  **Note:** `mode/providerId/model/safetyMode` are currently accepted but
  dropped before submission (only `goal`+`actor` reach the runtime) — see
  Planned.

### List / inspect
- **GET `/missions`** — mission records list.
- **GET `/missions/{id}`** — record + detail: trace (`TraceRecorder`
  output), evaluation (`MissionEvaluator` output), related task records,
  learning experiences.
- **GET `/missions/{id}/status`** — status only.
- **GET `/missions/{id}/events`** — events for one mission (from trace).
- **GET `/traces/{loopId}`** — full `MissionTrace` (plan steps, tools,
  capability requests, verification, events).
- **GET `/traces?missionId=…`** — traces for one mission
  (`TraceRepository` lookup).

### Mission operations (P1)
- **POST `/missions/{id}/cancel`** — aborts an in-flight mission through
  its run's abort signal → fenced `CANCELLED` transition +
  `mission.cancelled` event. Non-running missions get
  `409 mission.not_cancellable`; unknown ids `404`.
- **POST `/missions/{id}/resume`** — resumes an interrupted mission via
  `QuackApi.resumeMission → QuackRuntime.resumeMission` (durable
  recovery, ownership-fenced). Conflict/reconciliation failures map to
  `409`; unknown ids `404`.
- **GET `/approvals`** — pending approval requests (only when the system
  was started with a queue-backed approver; otherwise
  `404 approval.queue_unavailable` — no queue is fabricated).
- **POST `/approvals/{id}/approve|deny`** — human decision, body
  `{ actor, reason? }`. Decides through the same `ApprovalCallback`
  path (CLI parity); unknown/tampered ids `404 approval.not_pending`;
  expired requests deny `409 approval.expired`.

### Skills / proposals / recipes / providers / system
- **POST `/skills/import`**; **POST `/skills/{id}/enable|disable`**;
  **GET `/skills`** — quarantined lifecycle, unchanged by this contract.
- **GET `/improvement/proposals`**; **POST `/improvement/proposals/{id}/approve|reject`**;
  **GET `/improvement/proposals/{id}`** — improvement loop approvals.
- **GET `/recipes`**; **POST `/recipes/{id}/plan`** — recipe planning.
- **GET `/providers`**; **POST `/providers/test`** — provider health (never
  secrets).
- **POST `/models/stream`** — P4 governed model streaming: body
  `{ prompt, actor, model?, missionId? }`; responds as an SSE stream of
  `model.stream.chunk` events (chunk text redacted at the wire). Every
  call resolves `provider.invoke` through the capability broker; denial
  fails closed with a terminal `denied: true` chunk before any provider
  is contacted.
- **GET `/actions`**, **GET `/mcp`** — action/MCP registries.
- **GET `/system/status`**, **GET `/memory`**, **GET `/agents`**,
  **GET `/health`** — system state.
- **GET `/settings`** / **PATCH `/settings`** — configuration.
- **GET `/events`** — SSE stream (see
  [CLIENT_EVENTS.md](CLIENT_EVENTS.md)).
- **GET `/dashboard*`** — Studio SPA assets/state.

### In-process facade (SDK / CLI / future Console)
`QuackApi.submitMission(input) → MissionStatus` (accepts an optional
`AbortSignal`), `QuackApi.resumeMission(missionId)`, `getTrace(loopId)`,
`getEvaluation(loopId)`; `QuackRuntime.resumeMission`
and abort-signal cancellation are runtime-level operations the CLI already
uses.

### Studio (reference client)
The Studio SPA consumes these endpoints: Mission Control lanes (`GET
/missions`), Mission Detail with cancel/resume (`POST /missions/{id}/cancel|resume`),
Approval Center queue decisions (`GET /approvals`, `POST
/approvals/{id}/approve|deny`), live updates via `GET /events` SSE. UI
decisions never grant capabilities; they only submit human decisions
through the same callback paths.

## Planned operations (NOT implemented — do not represent as existing)

| Operation | Route (proposed) | Runtime path | Phase |
|---|---|---|---|
| Evaluation run | `POST /evaluations` | `QuackNativeHarness` + `MissionEvaluator` | P5 |
| Mission options honored | `POST /missions` full options | runtime goal options | P2 (with Console) |

## Response/error conventions

Errors are typed JSON: `401 request.unauthorized`, `403 request.host_denied`
/ CSRF, `404 request.not_found`. Mission records carry `state`
(`PENDING|RUNNING|COMPLETED|FAILED`), `error?`, `missionId`, `loopId`,
`traceId?`, `iterations`. Receipts (in mission detail via trace/task result)
are digest-bound `CompletionReceiptV1` objects.

## Compatibility

Additive changes only for existing routes. The Studio SPA is the reference
client; any contract change must be updated in the SPA, the CLI, the SDK
docs, and this file in the same PR.
