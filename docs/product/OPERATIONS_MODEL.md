# QUACK OS — Operations Model

P7 reference for the operational layer. Every claim is backed by
implementation and tests.

## What Operations is

A coherent view over EXISTING operational sources — no second backend:

| Area | Source | Studio surface |
|---|---|---|
| Runtime health | `GET /health`, `/system/status` | Overview + System |
| Providers | `GET /providers` (+ certified health checks) | Models |
| Actions | action ledger via `/actions` | Actions |
| Skills | skill registry via `/dashboard/state`, `/memory` | Evidence |
| MCP | `GET /mcp` | Integrations |
| Memory | `GET /memory` | Evidence |
| Traces | `TraceRepository` | Trace Center |
| Audit | `AuditLog` via `GET /audit` | Audit |
| Backup/restore | CLI `backup`/`restore` | CLI (not a GUI concern) |

## Health states

Only real checks produce health badges: HEALTHY / DEGRADED /
UNAVAILABLE / NEEDS_SETUP / UNKNOWN. "Probably working" green is
prohibited; unknown stays visually distinct from healthy.

## Provider status

`GET /providers` returns configured state, reachability, and model
metadata. API keys and credential contents never cross the boundary.
The browser never issues provider requests directly — provider
inspection (and the optional health test) is server-side behind the
session boundary.

## Canonical surface consolidation (P7)

Retired: DesktopServer (`src/desktop/`), the `gui/` SPA,
`desktop-app.ts`, and the legacy `dashboardHtml()` — one HTTP surface
(`QuackHttpServer`), one GUI (QUACK Studio). Fake benchmark/
evaluation endpoints (hard-coded 100% completion, qualityScore 100)
were deleted with the duplicate surface; evaluation truth now comes
from the real `MissionEvaluator` history only.
