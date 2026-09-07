# Production API Server

`src/server/` exposes a production-oriented HTTP layer over the existing QUACK
API facade and system composition. It does not own planning, execution, skill
sandboxing, capability checks, harness tracing, or storage.

## Startup

```ts
import { QuackHttpServer } from "@quack/os";

const server = new QuackHttpServer({
  host: "127.0.0.1",
  port: 8080,
  systemConfig: {
    workspaceRoot: process.cwd(),
    dataDir: ".quack",
  },
});

await server.start();
```

`stop()` closes active event streams and gracefully closes the HTTP listener.

## Endpoints

```text
POST /missions
GET  /missions/:id
GET  /missions/:id/status
GET  /missions/:id/events
GET  /traces/:id
GET  /skills
GET  /agents
GET  /health
GET  /events
GET  /dashboard
GET  /dashboard/state
GET  /improvement/proposals
GET  /improvement/proposals/:id
POST /improvement/proposals/:id/approve
POST /improvement/proposals/:id/reject
GET  /recipes
GET  /recipes/:id
POST /recipes/:id/plan
GET  /providers
POST /providers/test
GET  /memory
GET  /settings
PATCH /settings
```

`POST /missions` accepts:

```json
{
  "goal": "inspect workspace",
  "actor": "api-client",
  "missionId": "optional-existing-mission-id"
}
```

The server returns `202 Accepted` with a server mission run id. Execution
continues asynchronously through `QuackApi.submitMission()`, preserving Agent
Loop lifecycle, Harness trace creation, and Capability Broker enforcement.

Studio may include optional `mode`, `providerId`, `model`, `safetyMode`, and
`dryRun` request metadata. `dryRun: true` validates the request and creates no
agent-loop execution. Provider/model preferences do not bypass the server's
configured provider runtime.

## Studio safety endpoints

`GET /improvement/proposals` and `GET /improvement/proposals/:id` expose only
persisted proposal state. To record a decision, send an explicit external actor
and confirmation:

```json
{ "confirm": true, "actor": "reviewer@example", "reason": "Reviewed evidence." }
```

to either `/improvement/proposals/:id/approve` or `/reject`. Approval records the
existing human decision only; it does not create a worktree, mutate files, or merge.

`POST /providers/test` performs a provider health check only, with a body such as
`{ "providerId": "core.echo-provider" }`. It never sends a generation request and
never returns credentials. `PATCH /settings` only accepts validated improvement
policy fields for the current server process. Attempts to disable self-modification
approval are rejected.

## Events

`GET /events` is a server-sent events stream backed by the existing Event Bus.
Each emitted event is sent as:

```text
id: event_...
event: task.created
data: {...QuackEvent...}
```

The HTTP layer observes Event Bus traffic only. It does not intercept or replace
runtime event emission.

## Errors

Errors use a structured JSON shape:

```json
{
  "error": {
    "code": "mission.invalid_request",
    "message": "Request body must include a non-empty string goal.",
    "status": 400
  }
}
```

Invalid JSON, oversized request bodies, validation failures, missing routes, and
unexpected server failures all use this shape.

## Boundaries

- Mission execution still flows through `QuackApi`, `AgentLoop`, `Planner`,
  `Runtime`, `SkillRuntime`, and `CapabilityBroker`.
- Persistent traces and evaluations remain available through the storage layer.
- Tool execution still requires runtime capability checks.
- The server keeps in-process async mission status for active runs; completed
  traces are also retrievable through persistent trace storage.
