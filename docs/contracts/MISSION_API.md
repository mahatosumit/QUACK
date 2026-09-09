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

### Skills / proposals / recipes / providers / system
- **POST `/skills/import`**; **POST `/skills/{id}/enable|disable`**;
  **GET `/skills`** — quarantined lifecycle, unchanged by this contract.
- **GET `/improvement/proposals`**; **POST `/improvement/proposals/{id}/approve|reject`**;
  **GET `/improvement/proposals/{id}`** — improvement loop approvals.
- **GET `/recipes`**; **POST `/recipes/{id}/plan`** — recipe planning.
- **GET `/providers`**; **POST `/providers/test`** — provider health (never
  secrets).
- **GET `/actions`**, **GET `/mcp`** — action/MCP registries.
- **GET `/system/status`**, **GET `/memory`**, **GET `/agents`**,
  **GET `/health`** — system state.
- **GET `/settings`** / **PATCH `/settings`** — configuration.
- **GET `/events`** — SSE stream (see
  [CLIENT_EVENTS.md](CLIENT_EVENTS.md)).
- **GET `/dashboard*`** — Studio SPA assets/state.

### In-process facade (SDK / CLI / future Console)
`QuackApi.submitMission(input) → MissionStatus`,
`getTrace(loopId)`, `getEvaluation(loopId)`; `QuackRuntime.resumeMission`
and abort-signal cancellation are runtime-level operations the CLI already
uses.

## Planned operations (NOT implemented — do not represent as existing)

| Operation | Route (proposed) | Runtime path | Phase |
|---|---|---|---|
| Resume mission | `POST /missions/{id}/resume` | `QuackRuntime.resumeMission` (exists at kernel) | P1 |
| Cancel mission | `POST /missions/{id}/cancel` | AbortSignal path → fenced `CANCELLED` transition | P1 |
| Approval queue | `GET /approvals` | `RiskAwareApprovalPolicy` pending queue | P1 |
| Approval decision | `POST /approvals/{id}/approve\|deny` | same `ApprovalCallback` path (CLI parity) | P1 |
| Trace by mission | `GET /traces?missionId=…` (list form) | `TraceRepository` lookup | P1 |
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
