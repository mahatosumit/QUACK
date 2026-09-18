# QUACK API Reference

**Version:** 1.0.0
**Updated:** 2026-09-10 (P7 — duplicate desktop surface retired)

QUACK exposes ONE canonical local HTTP surface: `QuackHttpServer`
(`src/server/index.ts`), started with `quack serve`. It serves the QUACK
Studio (the one GUI) at `/dashboard` and the Mission API on loopback with
per-instance session authentication (Bearer or `quack_session` cookie,
timing-safe compare), CSRF on writes, strict CSP, and default-deny
outbound network. Contract details: [contracts/MISSION_API.md](contracts/MISSION_API.md).

The legacy DesktopServer (`:3157/api/*`, `gui/` SPA, `desktop-app.js`)
was RETIRED in P7. It duplicated the HTTP surface and shipped
hard-coded fake benchmark/evaluation numbers, violating the
evidence-first product principle.

## Canonical REST API (QuackHttpServer)

### Health / system
- `GET /health` — server health summary
- `GET /system/status` — setup, safety posture, action ledger counts

### Missions (P0–P2)
- `POST /missions` — submit `{ goal, actor, mode?, providerId?, model?, safetyMode?, dryRun? }`
- `GET /missions` — mission records
- `GET /missions/{id}` — record + trace/evaluation/task detail
- `GET /missions/{id}/status` · `GET /missions/{id}/events`
- `POST /missions/{id}/cancel` · `POST /missions/{id}/resume`

### Traces (P1/P7)
- `GET /traces/{loopId}` — full `MissionTrace`
- `GET /traces?missionId=…` — traces for one mission

### Approvals (P1)
- `GET /approvals` · `POST /approvals/{id}/approve|deny` — queue-backed
  human decisions (fail closed when no queued approver is configured)

### Models (P4)
- `POST /models/stream` — governed model streaming (broker-gated per
  call; denial fails closed before provider contact; SSE chunks)

### Governance / observability (P7)
- `GET /audit?limit=` — security/governance record (distinct from
  traces; payloads redacted at the boundary)
- `GET /dashboard/state` — Studio state: missions, agents, skills,
  security events, traces, evaluations

### Providers / actions / integrations
- `GET /providers` · `POST /providers/test`
- `GET /actions` · `GET /mcp` · `GET /memory` · `GET /settings` (PATCH to update)
- `GET /agents` · `GET /improvement/proposals` (+ decide)

## Architecture components

| Component | Module | Role |
| --- | --- | --- |
| QuackHttpServer | @quack/os | The one canonical local HTTP API + Studio host |
| QuackRuntime | @quack/os | Mission execution kernel |
| GovernedModelRuntime | @quack/os | Broker-gated model dispatch (generate/stream) |
| TraceRepository | @quack/os | Durable mission traces (sqlite) |
| MissionEvaluator | @quack/os | Trace-derived evaluation + dimensions |
| AuditLog | @quack/os | Security/governance record (jsonl) |
