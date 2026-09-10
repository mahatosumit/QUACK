# QUACK OS — Product Surfaces

Canonical surfaces and their relationship to the one runtime. **Clients only**
— no surface executes tools, grants capabilities, or calls providers.

## CLI — *existing, certified*

`src/cli.ts` + `src/cli/commands.ts` (~20 commands: init, doctor, status,
run/start, resume, mission, trace, evaluate, serve, agents, personas, skills,
provider, config, update, uninstall, backup/restore).

Purpose: automation, scripting, power users, diagnostics, mission control.
Path: `createQuackSystem → QuackApi.submitMission → QuackRuntime.submitGoal`.

## Studio — *existing SPA; the QUACK Control Room*

`src/dashboard/web/studio.ts`, served by `QuackHttpServer` at `/dashboard`
(13 hash-routes). Purpose: the canonical graphical shell for the entire
product. **ONE Studio SPA** — extended, never duplicated. All future views
(Mission Control, Console, Agent Workspace, Approval Center, Trace Center)
are additions to this SPA, not separate applications.

## Mission Control — *P2*

Home/workspace view: active, queued, waiting-approval, failed, recently
completed missions + system activity. Data: existing `/missions` endpoints +
SSE `/events` (no new stores).

## Mission Detail — *P2*

Deep inspection: objective, status, plan (workflow nodes), current step,
agent, capabilities, approvals, event timeline, tool activity, evidence,
verification, receipt, artifacts. Data: `GET /missions/{id}` (already returns
trace/evaluation/tasks) + `GET /traces/{id}`.

## QUACK Console — *P3, SHIPPED 2026-09-10 (streamed-model layer is P4)*

Conversational control interface inside the Studio SPA (`#console`).
Conversation composes missions through the Mission API and exposes
their real state progressively over SSE (`mission.*`, `tool.*`), with
reconnect guidance pointing at the durable stores. **The Console is a
client of QUACK Core. It never executes anything itself and never
fabricates streaming** — genuine model stream chunks arrive only when
`GovernedModelRuntime.stream()` is wired (P4).

## Agent Workspace — *P6*

Agent visibility: registry (`src/agents`), roles/specializations, skills,
capabilities, current work, delegation, execution history, evaluation results.
Read-only inspection plus governed management actions.

## Approval Center — *P1 (events/API) → P2 (UI)*

Human authorization interface: pending requests with capability, target,
risk, reason, evidence/context, approve/deny, expiration. Reuses
`RiskAwareApprovalPolicy` + `ApprovalCallback` — **no new permission system**.
The UI requests authorization from the runtime; it can never grant by itself.

## Trace Center — *P7*

Runtime observability: mission timelines, event streams, tool calls, model
calls, capability decisions, failures, recovery, evidence. Data:
`TraceRepository` (sqlite) + live SSE. Trace Center renders real traces; it
does not invent them.

## Artifact Center — *P7*

Affordances around **existing** receipt/evidence/workspace outputs. No second
storage system. An artifact is presented with mission, execution, creator,
timestamp, verification status, and provenance from the receipt/evidence
chain.

## System Health / Settings — *existing*

Studio's system/providers/settings views; CLI `doctor`/`status`/`provider`.
Retained and extended in place.

## SDK — *existing, certified*

`sdk/` `QuackClient` — programmatic access to the same product:
`initialize() → createQuackSystem`, `submitGoal`, registries. SDK parity is
an invariant: anything a surface can do, the SDK can do, through the same
kernel path.

## HTTP API — *existing, certified*

`QuackHttpServer` (`src/server/index.ts`): loopback-only, random per-instance
token (Bearer or `quack_session` cookie, timing-safe compare), CSRF header on
writes, strict CSP, SSE `/events`. Contract: see
[../contracts/MISSION_API.md](../contracts/MISSION_API.md).

## Surface parity rule

Any capability added to one surface (e.g., mission cancel in CLI) must be
added at the kernel/contract layer and exposed to all surfaces, or it is a
parity violation and a review blocker.
