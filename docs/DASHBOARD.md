# Dashboard Foundation

The QUACK OS v1.1 dashboard is a lightweight, read-only web UI served by the
Production HTTP API Server.

## Routes

```text
GET /dashboard
GET /dashboard/styles.css
GET /dashboard/app.js
GET /dashboard/state
GET /events
```

The web app loads aggregate state from `/dashboard/state` and subscribes to
`/events` for live Event Bus updates.

## Views

- Mission View: active, completed, failed, and current mission status.
- Agent View: available specialist agents, execution state, and assigned active
  missions inferred from mission goals.
- Skill View: loaded skills, validation status, usage count, and average
  duration.
- Security View: capability requests, allowed/denied decisions, and permission
  failures.
- Harness View: traces, evaluation records, failures, and latency metrics.

## Data Sources

The browser talks only to HTTP endpoints:

- `/dashboard/state`
- `/events`
- Existing API routes such as `/missions`, `/skills`, `/agents`, and `/health`

The server-side dashboard state builder reads from existing observable surfaces:

- API Server mission records
- Event Bus event history
- Persistent Storage traces and evaluations
- Skill and agent registries exposed through the API server composition

The dashboard does not execute tools, mutate missions, approve capabilities, or
control the Agent Loop.

## Live Updates

The dashboard uses Server-Sent Events. When an Event Bus event arrives, the
browser refreshes `/dashboard/state` and re-renders the current filtered view.

## Search

The search box performs client-side filtering across mission, agent, skill,
security, and harness entries. Empty data sets render explicit empty states.

## Security Boundaries

The dashboard is read-only. Capability Broker enforcement, Skill Runtime
sandboxing, Agent Loop lifecycle, Harness trace generation, and Event Bus
emission remain owned by their existing modules.
