# QUACK OS — Product Roadmap

Phased product evolution on top of the certified kernel. Phases land in
order; each keeps `main` releasable and passes the full gate suite (typecheck,
lint, build, SDK, full tests, public-release, packaging) before merge.

## P0 — Product Foundation (this phase)

Product constitution: definition, principles/invariants, mission model,
surfaces, event + API contracts, differentiation, originality, roadmap,
quality bar. Documentation-only; every claim verified against source.

## P1 — Mission Operations (SHIPPED 2026-09-10)

Approval queue (`approval.requested`/`approval.decided`, deny-on-expiry,
fail-closed surfaces), mission cancel/resume endpoints, trace-by-mission,
SSE payload redaction, contract truthfulness guards. Verified: 1,522+17.

## P2 — Mission Control (Studio) (SHIPPED 2026-09-10)

Mission Control lanes (active/queued, waiting-approval, failed, recent),
Mission Detail with capabilities/verification/evidence/timeline +
cancel/resume buttons, Approval Center queue panel over the P1 endpoints
(explicit decisions only), live SSE updates with debounced refresh +
pending-approval nav count. Browser E2E (a11y + console-error gates)
covers the new surfaces.

## P3 — QUACK Console (SHIPPED 2026-09-10)

Console view inside the Studio SPA (`#console`): conversation panel +
mission composer (`POST /missions`), live mission stream via SSE
(`mission.*`/`tool.*` events feed the conversation), reconnect guidance
pointing at durable stores. Console never executes; no fabricated
streaming (model chunks remain P4). E2E covers the console flow.

## P4 — Intelligence / Governed Model Streaming (SHIPPED 2026-09-10)

`POST /models/stream` — governed streaming through
`GovernedModelRuntime.stream` (broker-gated per call; denial fails closed
before provider contact). `model.stream.chunk` event type + SSE
passthrough so any `/events` client sees the same stream. Chunk text
redacted at the wire boundary (server route + bus broadcast). Console
"Ask model" consumes the governed stream and renders governed-model
turns; honest rejection/denial/empty states. Redaction + fail-closed +
400 validation covered by `src/server/model-stream.test.ts`.

Context management deepening (mission vs session context) and
model-comparison groundwork land with P5 harness expansion.

## P5 — QUACK Harness Expansion (SHIPPED 2026-09-10)

Scenario pack v2: 15 scenarios across 7 families (reasoning,
tool-selection, capability allowed/denied, malformed tool request,
prompt-injection resistance, secret-redaction resistance, network
denial, multi-step, recovery after denial, forged identity, evidence
chain). Adversarial scenarios pass only when the runtime fails closed —
their payloads are declared expectations, never actionable data.

Agent evaluation dimensions: `MissionEvaluator` now scores capability
discipline, recovery, planning, and evidence quality (0–100 each) from
the durable trace alone; new metrics `recoveredDenials` and
`evidenceCoverage`. Studio Evidence view renders the stored evaluation
history (score + dimension badges) from the existing
`/dashboard/state` — no new endpoint.

Model-vs-model comparison lands when live governed providers are
configured (needs real inference; not fabricated on echo fixtures).

## P6 — Agent Workspace (SHIPPED 2026-09-10)

Studio Agents view is now the Agent Workspace: registry table (identity,
trust level, capabilities, skills, specialization) joined with
assignment state (`buildDashboardState` derivation), plus agent-quality
summary cards averaged from stored evaluation dimensions. Honest
labeling retained: registry state, never a live-execution claim. View
code only — `/agents` + `/dashboard/state` endpoints unchanged.

## P7 — Trace Center + Operations + Surface Consolidation (SHIPPED 2026-09-10)

Trace Center inside the Studio SPA (`#traces`/`#trace/{id}`): trace
index + per-mission execution timeline (real TraceRepository events
only, deterministic type/text filters), capabilities, tool activity,
verification, evidence chain, receipt sections; Mission Detail gains
"View Trace". Artifact View (`#artifacts`): evidence-backed tool
outputs only — no second store. Audit Center (`#audit`, `GET /audit`):
the governance record, distinct from traces, payloads redacted at the
boundary. Retirement: duplicate DesktopServer + `gui/` SPA +
`desktop-app.ts` + legacy `dashboardHtml()` deleted (one HTTP surface:
QuackHttpServer; one GUI: Studio); fake `/api/benchmarks` +
`/api/evaluation` hard-coded numbers removed with it. Adversarial
coverage: unauthorized audit (401), forged/traversal trace ids
(fail-closed 404), audit payload redaction, limit clamping.

## P8 — Automation

- trigger → condition → mission template → governed execution → verification →
  notification/receipt
- triggers: scheduled, filesystem, webhook, repository event, monitoring
- automation submits missions via the Mission API; **never** a second
  scheduler (ExecutionScheduler remains the only executor)
- **Risk:** high (governance surface) — design review required before code.

## P9 — Semantic Memory / Knowledge

- embeddings **through GovernedModelRuntime only** (they are provider calls)
- retrieval upgrades over the existing scope model; knowledge-source
  permissions; explicit user-approved persistence
- **Risk:** medium (privacy boundary).

## P10 — Ecosystem / Marketplace

- skill/MCP discovery UX, package management, templates — over the existing
  quarantine-first lifecycle. **Risk:** medium.

## Dependencies

P1 → P2 → P3 → P4 → P5 (Console and streaming enable harness eval UX);
P6/P7 depend on P2; P8+ depend on mission abstraction stability (post-v1.0).
RC path: P0+P1 are RC-compatible (small, additive); P2–P5 target v1.0;
P8+ are v1.1+.
