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

### P8.6 — Harness Instruction Scoring (SHIPPED 2026-09-11)

Instruction-layer evaluation extending the existing harness evaluator —
no second evaluator (`src/instruction/records.ts` +
`src/instruction/evaluator.ts`, ADR 0042 implementation update).
`GovernedInstructionRecord` is the durable METADATA-ONLY account of one
governed dispatch: digest, mission/task identity, layer/trust census,
budget facts, outcome, injection flags — never item data, never prompt
text. Records attach additively to the existing `MissionTrace` (traces
persist as full JSON payloads — no schema migration); tampered/forged
records fail closed at `parseInstructionRecord` (unknown outcomes,
non-sha256 digests, census/flag mismatches rejected). Harness metrics
gain `instructionDispatch/Dispatched/Rejected/InjectionFlag` counts;
`MissionEvaluator` scores three P8.6 dimensions (instructionIntegrity,
contextProvenance, budgetDiscipline) from records alone and surfaces
rejected dispatches as `instruction.rejected` evaluation failures.
Missions without QIE dispatch keep the exact legacy contract (dimensions
absent, never fabricated). 18 adversarial tests covering content-leak
resistance, forged-identity rejection, determinism, and the
compose→defense→adapt→record→evaluate pipeline. Remaining: P8.7
observability, P8.8 Studio/CLI inspection, P8.9 research/SDK.

### P8.7 — Instruction Observability (SHIPPED 2026-09-11)

`src/instruction/observer.ts` + dispatch-seam wiring (ADR 0042
implementation update). NO second event system: `instruction.dispatched`
/ `instruction.rejected` join the existing `QuackEventType` union and
flow on the existing EventBus, so SSE `/events` clients and dashboards
see instruction telemetry without new transport. Payloads are
metadata-only (identity, digest, outcome, counts) — never item data,
prompt text, or matched injection content. `InstructionObserver` builds
the P8.6 record at the dispatch seam (`invokeGovernedInstruction` optional
observer), retains a bounded recent window, and never changes the
dispatch decision (results identical with/without observer; observer or
sink failures never break dispatch). Dashboard state aggregates
`harness.instruction` counts from trace-attached records. 12 tests
including SSE bus-passthrough, throwing-sink robustness, and
content-leak resistance. Remaining: P8.8 Studio/CLI inspection, P8.9
research/SDK.

### P8.8 — Studio/CLI Instruction Inspection (SHIPPED 2026-09-11)

Inspection surfaces over P8.6/P8.7 metadata — no new routes, endpoints,
or stores (ADR 0042 implementation update). Studio Trace Detail renders
`trace.instruction` records in a "Governed instructions" panel (digest
prefix, outcome, census, budget/flag counts; honest empty state; explicit
never-content labeling); the Evidence view renders the P8.7
`harness.instruction` telemetry aggregate and instruction (I) dimension
badges; live SSE refresh covers `instruction.dispatched/rejected`. CLI
gains `quack instructions [--mission <id>]` over the existing trace
repository: records pass fail-closed parsing before rendering —
tampered records are excluded and counted, never shown as trustworthy.
`--json` machine output; `docs/cli/CLI.md` documents the command. 8
tests (studio contract + CLI behavior incl. tamper exclusion, mission
filtering). Remaining: P8.9 research/SDK.

### P8.9 — Research/SDK Surface (SHIPPED 2026-09-11)

Final P8 phase (ADR 0042 implementation update): the QIE contract
becomes a public export surface. `src/index.ts` (`@quack/os` root)
re-exports the full `src/instruction` surface — contract constants,
validation, deterministic composition, selection, firewall, governed
adaptation/dispatch, injection defense, records/scoring, observer —
with no model runtime, planner, memory, or authority exports (QIE
stays a compiler; the dispatch seam takes a caller-supplied governed
runtime). `@quack/sdk` re-exports functions + types;
`sdk/README.md` documents the surface;
`docs/research/INSTRUCTION_ENGINE_RESEARCH_SURFACE.md` (packaged) defines
the research integration pattern: deterministic compose→defense→adapt→
dispatch→score loops, digest-based replay verification, and
metadata-only scoring so research datasets never ship prompt text.
+2 SDK contract tests (exported-surface coverage, end-to-end
determinism incl. tamper rejection through the package path).

**P8 (QIE) is COMPLETE: P8.1–P8.9 all shipped.**

## P9 — Semantic Memory / Knowledge (SHIPPED 2026-09-11)

Governed semantic memory/knowledge (ADR 0043): MEMORY IS DATA, NOT AUTHORITY.
One pipeline — SOURCE → ADMISSION (fail-closed: shape/scope/owner/
provenance/bounds/duplicates/sensitive-content via the ADR 0041 classifier)
→ CANONICAL RECORD (sha256 content hash, fail-closed parse; tampered files
load excluded, never coerced) → EXPLICIT PERSISTENCE (authorized actor only;
a model saying "remember this" persists nothing) → EMBEDDING THROUGH
GovernedModelRuntime ONLY (`embed` joins the provider contract as an
optional discovered operation; broker resolves provider.invoke before
provider contact; no fallback — a failed embedding is a structured error;
provider-neutral contracts, no credentials) → DERIVED INDEX (validated
vector cache; entries re-checked against canonical chunks on every load —
interrupted writes/tampering/deleted memories never surface) → GOVERNED
RETRIEVAL (scope+owner+lifecycle policy BEFORE ranking; deterministic
score/chunkId/memoryId ordering; insertion order never decides) → QIE
CANDIDATES (trust MEMORY) → P8.3 firewall (admittedMemory backing) → P8.2
selector → P8.1 composer (single budget authority) → P8.5 defense → P8.4
adapter → governed runtime. Deletion propagates (record → index → cache;
recovery sweeps orphans both directions); compaction reuses the ADR 0030
engine; evaluation gains scopeCorrectness/provenanceCompleteness/
deletionCorrectness dimensions (absent without memory — P5 contract
preserved); ten `memory.*` events on the existing EventBus with
metadata-only payloads; Studio Evidence panel + M dimension badge + SSE
refresh; `quack memory list|inspect|search|delete` CLI (fail-closed exit
codes, `--json`); `@quack/sdk` exports the stable contracts (no vector-DB
internals, storage paths, or policy objects). Knowledge sources: inline +
workspace files (traversal-guarded) only — URLs/repositories/crawling
UNSUPPORTED. Poisoning defense is STRUCTURAL (17-test adversarial matrix:
escalation, cross-scope, forged provenance/verification, high-relevance
hostility, stale vectors, provider denial, QIE bypass resistance) — no
blacklist. Scopes stay the existing MemoryScope vocabulary. Multi-process
file writes follow the one-process-per-data-dir constraint.

### P9 phases

- **P9.1/P9.7** canonical record + deterministic chunking — SHIPPED
- **P9.2** scope isolation over the existing vocabulary — SHIPPED
- **P9.3/P9.6** explicit persistence + store — SHIPPED
- **P9.4/P9.5** admission + content-vs-metadata separation — SHIPPED
- **P9.8/P9.9** governed embedding + provider-neutral contracts — SHIPPED
- **P9.10** derived index — SHIPPED
- **P9.11/P9.12/P9.16** governed deterministic retrieval + provenance — SHIPPED
- **P9.13/P9.14** QIE integration + trust preservation — SHIPPED
- **P9.15** poisoning adversarial suite — SHIPPED
- **P9.18/P9.19/P9.20** deletion/compaction/recovery — SHIPPED
- **P9.21** evaluation dimensions (existing evaluator) — SHIPPED
- **P9.22** observability (existing EventBus) — SHIPPED
- **P9.23/P9.24/P9.25** Studio/CLI/SDK surfaces — SHIPPED
- **P9.26** knowledge sources (inline + workspace files) — SHIPPED
- **P9.27/P9.28/P9.29** security matrix + bounds + no-second-authority — SHIPPED

**P9 is COMPLETE: all phases shipped.**

## P10 — Ecosystem / Marketplace (SHIPPED 2026-09-11, foundation)

Governed extension ecosystem FOUNDATION (ADR 0044): A PACKAGE MANIFEST IS
DATA, NEVER AUTHORITY. One declarative, broker-governed package catalog —
BEFORE any runtime admission or execution. LOCAL PACKAGE → manifest
validation (fail-closed: unknown fields rejected, entry traversal rejected,
publisher signatureState only UNSIGNED/UNVERIFIED — no self-asserted
verification) → sha256 integrity (packageDigest over content,
manifestDigest over the CANONICAL manifest form — key order never changes
identity; no signature verification exists, states are honest) →
exact-version dependency resolution (no "latest", no ranges, no network;
cycles and conflicts fail closed) → transactional install (validate ->
resolve -> duplicate pre-check -> all-or-nothing register with rollback;
duplicate identity fails closed, never a silent no-op) → deterministic
registry (one fail-closed-parsed record per extension; tampered records
are excluded on load, never coerced; listing sorted id+version, insertion
order never decides; REMOVED deletes the record — no ghosts) → explicit
8-state lifecycle (DISCOVERED/VALIDATED/ADMITTED/INSTALLED/ENABLED/
DISABLED/QUARANTINED/REMOVED; frozen transition table; REMOVED terminal)
→ metadata-only evaluation (manifestIntegrity, lifecycleConsistency,
dependencyCompleteness, provenanceExplicitness — deterministic) → nine
`extension.*` metadata-only events on the EXISTING EventBus. Capability
governance: declared capabilities/permissions grant NOTHING — the existing
CapabilityBroker is the only authority (catalog mutations resolve
plugin.install — HIGH-RISK, human-approved; reads resolve workspace.read;
per-capability checks resolve through the same broker). EXECUTION BOUNDARY:
P10 executes nothing — no code loading, no child_process, no dynamic
import; extensions are REGISTERED/ADMITTED/NOT-EXECUTABLE records and every
surface says so. Surfaces: `quack extension list|inspect|validate|install|
enable|disable|remove` CLI (exit codes 0/1/2/3, `--json`, install prompts
the operator — a denial writes nothing); `GET /extensions` server route
(metadata-only, redacted, fail-closed honest empty); Studio Ecosystem
panel (identity/kind/lifecycle/signature/integrity/declared capabilities/
dependency count; honest empty state; SSE refresh for `extension.*`
events); SDK exports the manifest/integrity/lifecycle/resolution/
evaluation contracts (no registry paths, no broker internals, no package
content, no execution surface). Structural security (21-test adversarial
matrix): malformed/forged manifests, tampered records (digest
correspondence), duplicate identities, dependency cycles/conflicts,
capability self-escalation text granting nothing, broker-denied
mutations, transactional rollback, lifecycle ghosts, event content-leak
resistance, execution-boundary honesty, determinism.

NOT in P10 (explicitly): no marketplace, no remote fetching, no remote
execution, no production sandbox, no extension code execution, no
cryptographic signature verification. **Risk realized:** medium (catalog
governance only; no new authority surface).

### P10 phases

- **P10.1** strict fail-closed manifest validation — SHIPPED
- **P10.2/P10.3** identity + honest sha256 integrity — SHIPPED
- **P10.4** local discovery (read-only, no network) — SHIPPED
- **P10.5/P10.6** transactional install + rollback — SHIPPED
- **P10.7** capability governance through the existing broker — SHIPPED
- **P10.8** execution-boundary honesty (nothing executes) — SHIPPED
- **P10.9** exact-version dependency resolution (cycles/conflicts fail) — SHIPPED
- **P10.10** deterministic 8-state lifecycle — SHIPPED
- **P10.11** nine `extension.*` events on the existing EventBus — SHIPPED
- **P10.12** metadata-only deterministic evaluation — SHIPPED
- **P10.13** CLI extension commands — SHIPPED
- **P10.14** Studio Ecosystem panel + SSE refresh — SHIPPED
- **P10.15** SDK contract exports — SHIPPED
- **P10.16** adversarial security matrix — SHIPPED
- **P10.17** deterministic registry behavior — SHIPPED
- **P10.18** full verification gates — SHIPPED

**P10 FOUNDATION is COMPLETE: all phases shipped. Extension execution,
marketplace, sandboxing, and signature verification remain future work.**

## P11 - Governed Mission Runtime (SHIPPED 2026-09-12, ADR 0045)

The first REAL model-in-the-loop mission path, assembled exclusively over
existing authorities (one broker, one EventBus, one QIE, one governed model
runtime, one memory system):

USER → MISSION → MISSION STATE (canonical state machine) → QIE
(firewall → selector → composer → defense) → GOVERNED MODEL → strict
fail-closed proposal parser → VALIDATION → CAPABILITY BROKER →
AUTHORIZED EXECUTION (existing surfaces) → OBSERVATION → deterministic
next-step policy → BUDGET/STALL-BOUNDED continue/complete/fail.

The model NEVER executes. It proposes; the parser validates; the ONE
CapabilityBroker authorizes; existing surfaces execute. No fallback path.

- **P11.1** governed mission loop over existing authorities — SHIPPED
- **P11.2** canonical MissionState machine transitions (fenced, fail-closed) — SHIPPED
- **P11.3** strict `quack:action-proposal:v1` parser (server-derived risk/key) — SHIPPED
- **P11.4** QIE pipeline mandatory (P8 digest preserved in dispatch metadata) — SHIPPED
- **P11.5** P8.3 firewall admission for P9 memory (MEMORY lane, never authority) — SHIPPED
- **P11.6** bounded retries (model/parse only); denial/execution fail closed — SHIPPED
- **P11.7** budget + stall detection bound every loop — SHIPPED
- **P11.8** idempotent step keys + terminal-run refusal (no silent re-execution) — SHIPPED
- **P11.9** durable run records (atomic write, identity-checked load) — SHIPPED
- **P11.10** seven `mission.step.*`/`mission.action.*` events, redacted metadata-only — SHIPPED
- **P11.11** system surface `governedMissionLoop` (fail-fast construction) — SHIPPED
- **P11.12** CLI `govmission run|status` (operator-declared provider.invoke consent) — SHIPPED
- **P11.13** server `GET /governed-missions` (redacted, metadata-only) — SHIPPED
- **P11.14** Studio SSE live refresh for mission-runtime events — SHIPPED
- **P11.15** SDK contract exports (loop, parser, stores, keys) — SHIPPED
- **P11.16** adversarial security matrix (12 cases) — SHIPPED
- **P11.17** full regression gates (1827 serial, 0 fail) — SHIPPED

**P11 COMPLETE. Explicitly NOT in P11: mid-run durable resume of arbitrary
OODA state (ExecutionRecovery checkpoint mapping is future work), probe-runner
verification beyond the existing conservative harness behavior, execution of
P10 extension packages (still REGISTERED/ADMITTED/NOT-EXECUTABLE), and any
P12+ functionality.**

## Dependencies

P1 → P2 → P3 → P4 → P5 (Console and streaming enable harness eval UX);
P6/P7 depend on P2; P8+ depend on mission abstraction stability (post-v1.0).
RC path: P0+P1 are RC-compatible (small, additive); P2–P5 target v1.0;
P8+ are v1.1+.
