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

### P8.1 — QUACK Instruction Engine (QIE) foundation (SHIPPED 2026-09-10)

Re-scoped first slice of P8 (ADR 0042): before automation can be reliable,
small/cost-efficient models need correctly assembled instructions, context,
and output contracts. QIE is a deterministic instruction/context compiler
(`src/instruction/`) — NOT a model runtime, planner, memory system,
capability broker, or second prompt registry. Ships: InstructionPlan
contract (11 fixed layers, 13 context categories, 8 trust classes),
fail-closed category↔trust validation (untrusted sources cannot claim
authoritative runtime trust), documented trust precedence
(SYSTEM_POLICY > TRUSTED_RUNTIME > USER_INPUT > EVIDENCE > SKILL > MEMORY >
TOOL_OUTPUT > RETRIEVED_CONTEXT), char-based model-agnostic budget with
recorded omissions and fail-closed core overflow, output-contract and
failure-policy representation, deterministic composer with canonical-JSON
digest (key-order-insensitive), PromptRegistry reuse via adapter. P8.2
(context selection), P8.3 (integrations), P8.4 (model wiring) follow.

### P8.2 — Context Selection & Deterministic Assembly (SHIPPED 2026-09-10)

Deterministic selection layer over explicitly supplied candidates (ADR 0042
scope; no new ADR needed — selection was already the documented P8.2
boundary). `src/instruction/selector.ts`: RETRIEVAL PRODUCES CANDIDATES →
SELECTOR SELECTS AND ASSEMBLES → P8.1 COMPOSER VALIDATES AND COMPOSES. The
selector is a pure function — zero retrieval (no memory/filesystem/workspace/
skills/MCP/tools/network/registry reads); every candidate arrives explicitly.
Per-candidate intake with fail-closed eligibility (malformed shape, trust
pairing, evidence status, item-size cap) and structured rejection reasons;
duplicate ids fail the whole selection closed (never silently merged);
deterministic ranking = P8.1 trust precedence + stable id ties (no scores,
no clock, no randomness); the P8.1 composer stays the SINGLE budget authority
(selector reuses its drop decision — no duplicated budget logic, no second
constants table); selection report records selected/trimmed/rejected with
metadata only (no content echo). Byte-for-byte deterministic across
insertion orders.

### P8.3 — PrivacyFirewall Activation (SHIPPED 2026-09-10)

Admission boundary between QUACK governance sources and the P8.2 selector
(`src/instruction/firewall.ts`, ADR 0042 implementation update). The
firewall validates/admits context — it never composes, retrieves,
rewrites content, or manages budget/precedence. Governance lanes keyed on
the P8.1 trust class: SYSTEM_POLICY/TRUSTED_RUNTIME require an authorized
runtime source; SKILL requires lifecycle backing (ADR 0041 admitted
skills); MEMORY requires MemoryPolicy-passed record ids; EVIDENCE requires
a valid status + an existing evidence record; capability-category items may
only declare actually-granted capabilities. Sensitive content (existing
ADR 0041 classifier reused) is rejected with class names only — never
rewritten. Authority views are caller-supplied snapshots (zero I/O).
Admitted candidates flow unchanged into P8.2; rejected candidates never
reach selection. Fail-closed, deterministic, insertion-order independent.
Remaining: P8.4 model adaptation/wiring, P8.5 full injection-defense
enforcement, P8.6–P8.9.

### P8.4 — Governed Model Adaptation (SHIPPED 2026-09-10)

Model adaptation boundary (`src/instruction/model-adapter.ts`, ADR 0042
implementation update; `src/models/*` and `src/providers/*` untouched).
`adaptComposedInstruction` is a pure deterministic translator from the P8.1
ComposedInstruction into the existing provider-neutral ModelRequest: prompt
= byte-identical P8.1 rendered representation; the P8.1 instruction digest,
mission/task identity, plan version, and output-contract kind ride in
request metadata — the digest is preserved verbatim, never regenerated.
`invokeGovernedInstruction` dispatches through the EXISTING
GovernedModelRuntime (ADR 0036) with the full execution context, so
provider.invoke authority resolves before provider contact; no retry, no
ungoverned fallback path, denials/provider errors pass through existing
QuackResult semantics. No provider role mapping was invented — QIE
authority travels inside the rendered instruction ([TRUSTED]/[USER]/[DATA]
labels + fixed layer order). Output contracts are carried honestly (prompt
section + metadata), never claimed as schema enforcement the providers do
not have. No model routing/benchmarking. Remaining: P8.5 injection-defense
enforcement, P8.6 harness scoring, P8.7–P8.9.

### P8.5 — Injection Defense Enforcement (SHIPPED 2026-09-10)

Final pre-dispatch tripwire (`src/instruction/injection-defense.ts`, ADR
0042 implementation update). Structural enforcement before P8.4
adaptation/dispatch: digest correspondence recomputed and verified (any
post-composition mutation fails closed), trust/category pairing,
evidence status, duplicate ids, provenance shape, and render-safe item
ids (ids are the only raw-rendered field — structure-forging ids are
rejected, never rewritten). Fail-closed with structured metadata-safe
`instruction.defense_*` errors; no ungoverned fallback, zero retries.
Heuristic detection (fixed-vocabulary pattern family) runs as
defense-in-depth: metadata-only `injectionFlags` in request metadata —
never rewriting content, never changing trust, never blocking dispatch.
DATA REMAINS DATA: untrusted content cannot acquire instruction
authority by containing instruction-like language. 52 adversarial tests
covering trust immutability, role/delimiter confusion, override and
escalation resistance, capability/policy/memory/evidence/skill/retrieval
injection, digest integrity, provenance integrity, provider and fallback
bypass resistance, determinism, purity, and the full end-to-end
firewall→selector→composer→defense→adapter→governed-runtime flow.
Remaining: P8.6 harness scoring, P8.7 observability, P8.8 Studio/CLI
inspection, P8.9 research/SDK.

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
