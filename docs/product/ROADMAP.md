# QUACK OS — Product Roadmap

Phased product evolution on top of the certified kernel. Phases land in
order; each keeps `main` releasable and passes the full gate suite (typecheck,
lint, build, SDK, full tests, public-release, packaging) before merge.

## P0 — Product Foundation (this phase)

Product constitution: definition, principles/invariants, mission model,
surfaces, event + API contracts, differentiation, originality, roadmap,
quality bar. Documentation-only; every claim verified against source.

## P1 — Mission Operations

- `approval.requested` / `approval.decided` events (extend EventBus types +
  `RiskAwareApprovalPolicy` emission)
- pending approval queue + decide endpoints (CLI parity, same callback path)
- mission cancel endpoint (abort-signal path) + `mission.cancelled` event
- mission resume endpoint (`QuackRuntime.resumeMission`)
- trace-by-mission lookup
- client event contract implementation details + SSE redaction test
- adversarial tests: forged mission/execution IDs, forged events, forged
  receipts, cross-session access, UI-bypass attempts → all FAIL CLOSED
- **Affected:** `src/security/approval-controller.ts`, `src/events/event-bus.ts`,
  `src/server/index.ts`, `src/api/index.ts`, `src/runtime/runtime.ts` (event
  emission only), tests. **Risk:** low (additive).

## P2 — Mission Control (Studio)

- Mission Control home: live lanes (active/queued/waiting-approval/failed/
  recently completed) from `/missions` + SSE
- Mission Detail: plan, current step, capabilities, event timeline, tool
  activity, evidence, verification, receipt
- Approval Center panel (consumes P1 endpoints)
- cancel/resume buttons
- **Affected:** `src/dashboard/web/studio.ts` (+ server tests). **Reuses:**
  SPA shell, existing endpoints, SSE. **New:** view code only. **Risk:**
  low-medium.

## P3 — QUACK Console

- Console view in the Studio SPA: conversation panel + mission stream
- mission creation/inspection/continuation from conversation
- live mission events via SSE (unified client event contract)
- reconnect guidance + trace backfill
- **Reuses:** Mission API, SSE, memory (session scope), capabilities.
  **Boundary:** Console never executes; no fabricated streaming. **Risk:**
  medium.

## P4 — Intelligence / Governed Model Streaming

- make `ModelRuntime.stream()` reachable through `GovernedModelRuntime.stream`
  (broker-gated per call, chunk redaction)
- SSE `model.stream.chunk` passthrough for Console
- context management: mission context vs session context
- model comparison groundwork (feeds P5)
- **Affected:** `src/models/governed-runtime.ts`, server SSE, Console.
  **Risk:** medium (security-sensitive: chunk redaction tests required).

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
