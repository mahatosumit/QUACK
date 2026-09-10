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

## P5 — QUACK Harness Expansion

- scenario pack v2 (~15 scenarios): reasoning, tool selection, allowed/denied
  capability, malformed tool request, prompt-injection resistance, secret
  redaction, network denial, multi-step, recovery, forged identity
- agent evaluation dimensions: capability discipline, recovery, planning,
  evidence quality
- runtime evaluation: recovery/replay/determinism/event + receipt integrity
- model-vs-model over governed providers → existing sqlite evaluation history
- evaluation history views in Studio
- **Affected:** `src/harness/scenarios.ts`, `evaluator.ts`, Studio views.
  **Risk:** medium.

## P6 — Agent Workspace

- agent registry/roles/capabilities/current work/history/evaluation results
- **Affected:** Studio view over `src/agents` + `/agents`. **Risk:** low.

## P7 — Trace / Artifact / Operations Experience

- Trace Center (render `TraceRepository` timelines)
- Artifact affordances (receipt/evidence/workspace outputs only — no new store)
- RETIRE `src/desktop/server.ts` (verify no consumers first; merge any needed
  read-only routes into QuackHttpServer) and legacy
  `dashboard/web/index.ts` `dashboardHtml()`
- remove fake benchmark/evaluation endpoints with the retirement
- **Risk:** medium (deletion — full regression after).

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
