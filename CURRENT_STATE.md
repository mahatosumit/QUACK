# QUACK Current State

**Verified:** 2026-09-12 (P1–P7: Mission Ops, Mission Control, Console, Governed Streaming, Harness Expansion, Agent Workspace, Trace Center + Consolidation; P8.1–P8.9 COMPLETE: Instruction Engine foundation, Context Selection, PrivacyFirewall Activation, Governed Model Adaptation, Injection Defense Enforcement, Harness Instruction Scoring, Instruction Observability, Studio/CLI Instruction Inspection, Research/SDK Surface; P9 COMPLETE: Governed Semantic Memory / Knowledge — canonical record + fail-closed admission + governed embedding through the model runtime + derived validated index + governed deterministic retrieval + QIE integration + structural poisoning defense + deletion/compaction/recovery + evaluation/observability + Studio/CLI/SDK surfaces, ADR 0043; P10 COMPLETE: Governed Extension Ecosystem FOUNDATION — fail-closed manifest validation + honest sha256 integrity (UNSIGNED/UNVERIFIED only, no signature verification) + exact-version dependency resolution + broker-governed transactional install (plugin.install, operator-approved) + deterministic registry + 8-state lifecycle + metadata-only evaluation/observability + Studio/CLI/SDK surfaces; extension EXECUTION is NOT implemented — nothing loads or runs package content; ADR 0044; P11 COMPLETE: Governed Mission Runtime — the first REAL model-in-the-loop mission loop over existing authorities: canonical MissionState transitions, mandatory QIE pipeline (firewall → selector → composer → defense → governed dispatch with P8.1 digest preserved), strict fail-closed `quack:action-proposal:v1` parser with server-derived risk/sandbox/idempotency keys, DefaultExecutionHarness broker authorization, existing-surface execution, bounded retries, budget/stall bounds, idempotent terminal-run refusal, durable redacted run records, 7 mission.step/action events, system surface + CLI govmission + server /governed-missions + Studio SSE + SDK exports, 12-case adversarial matrix; the model proposes and NEVER executes; ADR 0045)

## Baseline

Phase 1 is complete. Its verification report records passing root and SDK
typechecks, build, lint, full test suite, and public-release staging. Phase 2
is in progress. This document records only current, reproducible evidence;
historical architecture audits remain context, not proof of current behavior.

## Subsystem status

| Subsystem | Status | Current evidence |
| --- | --- | --- |
| Phase 1 correctness and authority invariants | DONE | `.phase1-checks/PHASE1_REPORT.md` records the completed verification. |
| Canonical public mission runtime | DONE | CLI, API, HTTP server, SDK, and direct `QuackRuntime` submit through `QuackRuntime → SessionRuntime → DefaultLoopDriver → WorkflowEngine/ExecutionScheduler → CapabilityBroker → explicit verification`. |
| Session runtime, workflow engine, scheduler | PARTIAL | The public mission path is verified. `CompanyTaskScheduler` is an explicitly unsupported compatibility boundary; it no longer owns a workflow engine or scheduler and cannot run arbitrary callbacks. |
| Agent loop | DONE | `DefaultLoopDriver` is the active public loop. The exported `AgentLoop` is a compatibility facade that delegates to `QuackRuntime` and rejects standalone execution. |
| Capability authority | DONE | Phase 1 verified fail-closed authority and child attenuation. New extension-policy integration is PARTIAL until phase-level verification. |
| Typed tool execution | PARTIAL | The governed runtime dispatches registered tools through the capability broker. Unified tool/provider materialization is implemented (ADR 0032), and live dispatch seams are now wired (ADR 0036): the SWE composition's exposed `modelRuntime` shadows `generate`/`stream` with broker-gated versions, `governedProviderRouter` and `governedModelRuntime` are exposed on the system surface, and MCP action evidence carries operation identity, retry safety, permissions, provider version, and namespace. Remaining: SWE-distribution caller migrations beyond the system surface. |
| Portable skill execution | PARTIAL | Portable skills submit task graphs to `QuackRuntime.executeGraph`. On 2026-09-04, promoted candidate execution passed through the governed graph fixture, together with all compiler and sandbox tests. Direct callable legacy skills now fail closed rather than bypassing runtime authority or evaluation. |
| Evaluated completion | PARTIAL | Selected extension validators receive runtime-created workflow evidence. Completion requires a valid receipt citing current evidence and matching mission, execution, and verifier (ADR 0033 adds an explicit `CompletionReceiptV1` proof chain with fail-closed minting/validation; the checkpoint stays authoritative). A broader evaluation ledger across non-durable missions and wider evaluation integration remain incomplete. |
| Extension registry and policy | PARTIAL | Admission, provenance, profile ceilings, restrictive policy hooks, exact memory-provider selection/execution binding, declarative plugin-hook admission, and governed hook execution (ADR 0034) are implemented. Hook emission is wired into canonical runtime events (ADR 0036): `RuntimeHookBridge` subscribes to `task.*`, `tool.*`, `capability.decided`, and `memory.written` and dispatches admitted hooks through the `GovernedHookExecutor`; `createQuackSystem` exposes `system.hookBridge` with per-dispatch audit records. Remaining: SWE-distribution hook wiring and intervention-style hook kinds. |
| Provider and model routing | PARTIAL | Versioned provider contracts exist; `GovernedProviderRouter` (ADR 0032) now enforces `provider.invoke` capability authority before provider contact on the canonical composition. User-managed provider/auth ecosystem work remains deferred. |
| Memory, context, checkpoints, recovery | PARTIAL | Configured data directories persist neutral runtime tasks and durable execution checkpoints. Interrupted-mission recovery is verified for single-process restarts through `QuackRuntime.resumeMission` (ADR 0028). A selected admitted `MemoryProvider` now binds through the canonical runtime (ADR 0029): governed reads feed bounded planner context, completion writes are durably acknowledged, exact provider/version/namespace identity survives restart, and ambiguous writes fail closed. Canonical local memory now supports deterministic, host-owned compaction (ADR 0030): per-scope bounds, within-scope deduplication, and age pruning that never removes protected records. **Multi-process recovery is now SUPPORTED (Phase 5, single-host scope): mission ownership via the SQLite coordination primitive with lease/heartbeat/fencing — see ADR 0031 update and docs/recovery/multi-process-recovery.md.** **P9 semantic memory is COMPLETE (ADR 0043): governed semantic memory/knowledge in `src/memory/semantic/` — fail-closed admission, explicit persistence, embeddings through GovernedModelRuntime only, derived validated vector index, scope/owner-isolated deterministic retrieval, QIE integration in the MEMORY trust lane, structural poisoning defense (adversarial matrix green), deletion/compaction/recovery, evaluation dimensions + `memory.*` events on the existing bus, Studio/CLI/SDK surfaces. Memory stays DATA, never authority.** |
| MCP and plugins | PARTIAL | Unsupported isolation rejects and plugins do not claim sandboxing. Governed plugin-hook execution is wired (ADR 0034/0036). MCP actions dispatch through the ActionRuntime broker path and their evidence now cites governed operation materialization — operationId, retry safety, required permissions, provider version, namespace (ADR 0036). Remaining: full MCP provider materialization envelope across all transports and a container-isolation backend. |
| Delegation runtime | PARTIAL | `DelegationRuntime` (ADR 0035) implements governed delegation with derived agent-scoped grants, lifecycle states, depth ceiling, duplicate guard, grant revocation, and verified child receipts (ADR 0033). Live composition wiring (ADR 0036): `createQuackSystem` wires delegation when `delegationMaxDepth > 0` plus a parent grant (explicit id or exactly one seeded mission grant); default remains disabled. Fan-out aggregation (`delegateFanOut`) completes the parent only when every child produced a verified receipt; partial completion reports `PARTIAL`. Remaining: parallel child orchestration beyond sequential fan-out and delegation wiring in the SWE distribution. |
| SWE/company surfaces | LEGACY / COMPATIBILITY | SWE composition moved under the SWE distribution boundary; compatibility surfaces remain while callers migrate. |
| Duplicate orchestration | PARTIAL | The public AgentLoop duplicate is isolated. Direct callable legacy skills and legacy company scheduler execution fail closed. Workforce portable skill dispatch remains compatibility wiring over the canonical graph runtime. |
| SDK and public exports | PARTIAL | Neutral and SWE export boundaries exist. The public package and SDK now export the governed execution surfaces (ADR 0032–0035): `materializeTool`/`ToolMaterialization`, `GovernedProviderRouter`, `buildCompletionReceipt`/`CompletionReceiptV1`, `GovernedHookExecutor`, `DelegationRuntime`/`assertChildReceipt`, and `InMemoryCapabilityGrantRegistry`, with SDK package compatibility tests (3). `QuackRuntimeV1.resume` remains a declared, unimplemented contract member and stays unexported. Package-level compatibility tests for the SWE surface and the remaining `QuackRuntimeV1` contract remain later phase gates. |
| Open-source/privacy boundary | DONE | Phase 1 excluded private local state and generalized public-core wording; do not redo without a concrete regression. |
| Instruction engine (QIE) | DONE (P8.1–P8.9) | All P8 phases shipped (ADR 0042): `src/instruction/` holds the canonical InstructionPlan contract (11 layers, 13 context categories, 8 trust classes), fail-closed category↔trust validation, documented trust precedence, char-based budget, output-contract/failure-policy representation, pure deterministic composer with canonical-JSON digest, P8.2 deterministic context selector, P8.3 firewall admission, P8.4 governed model adaptation (digest/identity preserved in metadata, dispatch through the existing GovernedModelRuntime, models/providers untouched), P8.5 injection defense (structural enforcement inlined before every dispatch: digest correspondence, trust pairing, evidence status, duplicate/unsafe ids — fail-closed, no fallback; heuristic detection as defense-in-depth with metadata-only injectionFlags; DATA REMAINS DATA — payload language never acquires authority), P8.6 harness instruction scoring (metadata-only `GovernedInstructionRecord` dispatch records attached additively to `MissionTrace`; fail-closed record parsing; harness metrics dispatch census; `MissionEvaluator` instructionIntegrity/contextProvenance/budgetDiscipline dimensions absent-without-records — P5 contract preserved; `instruction.rejected` evaluation failure; one-way harness→instruction dependency, no second evaluator), and P8.7 instruction observability (`instruction.dispatched`/`instruction.rejected` on the existing EventBus — no second event system; `InstructionObserver` at the `invokeGovernedInstruction` seam builds P8.6 records, bounded recent window, metadata-only payloads, observer failures never break dispatch; dashboard state `harness.instruction` aggregate from trace records), and P8.8 Studio/CLI instruction inspection (Studio Trace Detail "Governed instructions" panel + Evidence instruction telemetry/I-dimension badges + SSE live refresh for instruction events; `quack instructions [--mission <id>]` CLI over the existing trace repository with fail-closed record parsing — tampered records excluded and counted; no new routes/endpoints/stores), and P8.9 research/SDK surface (`@quack/os` root + `@quack/sdk` export the full QIE contract — constants, validation, composition, selection, firewall, adaptation/dispatch, defense, records/scoring, observer; no runtime/planner/memory/authority exports; `docs/research/INSTRUCTION_ENGINE_RESEARCH_SURFACE.md` defines the research integration pattern, packaged in docs allowlists). |

## Phase 4 stage status (2026-09-07, finalization session)

| Stage | Status | Evidence |
| --- | --- | --- |
| 4A audit | ✅ | subagent architecture map (skills, discovery gaps, shell strings, browser contexts) |
| 4B platform abstraction | ✅ | ADR 0040; 13 platform tests |
| 4C universal skill spec | ✅ | ADR 0041; `src/skills/universal.ts` |
| 4D/4E privacy + discovery | ✅ | 12 discovery tests |
| 4F registry | ✅ | lifecycle + revalidation tests (in 12) |
| 4G quarantine-first search | ✅ | 6 search tests |
| 4H sandbox integration | ✅ | 3 execution-profile tests |
| 4I MCP envelopes | ✅ | Phase 3 (ADR 0036), 16 action/MCP tests |
| 4J delegation fan-out | ✅ | Phase 3 (ADR 0036), 12+1 tests; parallel children remain future work |
| 4K cross-platform process/fs | ✅ | all production shell strings migrated; static guard active; 4 GitStatusTool tests; full suite green |
| 4L SQLite coordination | ✅ (primitive) | `src/storage/coordination.ts`; 9 real-fork multi-process tests; recovery rewiring deliberately deferred per ADR 0031 |
| 4M CI matrix | 🟡 implementation complete / CI execution evidence pending | ci.yml windows/linux/macos × node 22/24 + arm64 job; all command shapes verified locally on Windows; no GitHub Actions run yet |
| 4N adversarial cross-suite | ✅ | 20 tests, `src/security/adversarial-cross-suite.test.ts`; found + fixed 2 real bugs (registry durability, migration race) |
| 4O documentation | ✅ | docs/platform/{architecture,windows,linux,macos}.md, docs/skills/ (7), docs/security/ (6), docs/recovery/ (3); every capability labeled SUPPORTED/BEST_EFFORT/UNSUPPORTED |
| 4P production gate | ✅ (local) | all local gates green 2026-09-07; static security + governance audits passed; CI execution evidence unavailable (no git remote) → release decision **PRODUCTION CANDIDATE**, blocker: Linux/macOS/ARM64 runtime verification |

## Phase 5 stage status (2026-09-08, finalization session)

| Stage | Status | Evidence |
| --- | --- | --- |
| 5A baseline audit | ✅ | Phase 4 baseline rerun green (1,442+17) before any Phase 5 change |
| 5B multi-process recovery | ✅ | `MissionOwnershipGuard` (`src/runtime/ownership.ts`) over the Phase 4 coordination primitive; resumeMission + fresh submitGoal acquire mission leases; all durable transitions epoch-fenced; ADR 0031 boundary lifted |
| 5C ownership lifecycle | ✅ | UNOWNED→ACQUIRING→OWNED→HEARTBEATING→COMPLETING→RELEASED + OWNERSHIP_CONFLICT/LEASE_LOST/STALE_OWNER failure states |
| 5D crash/restart recovery | ✅ | 12/12 real-fork suite: 6 SIGKILL boundaries, takeover-after-expiry, ≤1 executing owner in races, repeated crash cycles, no-re-execution, verified receipts |
| 5E durable state | ✅ | `docs/recovery/durable-state.md` — durable/ephemeral/derived split; no automatic retention/compaction (documented honestly) |
| 5F observability | ✅ | typed events `ownership.*` + `mission.*` on the EventBus; no secrets in payloads |
| 5G resource/cancellation | ✅ | release-after-final-persist ordering; heartbeat unref'd; fenced failure transitions; adversarial guard lifecycle test |
| 5H skill operations | ✅ lifecycle / DEFERRED stats | all 11 lifecycle ops test-backed (discover→…→revoke→execute); execution statistics deliberately deferred (no consumer in architecture) |
| 5I cross-platform CI | 🟡 configured / execution pending | matrix in `.github/workflows/ci.yml`; no git remote so never executed |
| 5J security hardening | ✅ | adversarial cross-suite 22/22 incl. DB-tamper boundary, version-rollback, guard fencing; interrupted-recovery 22/22 preserved |
| 5K dogfood E2E | ✅ | SKILL.md → compiler → governed graph → durable run → SIGKILL → second-process resume → verified receipt (in 12/12 suite) |
| 5L documentation | ✅ | this file, checkpoint rewrite, ADR 0031 update, `docs/recovery/{multi-process-recovery,durable-state}.md` rewrite/new, `docs/operations/README.md` |
| 5M release prep | ✅ | secret audit, .gitignore audit, first clean commit (see Git status) |
| 5N publication | ⛔ blocked | no git remote configured, no GitHub auth tooling — exact user actions recorded; local commit exists |

## Latest verification

| Check | Result |
| --- | --- |
| **P11 Governed Mission Runtime gate, 2026-09-12** | **PASS: full fresh gates — lint (typecheck + static quality) pass; build pass; ordinary suite 1,810/1,810 tests 0 fail + 17 serial selfmod; full serial run npm run test:serial 1,827/1,827 tests 0 fail 0 skipped. Focused: dist/runtime/mission-lifecycle/governed-mission-loop.test.js 16/16 (happy path model→parser→broker→authorized core.tools execution→done completion with P8.1 digest verified in dispatch metadata and objective rendered; denial path DENIED + STOP_POLICY_DENIED + mission.action.denied event, no completed event; malformed output consumes exactly initial+2 bounded model attempts then fails closed; unknown capability never reaches execution; budget STOP_MAX_ITERATIONS at exactly 3 iterations; cancellation CANCELLED through the canonical state machine; durable run records refuse terminal re-run mission.loop_already_terminal; completed runs never silently re-execute on 'resume'; deterministic stepId sha256(mission:step:capability) + identical QIE plans for identical inputs; unadmitted memory candidate never reaches the prompt — P8.3 firewall enforced; stall detection stops repeated identical actions before the ceiling; terminal states throw on resume attempts; parser matrix incl. done=false rejection, oversized raw/args/finalMessage/intent bounds). dist/runtime/mission-lifecycle/governed-mission-loop.security.test.js 12/12 (capability escalation via requestedCapabilities grants nothing — denial-only when unbacked; forged approval fields rejected pre-broker by strict shape; model cannot declare riskLevel/sandbox/timeoutMs/idempotencyKey; policy injection text stays in the objective data lane; terminal replay refused with zero additional model dispatches; hostile memory content never escalates trust even when admitted; event payloads carry no secrets/prompts/arguments; persisted run records carry no secrets/prompts; forged record identity fails closed on load; compiled loop has no ungoverned model path or process execution; oversized floods fail closed; stable convergence keys). CLI 16/16 incl. +3 P11 (parseArgs govmission run/status with --json never eaten as objective; run requires objective + honest provider.invoke consent guidance exit 2; status lists earlier-process records across processes, --json inspection, unknown id exit 3). Server 16/16 incl. +1 P11 (/governed-missions readOnly metadata-only with prompt/argument absence verified at the wire). Studio 22/22 incl. +1 P11 (7 mission.step/action event types wired for SSE live refresh). SDK 9/9 incl. +1 P11 (loop/parser/stores/constants reachable; parser fail-closed through the package; server-side-derived authority fields; deterministic plans; fail-fast construction without required authorities). E2E Control Room 1/1. Security regression 67/67; models/providers/AIRM 143/143; server+dashboard 54/54; ecosystem+memory+instruction 298/298; mission-lifecycle+actions 100/100. Encoding audit: no BOM, no mojibake, LF-normalized via .gitattributes; secret scan clean (one pre-existing test fixture token in server.test.ts only).** |
| **P10 Ecosystem Foundation gate, 2026-09-12** | **PASS: full fresh gates — lint (typecheck + static quality) pass; build pass; ordinary suite 1,777/1,777 tests 0 fail (183 test files: 181 parallel + 2 selfmod serial); full serial run npm run test:serial 1,794/1,794 tests 0 fail. Focused: dist/ecosystem/security.test.js 21/21 adversarial (P10.16 matrix: malformed/forged manifests — unknown fields, entry traversal, self-asserted signatureState rejected, capability-escalation text grants nothing; tampered registry records — digest-correspondence/identity mismatch excluded on load; duplicate identities fail closed; dependency cycles/conflicts fail closed; broker-denied mutations; transactional rollback; lifecycle ghosts impossible; event payloads never leak content; execution-boundary honesty; determinism). dist/ecosystem/ecosystem.test.js 6/6 (canonical manifest form + digest regardless of key order; deterministic registry listing insertion-order independent; deterministic resolution order; forged-identity record exclusion). Security regression 61/61 (adversarial-cross-suite, phase7-security, capability-broker, approval-controller, permissions, network-policy). Models/providers regression 60/60 (governed-runtime, models registry/runtime, providers conformance/kernel/nvidia/provider/router/validation, server model-stream). Server + dashboard regression 55/55 (server.test, audit-and-retirement, mission-operations, model-stream, dashboard.test, studio.test). CLI 13/13 incl. +2 P10.13 (parseArgs extension contract; commandExtension validate/install/duplicate/lifecycle/remove with exit codes 0/1/2/3, --json, honest empty state, no ghost after removal, read-only commands never prompt, install prompts the approver exactly once for plugin.install — HIGH-RISK broker path, a denial writes nothing). Studio dashboard 21/21 incl. +3 P10.14 (Ecosystem panel route + metadata-only columns, no content/secret leakage + never-executed honesty, extension.* SSE refresh; P8.8 SSE re-render list assertion updated for the added ecosystem route). SDK 8/8 incl. +1 P10.15 (kind/lifecycle vocabularies, fail-closed manifest validation, canonical digests, integrity mismatch fail-closed, lifecycle table, exact-version resolution order, evaluation dimensions); SDK typecheck exit 0. E2E Control Room browser suite 1/1 pass, 0 skipped. Defects found and fixed during this gate: (1) P10 CLI test invoked parseArgs without the argv pair (P9.24 pattern) — test bug fixed; (2) commandExtension built its system without the operator approver, so broker-governed plugin.install (HIGH-RISK) could never be granted — CLI mutations now request plugin.install with the operator as human approver (ConsoleApprovalCallback default, injectable via CommandContext.approver), so quack extension install prompts before writing anything and a denial writes nothing; read-only commands never prompt. HONEST LIMITS (P10): extension EXECUTION is not implemented (nothing loads, imports, or spawns package content — REGISTERED/ADMITTED/NOT-EXECUTABLE); integrity verification is limited to the implemented sha256 digest model with honest UNSIGNED/UNVERIFIED signature states — NO cryptographic signature verification exists; NO remote marketplace; NO production sandbox; NO remote/live extension execution; discovery is local-filesystem read-only. ADR 0044; docs/product/ROADMAP.md P10 section; docs/cli/CLI.md extension commands; sdk/README.md ecosystem surface.** |
| **P9 Semantic Memory gate, 2026-09-11** | **PASS: focused suites green — `dist/memory/semantic/semantic.test.js` 22 tests (record contract + fail-closed parse incl. hash-mismatch/scope/provenance/persistence; deterministic bounded chunking with stable sha256-derived chunk ids; admission matrix — shape/scope/owner/actor/provenance/oversize/duplicate-id/duplicate-content/persistence-explicit/sensitive-content class-names-only; index determinism with chunkId tie-breakers + orphan sweep + deletion propagation; scope/owner invisibility; insertion-order-independent retrieval; stale-index deletion invisibility; store tamper exclusion on reload; ADR 0030 compaction reuse with protected-record survival; knowledge-source inline+file with traversal fail-closed; QIE pipeline MEMORY-lane + unbacked-firewall rejection; evaluation dimensions; event vocabulary). `dist/memory/semantic/security.test.js` 17 adversarial tests (P9.15/P9.27 matrix: 7 hostile payloads persist as DATA with host-owned authority fields; memory candidates never claim SYSTEM_POLICY/TRUSTED_RUNTIME; forged verification has no field to forge; cross-scope poisoning invisible; tampered durable file excluded on fresh-instance recovery; duplicate identity fails closed; high-relevance hostility stays MEMORY with P8.5 flags never elevating; hand-crafted surviving cache entry for a deleted memory never retrieves; embedding denial/malformed/unavailability fail closed with exactly one governed attempt and no ghost entries; QIE bypass resistance incl. unbacked firewall rejection + defense-passes-as-data; crash recovery leaves valid unembedded records — no ghosts, no orphans; observability payloads never leak content or secrets; URL/git knowledge sources rejected; rank grants nothing). CLI 11/11 incl. +3 P9 (parse/list/inspect/delete + honest search unavailability, exit codes). Studio dashboard 21/21 incl. +3 P9.22 (semantic panel, M dimension, memory.* SSE refresh). SDK 7/7 incl. +2 P9.25; SDK typecheck exit 0. Full gate from this run (2026-09-11, after all P9 source final): ordinary suite 1,745 pass / 0 fail / 0 skipped (171 suites, 106.7s); serial full suite 1,762 pass / 0 fail / 0 skipped (171 suites, 332.4s); serial selfmod 17/17; security/adversarial 84/84 (phase7-security, permissions, network-policy, capability-broker, approval-queue, approval-controller, adversarial-cross-suite, semantic-security); models/providers/airm 143/143 (governed-runtime, runtime, registry, providers, governed-router, conformance, kernel, nvidia, router, validation, embedding registry); server 31/31 (incl. /memory semantic redacted/bounded surface, SSE redaction); Control Room E2E 1/1 (Edge, a11y + console-error gates); lint/typecheck/build exit 0. No live embedding provider configured in this environment — provider integration verified at unit-contract level only (governed Ollama/OpenAI-compatible embed paths, broker authorization before provider contact, no fallback embedding path); no live provider run was performed. Repository searches verified: no direct provider/network calls in semantic production code (type-only governed-runtime imports), single event system, single compaction engine, single budget authority, no second evaluator.** |
| **P8.5 Injection Defense Enforcement gate, 2026-09-10** | **PASS: 1,664 ordinary + 17 serial tests; 0 failures. Lint + static guards, root/SDK typechecks, build pass; security suites green (29 adversarial-cross-suite + phase7-security); models/providers/stream regression green (22: governed-runtime, runtime, governed-router, model-stream). Focused: `dist/instruction/injection-defense.test.js` 52 adversarial tests (invariant A trust immutability — 5 escalation payloads across TOOL/MEMORY/EVIDENCE/SKILL/RETRIEVED lanes all stay in lane; B role/delimiter confusion — 12 fake-role payloads incl. XML/JSON/markdown/chat-template markers stay data in every untrusted lane, user instruction-like content preserved as USER_INPUT data; C/D override + escalation — SYSTEM_POLICY beats TOOL_OUTPUT override, all 5 precedence pairs verified, 4 policy-claim texts flagged never admitted; E capability escalation — capability-claim text grants nothing, flags only; G/H/I/K lane resistance — hostile README/tool-output/skill-privilege/memory-injection stay in lane byte-identical; J evidence forgery — textual verification claims never upgrade status, invalid status fails closed (digest-isolated); L digest integrity — pass-through preserves correspondence, layer/output-contract mutations fail closed, attacker-recomputed digest still rejected on unsafe ids/duplicates, no hidden second digest; M provenance integrity — provenance byte-identical after enforcement; N/O provider + fallback bypass — defense rejection contacts zero providers, no retries/alternates, legitimate dispatch exactly once; determinism — repeated enforcement identical, insertion-order independent, deep-frozen purity; end-to-end firewall→selector→composer→defense→adapter→governed-runtime with 6 malicious multi-lane payloads, provenance surviving, flags trust-accurate, single governed dispatch). Repository searches verified: no provider/fs/net calls in QIE defense/adapter, no second precedence/budget tables.** |
| **P8.4 Governed Model Adaptation gate, 2026-09-10** | **PASS: 1,612 ordinary + 17 serial tests; 0 failures. Lint + static guards, root/SDK typechecks, build pass; security suites green (32 incl. adversarial-cross-suite, phase7-security, server model-stream). Focused: `dist/instruction/model-adapter.test.js` 25 tests (byte-identical P8.1 rendered prompt; deterministic + insertion-order-independent adaptation; provider-neutral request shape; digest preserved verbatim in metadata, never regenerated; mission/task/output-contract/failure-policy identity preserved; fail-closed on missing/invalid digest, wrong plan version, missing mission identity, unknown output-contract kind; governed dispatch with full context; invalid instructions never reach the runtime; denial passes through with zero ungoverned fallback attempts; prompt retains QIE authority structure — [TRUSTED]/[USER]/[DATA] + fixed layer order; no provider fields leak into QIE metadata; honest output-contract carriage, no fake schema enforcement). Models/providers regression green (19 tests: governed-runtime, runtime, governed-router).** |
| **P8.3 PrivacyFirewall Activation gate, 2026-09-10** | **PASS: 1,587 ordinary + 17 serial tests; 0 failures. Lint + static guards, root/SDK typechecks, build pass; security suites green (41 tests incl. adversarial-cross-suite, phase7-security, and the untouched ADR 0041 discovery suite). Focused: `dist/instruction/firewall.test.ts` 37 tests (policy lane: authorized-source admission, provenance-forgery rejection, fail-closed on absent authorities, user-cannot-claim-SYSTEM_POLICY; capability lane: granted-capability admission, unbacked/malformed rejection, capability text inside DATA grants nothing; skill lane: lifecycle backing required, no self-escalation; memory lane: MemoryPolicy-backed ids required, memory never becomes policy; evidence lane: status validity + record existence, instruction-like text stays evidence; tool/retrieved lanes: no TRUSTED_RUNTIME claim, no relevance override; content-mutation resistance: trust/category/layer immune to data payloads; sensitive-content rejection with class names only, zero content echo, no rewriting; duplicate-id op-level fail-closed; determinism + insertion-order independence; end-to-end firewall→selector→composer with provenance survival; rejected candidates never reach P8.2; deep-frozen purity).** |
| **P8.2 Context Selection gate, 2026-09-10** | **PASS: 1,550 ordinary + 17 serial tests; 0 failures. Lint + static guards, root/SDK typechecks, build pass. Focused: `dist/instruction/selector.test.js` 30 tests (byte-for-byte determinism across insertion orders incl. plan digest + report; canonical layer order + (trust, id) ordering; precedence hierarchy exact — RETRIEVED_CONTEXT never outranks USER_INPUT, no relevance scoring exists; duplicate-id op-level fail-closed incl. cross-layer; per-candidate rejections with structured reasons for trust-pairing violations (USER_INPUT claiming SYSTEM_POLICY, TOOL_OUTPUT claiming TRUSTED_RUNTIME), malformed shapes, missing evidence status outside the evidence layer, oversized items (maxItemChars intake cap); adversarial content stays DATA — instruction-like payloads never gain trust/precedence/budget/plan influence; budget: lowest-precedence trimmed first with recorded reasons, core/mandatory never silently dropped, core overflow fails closed, P8.1 composer confirmed sole budget authority; provenance survives candidate→plan→report; deep-frozen-input purity; empty-candidate validity; P8.1 composer behavior unchanged).** |
| **P8.1 Instruction Engine foundation gate, 2026-09-10** | **PASS: 1,520 ordinary + 17 serial tests; 0 failures. Lint + static guards, root/SDK typechecks, build pass. Focused: `dist/instruction/composer.test.js` 24 tests (plan construction + required fields; digest/composition determinism incl. key-insertion order; canonical layer order + within-layer (trust, id) ordering; provenance/category survival; documented precedence incl. user-never-beats-policy; fail-closed trust pairing — tool output claiming TRUSTED_RUNTIME and user claiming SYSTEM_POLICY both rejected; duplicate ids fail closed, no silent dedup; evidence status required; budget omission recording + core-overflow fail-closed; deterministic output-contract serialization; deep-frozen-input purity; PromptRegistry adapter reuse with versioning/rollback preserved). QIE is contract + deterministic composer only — no context retrieval, no model wiring (ADR 0042).** |
| **P7 Trace Center + Consolidation gate, 2026-09-10** | **PASS: full gate below. Trace Center (real TraceRepository timelines, type/text filters, capabilities/tools/verification/evidence/receipt sections), Artifact View (evidence-backed tool outputs only), Audit Center (`GET /audit`, redacted, auth-enforced). RETIRED: duplicate DesktopServer + gui/ SPA + desktop-app.ts + legacy dashboardHtml + fake benchmark/evaluation routes (hard-coded 100% numbers deleted, evaluation truth = real MissionEvaluator history). Adversarial: unauthorized audit 401, forged/traversal ids fail-closed 404, audit redaction, limit clamping. One HTTP surface (QuackHttpServer), one GUI (Studio).** |
| **P6 Agent Workspace gate, 2026-09-10** | **PASS: 1,531 ordinary + 17 serial tests; 0 failures. Lint + static guards, root/SDK typechecks, build, Control Room E2E (visits the Agent Workspace heading) pass. Studio Agents view joins registry (`/agents`) with assignment state + eval-dimension summary cards from `/dashboard/state` — view code only, endpoints unchanged, registry-not-execution honesty label retained.** |
| **P5 Harness Expansion gate, 2026-09-10** | **PASS: 1,530 ordinary + 17 serial tests; 0 failures. Lint + static guards, root/SDK typechecks, build, Control Room E2E pass. Scenario pack v2 = 15 scenarios across 7 families; adversarial scenarios (injection/secret-leak/network-denial/malformed/forged-identity) pass only when the runtime fails closed. Evaluator v2 scores capability-discipline/recovery/planning/evidence-quality from the durable trace only (new metrics: recoveredDenials, evidenceCoverage). Studio Evidence view renders stored evaluation history from the existing `/dashboard/state`. Model-vs-model deferred until live providers exist (no fabrication on echo fixtures).** |
| **P4 Governed Model Streaming gate, 2026-09-10** | **PASS: 1,528 ordinary + 17 serial tests; 0 failures. Lint + static guards, root/SDK typechecks, build, Control Room E2E pass. New `src/server/model-stream.test.ts`: broker denial fails closed before provider contact (terminal `denied: true` chunk), 400 on malformed requests, chunk text redacted at the wire AND on the shared event-bus broadcast (hostile `sk-…`/Bearer literals never survive). Studio contract test asserts the Console consumes the governed endpoint only.** |
| **P3 Console gate, 2026-09-10** | **PASS: 1,524 ordinary + 17 serial tests; 0 failures. Lint + static guards, root/SDK typechecks, build pass. Control Room E2E exercises the console flow (submit mission → conversation shows real accepted state) under a11y + console-error gates. Studio contract test asserts the P3 boundary: composer posts only through the Mission API; no fabricated model streaming (`model.stream.chunk` absent; guarded).** |
| **P2 Mission Control (Studio) gate, 2026-09-10** | **PASS: 1,523 ordinary + 17 serial tests; 0 failures. Root/SDK typechecks, build, lint + static guards pass. Control Room browser E2E (Edge, a11y serious/critical + console-error gates) covers the new Mission Control lanes, Mission Detail, and Approval Center surfaces with the queued approver wired. Studio contract tests assert lanes/cancel/resume/approval-queue/SSE wiring.** |
| **P1 Mission Operations gate, 2026-09-10** | **PASS: 1,522 ordinary + 17 serial tests; 0 failures, skips, or cancellations. Root/SDK typechecks, build, lint + static quality guards pass. Focused: approval-queue 6 · server mission-operations 8 (cancel/resume/approvals/trace-by-mission/SSE redaction, incl. forged-id, replayed-decision, no-queue fail-closed) · product contract 7 · interrupted-recovery 22 (unchanged behavior preserved).** |
| **Phase 5 final gate, 2026-09-08** | **PASS: 1,456 ordinary + 17 serial tests; 0 failures, skips, or cancellations (includes all dogfood/grant/adversarial changes). Root/SDK typechecks, build, lint pass. Focused: platform+terminal+git-status 20 · skills/privacy/sandbox 30 · isolation 17 · coordination 9 · multi-process recovery 12 (real forks) · interrupted-recovery 22 · adversarial cross-suite 22 · compiler 9 · SDK 3. Release decision: PRODUCTION CANDIDATE (Windows fully verified incl. multi-process recovery; Linux/macOS/ARM64 CI never executed).** |
| **Phase 4 final gate (4P), 2026-09-07** | **PASS: 1,442 ordinary + 17 serial tests; 0 failures, skips, or cancellations. Root/SDK typechecks, build, lint pass. Focused gates rerun fresh: platform+terminal+git-status 20, skills/privacy/sandbox 30, isolation 13 adversarial + 4 contract, coordination 9 (real forks), adversarial cross-suite 20, interrupted-recovery 22, compiler 9, SDK 3. Static security audit: every child_process/process.env site intentional + governed; zero `shell: true`. Governance audit: single canonical chain, no Phase 4 bypass. CI: IMPLEMENTED, EXECUTION PENDING (no git remote; matrix never run). Release decision: PRODUCTION CANDIDATE (Windows-verified; Linux/macOS unverified).** |
| Phase 4 stage gate 4K finish + 4L coordination, 2026-09-07 | PASS: 1,422 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. Root/SDK typechecks, build, and lint pass. Includes 9 new multi-process coordination tests (real forked processes) and 4 new GitStatusTool argv tests. |
| Phase 4 stage gate (4B–4K), 2026-09-06 | PASS: 1,409 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. Root/SDK typechecks, build, and lint pass. |
| Phase 4 external-skill search suite, 2026-09-06 | PASS: 6 quarantine-first tests in `dist/skills/discovery/search.test.js` (prompt/shell-injection and credential-harvest blockers, HIGH-risk review, privacy denial, policy re-derivation); 0 failures. |
| Phase 4 skill-execution-profile suite, 2026-09-06 | PASS: 3 tests in `dist/skills/execution-profile.test.js` (least-privilege defaults, risk never lowers isolation, explicit-secrets fail closed); 0 failures. |
| Phase 4 terminal env-sanitization suite, 2026-09-06 | PASS: 3 tests in `dist/tools/terminal.test.js` (secret-shaped env removal, dangerous-command blocking, non-secret env preserved); 0 failures. |
| Phase 4 platform suite, 2026-09-06 | PASS: 13 tests in `dist/platform/platform.test.js` (detection, capability matrix, path adversarial incl. UNC/device/ADS/symlink/short-path, argv process execution with env isolation, timeout/cancel/output bounds); 0 failures. |
| Phase 4 platform suite, 2026-09-06 | PASS: 13 tests in `dist/platform/platform.test.js` (detection, capability matrix, path adversarial incl. UNC/device/ADS/symlink/short-path, argv process execution with env isolation, timeout/cancel/output bounds); 0 failures. |
| Phase 4 skills discovery suite, 2026-09-06 | PASS: 12 tests in `dist/skills/discovery/discovery.test.js` (firewall classification/redaction/deny, forbidden files/dirs, risk derivation, explicit-root manifest-only discovery, registry lifecycle, supply-chain revalidation); 0 failures. |
| Phase 3 full repository suite, 2026-09-06 | PASS: 1,372 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. |
| Phase 3 root/SDK typechecks, build, and lint, 2026-09-06 | PASS. |
| Phase 3 SDK package integration, 2026-09-06 | PASS: 3 tests. |
| Phase 3 isolation suite, 2026-09-06 | PASS: 17 tests (4 contract + 13 adversarial worker-backend security); 0 failures. |
| Phase 3 governance wiring, 2026-09-06 | PASS: governed model runtime (7), SWE surface gate (1), hook bridge (6+1), delegation wiring + fan-out (12+1), actions/MCP (16). |
| Stage E SDK package integration, 2026-09-06 | PASS: 3 tests in `sdk/test/client.test.mjs` including new governed-surface compatibility coverage; 0 failures. |
| Stage E root/SDK typechecks, build, and lint, 2026-09-06 | PASS. |
| Stage E full repository suite, 2026-09-06 | PASS: 1,334 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. |
| Stage D focused delegation tests, 2026-09-06 | PASS: 7 tests in `dist/runtime/delegation.test.js`; 0 failures. |
| Stage D root/SDK typechecks, build, and lint, 2026-09-06 | PASS. |
| Stage D full repository suite, 2026-09-06 | PASS: 1,334 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. |
| Stage C focused hook tests, 2026-09-06 | PASS: 23 extension tests (10 new `dist/extensions/hooks.test.js` + 13 registry tests with the updated hook-admission contract); 0 failures. |
| Stage C system/plugins gate, 2026-09-06 | PASS: 66 tests; 0 failures. |
| Stage C root/SDK typechecks, build, and lint, 2026-09-06 | PASS. |
| Stage C full repository suite, 2026-09-06 | PASS: 1,327 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations (rerun after one unrelated skill-runtime timeout flake passed in isolation and rerun). |
| Stage B focused receipt tests, 2026-09-06 | PASS: 11 tests in `dist/engine/completion-receipt.test.js` and `dist/runtime/completion-receipt-runtime.test.js`; 0 failures. |
| Stage B runtime/engine gate, 2026-09-06 | PASS: 147 tests; 0 failures. |
| Stage B root/SDK typechecks, build, and lint, 2026-09-06 | PASS. |
| Stage B full repository suite, 2026-09-06 | PASS: 1,317 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. |
| Stage A focused materialization tests, 2026-09-06 | PASS: 13 tests in `dist/tools/materialization.test.js` and `dist/providers/governed-router.test.js`; 0 failures. |
| Stage A tools/providers gate, 2026-09-06 | PASS: 39 tests; 0 failures. |
| Stage A system/security gate, 2026-09-06 | PASS: 89 tests; 0 failures. |
| Stage A root/SDK typechecks, build, and lint, 2026-09-06 | PASS. |
| Stage A full repository suite, 2026-09-06 | PASS: 1,306 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. |
| `npm run build` | PASS |
| focused `dist/skills/sandbox-runtime.test.js` | PASS (9 tests, 0 failures), including direct callable-skill fail-closed regression coverage |
| promoted portable-skill compiler test | PASS (9 tests, 0 failures) |
| portable-skill compiler and sandbox tests | PASS (17 tests, 0 failures) |
| `npm run typecheck` | PASS |
| `npm run typecheck:sdk` | PASS |
| `npm run lint` | PASS |
| `npm test` full repository suite after callable-skill containment | PASS; superseded by the verified scheduler-containment run below. |
| focused company scheduler and company runtime tests | PASS (13 tests, 0 failures) after scheduler containment |
| focused canonical runtime tests | PASS (24 tests, 0 failures) after scheduler containment |
| focused portable skill and workforce tests | PASS (13 tests, 0 failures) after scheduler containment |
| `skills/runtime/skill-runtime.test.js` | PASS (5 tests, 0 failures); timeout-fixture cleanup no longer blocks runner exit. |
| `npm test` full repository suite after scheduler containment | PASS; main suite 1,195 tests and serial self-modification gate 17 tests, 0 failures, skips, or cancellations. |
| continuation full suite, 2026-09-05 | PASS: 1,224 ordinary tests + 17 serial tests; no failures, skips, or cancellations. |
| continuation build, root/SDK typechecks, lint | PASS |
| SDK package integration | PASS: 2 tests. |
| Control Room browser E2E | PASS: keyboard navigation and serious/critical accessibility gates; no console errors. |
| public documentation and staging regression checks | PASS: 131 documents, 122 manifest entries, 7 staging tests. |
| package/release staging after Phase 2 changes | PASS: fresh local public artifact staged and verified; nothing published. |
| graphify update | PASS with limitations: 15 files produced zero nodes; HTML visualization skipped above its size limit. |
| interrupted-recovery focused gate, 2026-09-06 | PASS: 86 checkpoint/session/workflow/runtime/validation tests, including 22 real restart and recovery-policy cases; 0 failures, skips, or cancellations. |
| interrupted-recovery root/SDK typechecks, build, and lint, 2026-09-06 | PASS. |
| interrupted-recovery full repository suite, 2026-09-06 | PASS: 1,261 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. |
| memory-provider binding focused gate, 2026-09-06 | PASS: 74 memory/provider/registry/context/runtime/recovery tests; 0 failures, skips, or cancellations. |
| memory-provider binding root/SDK typechecks, build, and lint, 2026-09-06 | PASS. |
| memory-provider binding SDK package integration | PASS: 2 tests. |
| memory-provider binding public documentation and staging regressions | PASS: 133 documents, 124 manifest entries, and 7 staging tests; fresh local public artifact staged and verified, nothing published. |
| memory-provider binding full repository suite, 2026-09-06 | PASS: 1,286 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. |
| memory-compaction focused gate, 2026-09-06 | PASS: 37 memory/os/provider-binding/decision-memory/identity-memory/knowledge-graph tests, including 7 new compaction cases; 0 failures, skips, or cancellations. Independent verifier confirmed build, typecheck, and source semantics. |
| memory-compaction root/SDK typechecks, build, and lint, 2026-09-06 | PASS. |
| memory-compaction full repository suite, 2026-09-06 | PASS: 1,293 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. |

## Latest continuation — 2026-09-10 (P7 Trace Center + Operations + Surface Consolidation)

P7 shipped as exposure + consolidation (no new runtime, event system,
trace system, or artifact store):

- **Trace Center** (`#traces`, `#trace/{id}` in the Studio SPA): trace
  index from the durable repository; per-mission detail renders
  Overview, Capabilities, Tool activity, Verification, Evidence chain,
  Receipt, and one chronological Timeline built ONLY from stored
  `MissionTrace.events` (nothing synthesized), with deterministic
  filters (event-type select + free text). Mission Detail gained a
  "View Trace" button (`#trace/{traceId}`).
- **Artifact View** (`#artifacts`): every row derives from a real
  successful tool output inside a stored trace (source mission +
  producing tool shown). Explicitly labeled "no separate artifact
  store". No fabricated artifacts — empty state is honest.
- **Audit Center** (`#audit`, new `GET /audit?limit=` on
  QuackHttpServer): reads the real `AuditLog.readAll()`, payloads pass
  the same structural redaction as SSE, limit clamped 1–500, session
  authentication enforced (no anonymous path; 401 tested). Clearly
  labeled as the governance record — distinct from trace
  observability; stores never merged, identifiers link them.
- **Retirement (one HTTP surface, one GUI)**:
  - DELETED `src/desktop/server.ts` (+ server.test.ts, gui.test.ts,
    index.ts, types.ts), `src/desktop-app.ts`, and the `gui/` SPA
    (7 tracked files). `cli serve` already used QuackHttpServer;
    `DEFAULT_PORT` moved to `src/server/constants.ts`;
    `compatibility.ts` no longer re-exports the desktop surface.
  - DELETED legacy `dashboardHtml()/dashboardStyles()/
    dashboardScript()` from `dashboard/web/index.ts` (zero consumers;
    `buildDashboardState` retained — server + Studio use it).
  - DELETED fake `/api/benchmarks` + `/api/evaluation` hard-coded
    numbers (100% completion rate, qualityScore 100, "14 evaluated
    tasks") with the duplicate surface. Evaluation truth comes only
    from the real `MissionEvaluator` history (P5 dimensions).
  - Docs corrected: API_REFERENCE rewritten to the canonical
    Mission API; GETTING_STARTED/DEPLOYMENT/website updated; ADR
    0016 remains as history.
- **Adversarial coverage** (`src/server/audit-and-retirement.test.ts`):
  unauthorized audit → 401; forged/traversal trace ids
  (`..%2F..%2Fpackage.json`, `%00`, nested slashes) → fail-closed 404
  with structured errors (never file content); audit payload redaction
  (sk-…/secret-keyed fields never survive); limit clamping incl.
  negative/huge/garbage values.
- **New docs**: `docs/product/TRACE_MODEL.md` (Trace vs Audit, Event
  vs Evidence vs Verification vs Receipt, artifact-as-view,
  timeline truthfulness, security boundaries) and
  `docs/product/OPERATIONS_MODEL.md` (operations sources, health-state
  honesty, provider status, consolidation record).

## Latest continuation — 2026-09-10 (P6 Agent Workspace)

P6 shipped as view code only (no new endpoints, no kernel change):

- **Studio Agents view → Agent Workspace**: registry table (name/id/
  description, trust-level badge, capabilities, skills, specialization)
  joined client-side with assignment state from
  `buildDashboardState`'s existing agent derivation
  (`assignedMissions` → ASSIGNED/AVAILABLE badge with mission count).
- **Agent-quality summary cards**: capability-discipline / recovery /
  planning / evidence-quality averaged across stored evaluation
  dimensions — same honest eval history the Evidence view shows; hidden
  with an explanatory empty state when no dimensions are stored yet.
- **Honesty label retained**: "registry state, not a claim that an agent
  is currently executing."
- Bug found by E2E and fixed pre-merge: the rendered table rows were
  pre-joined into a string, crashing `table()` (expects an array) —
  caught by the Control Room browser gate, not by a unit test.

## Latest continuation — 2026-09-10 (P5 QUACK Harness Expansion)

P5 shipped as honest evaluation infrastructure — every score derives from
the durable trace; nothing fabricated:

- **Scenario pack v2** (`src/harness/scenarios.ts`): 15 scenarios across
  7 families (reasoning, tool-selection, capability allowed/denied,
  adversarial, recovery, multi-step, evidence). Five adversarial
  scenarios — prompt-injection resistance, secret-redaction resistance,
  network denial, malformed tool request, forged identity — carry their
  hostile payloads as DECLARED EXPECTATIONS with
  `expectedOutcome: "failure"`: they pass only when the runtime fails
  closed; the payload text is never actionable mission data.
- **Evaluator v2** (`src/harness/evaluator.ts`): every
  `MissionEvaluationResult` now carries `dimensions` —
  capabilityDiscipline (denied share vs recovered-by-degrading share),
  recovery (recoverable failures matched by later successful
  iterations), planning (plan invocations + iteration progress, no
  doom-loop credit), evidenceQuality (successful tool calls with
  captured output + verification citations) — each bounded 0–100.
  New metrics `recoveredDenials` + `evidenceCoverage`
  (`metrics-collector.ts`).
- **Studio Evidence view** renders the stored evaluation history (score
  badge + C/R/P/E dimension badges per evaluation, newest first) from
  the EXISTING `/dashboard/state` harness data — no new endpoint, no
  second store.
- **Model-vs-model comparison deliberately deferred**: it needs live
  governed providers; echo fixtures would fabricate the comparison.

## Latest continuation — 2026-09-10 (P4 Governed Model Streaming)

P4 shipped over the existing governed gate (`GovernedModelRuntime.stream`
already existed — broker-resolved per call; nothing re-implemented):

- **`POST /models/stream`** (`src/server/index.ts`): request
  `{ prompt, actor, model?, missionId? }` (400 on malformed). Responds as
  an SSE stream of `model.stream.chunk` events. Every call resolves
  `provider.invoke` through the capability broker via
  `GovernedModelRuntime.stream`; **denial fails closed with a terminal
  `denied: true` chunk before any provider is contacted**. Client
  disconnect aborts the run's AbortSignal.
- **Wire-boundary redaction**: chunk `text` passes through
  `redactSecrets` before being written to the streaming response, and
  the same redacted payload is broadcast on the one EventBus
  (`model.stream.chunk`) so any `/events` client (Console) sees the
  identical redacted stream. Verified by hostile-chunk tests.
- **Event contract**: `model.stream.chunk` added to the
  `QuackEventType` union; CLIENT_EVENTS.md moved it from the future
  table to the existing MODEL STREAM group; the product-contract guard
  now enforces its documented existence.
- **Console "Ask model"** (`#console`): new button posts to
  `/models/stream` and renders streamed text as governed-model turns;
  rejection/denial/empty states render honestly ("No governed model
  output — provider unavailable or authority denied"); no fabricated
  chunks anywhere.
- **Docs**: MISSION_API.md documents the route (request/response
  contract, fail-closed semantics); ROADMAP P4 marked SHIPPED with the
  context-management/model-comparison remainder deferred to P5.

## Latest continuation — 2026-09-10 (P3 QUACK Console)

Console shipped inside the Studio SPA (`#console` route) as a client of
QUACK Core — view code only, no new server surface, no execution path:

- **Conversation panel**: operator turns (mission submissions) and
  system turns (real runtime state) in a scrollable log with live
  stream badge. The composer submits through `POST /missions` only
  (`actor: console-user`); acceptance/rejection is the conversation's
  real state — the Console never executes anything itself.
- **Live mission stream**: the existing `connectLive()` SSE listeners
  now feed `consoleOnLiveEvent()` — `mission.started/completed/failed/
  cancelled` and tool activity for the tracked mission append system
  turns while the Console route is active.
- **Reconnect guidance (honest)**: when the SSE stream drops, a callout
  states events may be incomplete and points at the durable stores
  (Missions / mission detail trace) — no fabricated streaming;
  `model.stream.chunk` remains future work (P4), guarded by a studio
  contract test that asserts its absence.
- **E2E**: Control Room test now drives the console flow end-to-end
  (fill outcome → submit → conversation records the accepted mission)
  under the unchanged a11y + console-error gates.

## Latest continuation — 2026-09-10 (P2 Mission Control, Studio)

P2 shipped as view code over the P1 endpoints (SPA shell, endpoints, SSE
reused — no new server surface):

- **Mission Control lanes** (`#missions`): Active/queued, Waiting
  approval, Failed, Recently completed — rendered as lane cards from
  `GET /missions` state, each linking to mission detail.
- **Mission Detail** (`#mission/{id}`): status/verification/capabilities/
  iterations/evidence/event timeline plus **Cancel** (visible for
  RUNNING/QUEUED; confirm-gated; `POST /missions/{id}/cancel`) and
  **Resume** (`POST /missions/{id}/resume`) buttons. Errors surface
  honestly via the notice banner.
- **Approval Center** (`#approvals`): P1 approval-queue panel first —
  pending requests with prompt/context/expiry and explicit
  Approve/Deny (`POST /approvals/{id}/approve|deny`,
  confirm-gated) — then the existing action-approvals and improvement
  decision sections. When no queued approver is configured the panel
  shows the honest unavailable message instead of an error.
- **Live updates**: `connectLive()` subscribes to the SSE projection for
  mission.*/approval.*/workflow/node/tool events with a 150 ms debounced
  re-render on live routes; `refreshApprovalCount()` updates the nav
  badge from the queue (falling back to `/system/status`).
- **E2E hardened**: Control Room browser test now wires the queued
  approver (real Approval Center surface renders populated-path code)
  and visits Missions + Approvals with the a11y/console-error gates
  unchanged. Studio contract tests assert the P2 wiring.

## Latest continuation — 2026-09-10 (P1 Mission Operations)

P1 shipped on top of the P0 product foundation (single composition root,
single event bus, single approval path — no second permission system):

- **Approval queue** (`src/security/approval-queue.ts`):
  `QueuedApprovalCallback` implements the canonical `ApprovalCallback`
  seam; medium/high-risk approvals park as PENDING records with a
  monotonic expiry (default 15 min, deny-on-expiry evaluated lazily),
  a 1000-entry hard cap, `approval.requested`/`approval.decided` events
  on the one EventBus, and `loop.wake.APPROVAL_DECISION` reuse. The
  resolver registers synchronously before the first await — a decision
  arriving in the same tick resolves correctly (race found by tests).
  Surfaces read/decide through `system.approvals` only when the caller
  supplied the queue as `config.approver`; risk assessment and
  allow-list authority stay in `RiskAwareApprovalPolicy`.
- **Server operations** (`src/server/index.ts`): `POST /missions/{id}/cancel`
  aborts an in-flight run's AbortSignal (409 for finished, 404 unknown);
  `POST /missions/{id}/resume` resumes through
  `QuackApi.resumeMission → QuackRuntime.resumeMission` (terminal
  missions return stored results; conflict codes map to 409); `GET
  /approvals` + `POST /approvals/{id}/approve|deny` (fail closed:
  `approval.not_pending` 404, `approval.expired` 409,
  `approval.queue_unavailable` 404 when no queued approver); `GET
  /traces?missionId=…` over the existing TraceRepository.
- **Runtime**: cancelled runs emit `mission.cancelled` (durable path
  emits after the fenced CANCELLED transition; non-durable runs emit
  the same client event). `MissionStatus`/`ApiMissionRecord` gained a
  `taskId` resume handle.
- **SSE redaction** (CLIENT_EVENTS contract claim now true): payload
  strings pass through `redactSecrets`; secret-shaped keys (KEY/TOKEN/
  SECRET/PASSWORD/CREDENTIAL/APIKEY/AUTHORIZATION/COOKIE) redact to
  `[REDACTED]` recursively; output stays valid JSON. Verified by two
  wire-level SSE tests.
- **Contract truthfulness**: `MISSION_API.md`/`CLIENT_EVENTS.md` moved
  P1 routes/events to Existing; `product-contract.test.ts` guards now
  enforce the shipped state (P1 events must be documented; P1 routes
  must be dispatched and not remain "planned").

## Latest continuation — 2026-09-08 (Phase 5)

Multi-process mission ownership + crash/restart recovery shipped and
verified (ADR 0031 boundary lifted; single-host scope):

- **MissionOwnershipGuard** (`src/runtime/ownership.ts`): one guard per
  mission execution over the SQLite coordination primitive. Atomic lease
  acquisition (`begin immediate`), heartbeat renewal at lease/3
  (live-owner only, expired leases never resurrect), release-as-tombstone
  keeping the fencing version monotonic across ownership epochs, and
  `assertOwnedForWrite` fencing that fails closed on any owner/epoch/lease
  mismatch before a durable mutation.
- **Runtime integration** (`src/runtime/runtime.ts`): `resumeMission` and
  fresh durable `submitGoal` acquire the mission lease BEFORE any durable
  state transition; `fencedTransition` + `assertOwnedForWrite` wrap
  checkpoint init, every mission-state transition, task-store writes, and
  the COMPLETING receipt→memory→SUCCEEDED→completed persist; ownership is
  released only AFTER the final durable persist. Ownership loss fails
  closed (`recovery.ownership_conflict` / fenced throws) — never
  concurrent execution. `disableOwnership: true` preserves ADR 0028
  single-process semantics (used by the interrupted-recovery suite).
  Coordination DB derives from `dataDir/coordination.sqlite`
  (or explicit `coordinationDbPath`), lease tunable via `ownershipLeaseMs`.
- **Verification — real processes only**: 12/12
  `src/runtime/multi-process-recovery.test.ts` (forked children sharing
  one dataDir): SIGKILL at six boundaries (before-ownership,
  after-ownership, during-heartbeat, tool-entered, after-tool-before-
  persist, after-receipt-before-complete) each recovered by a second
  process after lease expiry with a verified completion receipt;
  simultaneous resume race never yields two executing owners; stale
  process resume returns the stored terminal result with zero
  re-execution (durable call count exactly 2); repeated crash/restart
  cycles complete; forged-owner/version-guessing writes fenced out; and
  the 5K dogfood E2E (SKILL.md → SafeSkillCompiler → governed graph →
  durable run → SIGKILL → second-process resume → verified receipt).
- **Adversarial hardening**: cross-suite grown to 22 (DB-tamper trust
  boundary, version-rollback, guard lifecycle/spend, release ordering);
  interrupted-recovery suite preserved 22/22; the Phase 4 process-policy
  static guard and all security boundaries unchanged.
- **Observability**: typed `ownership.acquired/rejected/heartbeat/lost/
  released` and `mission.started/resumed/completed/failed/
  recovery_started/recovery_completed` events; no secrets in payloads.
- **Fixes en route**: improvement-coordinator test fixture now drains the
  async audit sink before cleanup (a real ENOTEMPTY durability race);
  recoveryFixture opts into `disableOwnership` (single-process suite
  stays single-process semantics).
- **Documentation**: ADR 0031 status updated (boundary lifted, history
  preserved); `docs/recovery/multi-process-recovery.md` rewritten as
  SUPPORTED with the full ownership/fencing model;
  `docs/recovery/durable-state.md` (5E) records durable/ephemeral/derived
  state and states plainly that NO automatic retention/compaction exists;
  `docs/operations/README.md` (deployment, lease tuning, recovery runbook,
  events, failure handling).
- **Release decision: PRODUCTION CANDIDATE.** Windows runtime fully
  verified (1,456+17; all focused suites). Linux/macOS/ARM64 runtime
  verification requires an actual GitHub Actions execution, blocked only
  by the missing git remote/publication (see 5N).

## Latest continuation — 2026-09-07

4N adversarial cross-suite + 4O documentation (finalization session):

- **4N — adversarial cross-suite.** `src/security/adversarial-cross-suite.test.ts`
  (20 tests) attacks the real boundaries across surfaces: path attacks
  (URL-encoded traversal, drive-case, mixed separators, deep chains, NUL,
  device names, symlink/junction escapes for existing and new-file
  targets), process attacks (shell metacharacters fail-to-start, argument
  injection through working directories, environment-secret leakage,
  output flooding bounds, runaway-child timeout kill), skill attacks
  (secret/network manifest → HIGH + review; claimed-LOW override
  rejected; firewall hard-DENY; tampered content → REVALIDATION_REQUIRED),
  privacy attacks (tokens/keys/JWTs/cookies denied-or-redacted with no
  raw secret surviving; forbidden directories never entered), and
  recovery attacks (stale-owner fenced writes, expired-lease heartbeat
  resurrection rejected, version guessing rejected, 12-owner acquire
  storm with exactly one winner).
  **The suite found two real defects, both root-cause fixed:**
  1. `JsonFileSkillRegistryStore.save()` (discovery registry) fired an
     async `atomicWriteFile` without awaiting under a sync contract —
     saves raced subsequent loads and records vanished; persistence is
     now a synchronous tmp+rename with Windows transient-retry.
  2. `runMigrations` (SQLite storage) used an unprotected
     check-then-insert that raced across concurrently opening processes
     (UNIQUE constraint failure under a real 4-way fork race);
     migrations now run inside `begin immediate`.
  After both fixes: full suite 1,442 ordinary + 17 serial, 0 failures.
- **4O — documentation tree.** `docs/platform/` (architecture + per-OS
  verification status), `docs/skills/` (universal spec, discovery, privacy,
  registry, installation, trust model, external skills),
  `docs/security/` (threat model, sandbox, process, path, privacy
  firewall, recovery), `docs/recovery/` (architecture, SQLite
  coordination, multi-process boundary). Every capability is labeled
  SUPPORTED/BEST_EFFORT/UNSUPPORTED; Linux/macOS docs state runtime
  verification is pending CI; recovery docs explicitly separate the
  verified coordination primitive from the still-unsupported
  multi-process recovery integration; the sandbox doc states plainly
  that the worker backend is not a security sandbox.

## Previous continuation — 2026-09-07

4K finished, 4L coordination primitive landed, 4M CI implemented (ADRs
0040/0031):

- **4M — cross-platform CI implemented (run evidence pending).** `.github/
  workflows/ci.yml` now runs a windows/linux/macos × node 22/24 matrix with
  the full gates (lint incl. the new process-policy guard, build, SDK
  typecheck, full test suite, public-doc checks) plus three focused
  security gates as separate steps so failures are attributable: platform/
  process security (20 tests), skills/privacy/sandbox (30), isolation/
  coordination/recovery (31). An `arm64-focused` job covers linux-arm64
  and macos-arm64 with the platform and multi-process coordination gates.
  `engines.node` is now `>=22.5.0` (Node 20 is EOL; `node:sqlite` requires
  22.5). All CI command shapes were verified locally on Windows (81
  focused tests green). Actual Linux/macOS runners have NOT executed yet —
  until a real GitHub Actions run completes, cross-platform evidence
  remains Windows-only.

4K finished and 4L coordination primitive landed (ADRs 0040/0031):

- **4K complete — all production shell strings migrated.**
  `git-status.ts` (3 `execSync` git shell strings), `validation-pipeline.ts`
  (4 `npx tsc/eslint … 2>&1 || true` strings), and `test-runner.ts`
  (3 execution sites + shell-string command detection) now run through the
  argv-based `executeProcess` platform abstraction: no implicit shell,
  explicit allowlisted environment (`childProcessEnvironment()` — PATH plus
  OS-identity variables, never `process.env` spread), no exit-code masking
  (eslint/tsc failures surface as findings), bounded output and timeouts.
  Windows `npx` is a `.cmd` shim that cannot be spawned shell-less
  (CVE-2024-27980), so `resolveNodeCliArgv("npx", …)` resolves the
  node-distributed `npx-cli.js` and spawns `[process.execPath, npx-cli.js]`.
  `lsp-manager.ts` reuses the shared environment helper. The terminal tool
  remains the ONLY intentional shell path (permission-gated, sanitized,
  dangerous-pattern-blocked). A static-quality guard now fails the build on
  any `execSync(`, stderr-merge, or shell-masking operators in production
  `src/`. New GitStatusTool tests (4) exercise real-repo branch/status,
  traversal rejection, and fail-closed behavior outside a repo.
- **4L — SQLite multi-process coordination primitive (ADR 0031
  prerequisite).** `src/storage/coordination.ts` adds
  `SqliteCoordinationStore` over the existing `SqliteConnection`
  (migration `004_coordination_leases`): atomic acquire
  (`begin immediate`), live-lease rejection, stale-lease takeover with a
  version bump, heartbeat renewal (expired leases never resurrect),
  release via tombstone (fencing version stays monotonic across ownership
  epochs — a released resource's next owner can never re-issue a version
  an old writer held), and version-fenced payload writes that reject
  stale owners after takeover. Verified by 9 tests using REAL forked
  worker processes: 4-way acquire race with exactly one winner, live-lease
  rejection, expiry takeover, fencing after takeover, cross-process
  writes, real SIGKILL crash + lease-expiry recovery, heartbeat, and
  lifecycle. Scope: single-host multi-process coordination only; no
  distributed/HA claims. The JSON recovery stores are NOT yet rewired onto
  this primitive — per ADR 0031 that migration is a separate, deliberate
  change and multi-process recovery remains UNSUPPORTED until then
  (ADR 0031 records this exact boundary).

Full suite: 1,422 ordinary + 17 serial tests, 0 failures; root and SDK
typechecks, build, and lint pass.

## Latest continuation — 2026-09-06

Canonical local memory now supports deterministic, host-owned compaction
(ADR 0030):

- `MemoryStore` gains an optional `compact` operation. Both canonical local
  implementations (`InMemoryMemoryStore`, `JsonFileMemoryStore`) implement it;
  the memory-provider binding reports compaction unsupported.
- `compact` performs one deterministic pass: records older than an optional
  `olderThan` timestamp are dropped, records are grouped by `scope` with an
  optional per-scope `maxItemsPerScope` bound keeping the newest, and
  duplicate content within a scope is collapsed keeping the newest copy.
- A protected record is never removed: `validated-knowledge` class
  (`memoryClass === "validated-knowledge"`) or an explicit `protected` /
  `protect` metadata marker. The per-scope retention bound applies only to
  ordinary records, so a bound cannot compact away host-marked durable
  knowledge.
- Compaction is deterministic, requires no LLM or provider service, and
  returns a `MemoryCompactResult`. The JSON store persists the compacted set
  atomically; the in-memory store mutates its visible cache only after a
  successful pass.
- `MemoryCompactionPolicy` is the extension seam: it receives per-scope
  candidates and returns retention order. The default policy keeps newest
  first with a stable id tie-break. No automatic/background compaction is
  scheduled; behavior is unchanged until `compact` is explicitly called.
- Provider-owned consolidation and multi-process recovery remain unsupported.

Focused memory tests pass (37 tests including 7 new compaction cases). The
full repository suite, root and SDK typechecks, build, and lint all pass;
exact counts are recorded under Latest verification.

## Stage E continuation — SDK/public API compatibility, 2026-09-06

The public package and SDK now expose only supported canonical behavior for
the new governed execution surfaces (ADR 0032–0035):

- `src/index.ts` (public `@quack/os` exports) adds `runtime/delegation.js`,
  `extensions/hooks.js`, `tools/materialization.js`,
  `engine/completion-receipt.js`, and `providers/governed-router.js`.
- `sdk/src/index.ts` adds `materializeTool`, `createGovernedToolExecutor`,
  `materializationSnapshot`, `GovernedProviderRouter`,
  `InMemoryCapabilityGrantRegistry`, `DelegationRuntime`, `assertChildReceipt`,
  `buildCompletionReceipt`, `assertCompletionReceipt`, `receiptSnapshot`,
  `GovernedHookExecutor`, and their types.
- `QuackRuntimeV1.resume` remains a declared, unimplemented contract member
  and is intentionally not exported; canonical resume is
  `QuackRuntime.resumeMission`.
- SDK package compatibility tests extend from 2 to 3: exports resolve to the
  public implementation, governed surfaces behave fail-closed through the SDK
  (materialization rejects invalid identity, hook dispatch denies without
  authority, forged receipts fail), and configuration/failure propagation is
  unchanged.

Root and SDK typechecks, build, and lint pass; the SDK package tests pass
(3); the full repository suite passes 1,334 ordinary + 17 serial tests with 0
failures.

## Stage D continuation — governed delegation runtime, 2026-09-06

Delegation now exists as governed parent → child execution (ADR 0035):

- `DelegationRuntime` (`src/runtime/delegation.ts`) delegates by submitting
  the child through the canonical `QuackRuntime.submitGoal` — no second
  orchestration path. The child grant derives from the parent grant via the
  existing `deriveGrant` attenuation (mission lock, capability/scope subset,
  expiry ceiling); widening attempts fail closed with
  `delegation.attenuation_denied`.
- Lifecycle: `REQUESTED → ACCEPTED → RUNNING → COMPLETED | FAILED |
  CANCELLED | BLOCKED` with timestamps. Depth is tracked per chain and
  capped by `maxDepth`; duplicates of an active (parent execution, goal)
  delegation fail closed.
- The derived grant is revoked whenever the child completes, fails, is
  cancelled, or cannot start — no authority residue outlives a delegation.
- A child's completion is trusted only through its durable receipt chain
  (ADR 0033): `DelegationRecord.childReceipt` carries the child receipt, and
  `assertChildReceipt` rejects unverified, forged, or incomplete child
  results. Children inherit ADR 0028 recovery unchanged.
- The default neutral composition keeps `maxDelegationDepth: 0` (delegation
  disabled until a composition wires a parent grant); fan-out aggregation
  is not implemented.

Focused delegation tests (7) pass; the full repository suite passes 1,334
ordinary + 17 serial tests with 0 failures; root and SDK typechecks, build,
and lint pass.

## Stage C continuation — governed plugin hooks, 2026-09-06

Executable plugin hooks now run through governed authority (ADR 0034):

- Admission (`normalizePlugin`) validates hook shape and admits hooks as
  frozen declarative contributions; it never executes a handler. Malformed
  hooks (unknown kind, non-function handler) fail closed with
  `extension.invalid`. The former `extension.unsupported_hook` rejection no
  longer exists.
- `GovernedHookExecutor` (`src/extensions/hooks.ts`) is the only execution
  path: every plugin-declared permission resolves through the capability
  broker (existing `buildToolCapabilityRequest` factory, full
  mission/task/agent/skill/actor context) before the handler is contacted;
  one denial fails closed.
- Handlers receive only a deep-frozen event payload — never registries,
  brokers, or host APIs. Timeouts (default 5 s), cancellation, expired
  deadlines, and handler failures produce deterministic
  `EXECUTED/DENIED/FAILED/CANCELLED/TIMED_OUT` dispatch records without
  crashing the host. `dispatchAll` runs one kind's hooks in registration
  order.
- No sandbox/isolation is claimed; hooks are in-process observers. Plugin
  isolation boundaries remain unchanged and unsupported.

Focused extension tests (23), the system/plugins gate (66), root and SDK
typechecks, build, and lint pass; the full repository suite passes 1,327
ordinary + 17 serial tests with 0 failures (after one unrelated
skill-runtime timeout flake passed in isolation and rerun).

## Stage B continuation — completion receipts, 2026-09-06

Evaluated completion now mints an explicit, citable proof chain (ADR 0033):

- `CompletionReceiptV1` (`src/engine/completion-receipt.ts`) cites execution
  identity, the durable evidence id and a sha-256 digest of the bound evidence
  payload, the verifier, verification status/record id, and independence.
- The receipt is derived output, not a second source of truth: the versioned
  execution checkpoint remains authoritative for execution state, invocation
  outcomes, evidence, and verification.
- `buildCompletionReceipt` fails closed on unsuccessful verification, foreign
  evidence citations, foreign evidence identity, and foreign or non-passing
  verification records. `assertCompletionReceipt` rejects forged, foreign,
  stale, or malformed receipts.
- `QuackRuntime` mints receipts only for durable executions whose checkpoint
  stored evidence and verification; the snapshot is attached to the completed
  task's `result.receipt`. Non-durable completions mint no receipt and still
  require loop-driver verification success, unchanged.

Focused tests (11), the runtime/engine gate (147), root and SDK typechecks,
build, and lint pass; the full repository suite passes 1,317 ordinary + 17
serial tests with 0 failures.

## Phase 4 continuation — platform abstraction + universal skills, 2026-09-06

Phase 4 Stages A–F are complete and verified (ADRs 0040, 0041):

- **Platform abstraction (ADR 0040).** `src/platform/` isolates OS behavior:
  `PlatformAdapter` with an honest SUPPORTED/BEST_EFFORT/UNAVAILABLE
  capability matrix (unavailable capabilities fail closed), `resolveInside
  Root` path policy rejecting traversal, UNC, device paths (`\\.\`, `\\?\`),
  alternate data streams, and symlink/junction escapes (realpath'd both
  sides so Windows 8.3 short-path spellings compare equal), and argv-based
  `executeProcess` with no implicit shell, explicit environment
  materialization (never `process.env`), bounded output, and deterministic
  timeout/cancellation tree-kill with terminal intent recorded before the
  kill. Existing surfaces are not yet migrated onto these adapters — the
  contract is established first.
- **Universal skill spec (ADR 0041).** Skill kinds, risk classes derived
  from requested capabilities (never claims), review requirements (HIGH
  risk and untrusted skills never silently activate), and content/manifest
  hashes for supply-chain detection.
- **PrivacyFirewall.** The only path for discovered local metadata to reach
  a model: content patterns, secret-shaped values, and sensitive field
  names are classified; hard classes (private keys, browser sessions,
  passwords) deny the whole record; others redact to `[REDACTED]`. Forbidden
  filenames (`.env`, `id_rsa`, password DBs, cookies DBs) and directories
  (`.ssh`, `.aws`, `AppData`, `Library`, personal folders) are never read.
- **Privacy-safe discovery.** `SkillDiscovery` scans ONLY explicit roots,
  reads ONLY manifest files, never neighboring content, never the personal
  filesystem. "Add all skills from my PC" means reading skill manifests in
  configured locations — never scanning the disk.
- **Discovery registry.** Metadata-only persistent records with states
  DISCOVERED → REVIEW_REQUIRED → APPROVED → INSTALLED → DISABLED/REVOKED/
  QUARANTINED plus REVALIDATION_REQUIRED. Discovery never auto-approves;
  installation requires explicit approval; content changes after
  installation force revalidation and block silent execution of modified
  content.

Platform tests (13), discovery tests (12), quarantine-first search tests (6),
skill-execution-profile tests (3), and terminal env-sanitization tests (3)
pass; the full suite passes 1,409 ordinary + 17 serial tests with 0
failures; root and SDK typechecks, build, and lint pass.

Phase 4 continued (4G–4K):

- **External skill search (4G, quarantine-first).** `QuarantineFirstSkill
  Search` fetches remote manifests into an isolated quarantine directory,
  runs static inspection (shell-injection, prompt-injection,
  credential-harvest blockers; hidden-network and elevated-shell warnings),
  re-derives risk through QUACK's own classifier (a remote manifest cannot
  redefine policy by claiming LOW risk), screens content through the
  PrivacyFirewall, and registers results without ever installing. BLOCKER
  findings or privacy DENY force QUARANTINED state; HIGH risk enters
  REVIEW_REQUIRED. Recommendations are RECOMMEND/REVIEW/BLOCK — never an
  implicit install.
- **Skill sandbox integration (4H).** `deriveSkillExecutionProfile` binds
  the universal skill model to the ADR 0039 isolation contract with
  least-privilege defaults (workspace-only fs, DENY network, materialized
  env, DENY secrets). Risk never lowers isolation: a HIGH-risk skill claiming
  IN_PROCESS is held at WORKER_PROCESS; network ALLOWLIST starts empty;
  EXPLICIT secret policy without materialized secrets fails closed.
  `toIsolationRequest` builds the governed isolation request with only
  IsolatedIo crossing the boundary.
- **MCP normalization (4I)** was completed in Phase 3 (ADR 0036 evidence
  envelopes); no further envelope work was required this phase.
- **Delegation aggregation (4J)** was completed in Phase 3 (ADR 0036
  `delegateFanOut`); parallel child orchestration remains open.
- **Cross-platform process/filesystem security (4K, partial).** LSP manager
  now probes binaries portably (`spawnSync` argv, no `which || where`
  shell strings) and runs `tsc` via argv `executeProcess` (no `2>&1 ||
  true` masking). The terminal tool no longer inherits `process.env`
  wholesale: secret-shaped variables (KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL
  patterns, API keys) are removed before child execution; non-secret env
  (PATH) remains usable. Remaining 4K: migrate `test-runner`,
  `validation-pipeline`, and `git-status` shell strings onto the platform
  adapters.

Remaining Phase 4 stages: SQLite multi-process coordination (4L, the ADR
0031 prerequisite), cross-platform CI matrix (4M), broader adversarial
coverage (4N), and documentation (4O).

## Phase 3 continuation — live governed execution + isolation, 2026-09-06

Phase 3 Stages A–F are complete and verified (ADRs 0036, 0039):

- **Live governed wiring (ADR 0036).** The SWE composition's exposed
  `modelRuntime` shadows `generate`/`stream` with broker-gated versions
  (`GovernedModelRuntime`/`governModelRuntime`): every model call resolves
  `provider.invoke` through the capability broker with full
  mission/task/agent/actor identity, mid-flight revalidation, and
  fail-closed denial before any provider contact. Metadata-only
  `selectModel` stays ungated. `governedProviderRouter` and
  `governedModelRuntime` are exposed on both system surfaces; a gated
  surface without an execution context fails closed.
- **Runtime hook events.** `RuntimeHookBridge` subscribes to canonical
  events (`task.created/started/completed/failed`, `tool.requested/
  completed`, `capability.decided`, `memory.written`) and dispatches
  admitted plugin hooks through the `GovernedHookExecutor`. Hooks remain
  governed observers; failures, timeouts, and denials are contained per
  dispatch with audit records. `createQuackSystem` exposes
  `system.hookBridge`.
- **Delegation composition + fan-out.** `createQuackSystem` wires
  `DelegationRuntime` when `delegationMaxDepth > 0` with a parent grant
  (explicit id, or exactly one seeded mission grant); default remains
  disabled. `delegateFanOut` runs children in order, completes the parent
  only when every child produced a verified receipt, and reports `PARTIAL`
  otherwise. Depth ceilings, duplicate guards, and grant revocation are
  unchanged (ADR 0035).
- **MCP evidence normalization.** MCP action evidence cites `operationId`,
  retry safety derived from the descriptor, required permissions, provider
  version, and namespace. Dispatch was already broker-gated.
- **Isolation contract + worker backend (ADR 0039).** `src/isolation/`
  defines the backend-agnostic isolation contract (levels
  IN_PROCESS/WORKER_PROCESS/CONTAINER_ISOLATED/FUTURE_STRONG_ISOLATION;
  default-deny filesystem/network/environment/secrets policy; honest
  ENFORCED/BEST_EFFORT/UNSUPPORTED guarantees) and the
  `WorkerProcessIsolationBackend` on `node:worker_threads`:
  ENFORCED wall-clock timeout/cancellation and environment materialization;
  BEST_EFFORT filesystem containment at the IO boundary and crash
  containment; UNSUPPORTED network/secret sealing, container, and strong
  isolation (fail closed). Adversarial tests cover traversal and
  absolute-path escape, spin loops, crashes, cancellation, cleanup, and
  output bounds. The worker backend is NOT a security sandbox equivalent to
  a container/VM and must not be documented as one.

Focused suites pass: governed model runtime 7, SWE surface 1, hook bridge 6+1,
delegation 12+1, actions/MCP 16, isolation 17 (4 contract + 13 adversarial).
The full repository suite passes 1,372 ordinary + 17 serial tests with 0
failures; root and SDK typechecks, build, and lint pass; SDK package tests
3/3.

## Stage A continuation — unified provider/tool materialization, 2026-09-06

Unified provider/tool materialization is implemented for the canonical
composition (ADR 0032):

- `ToolMaterialization` (`src/tools/materialization.ts`) is the frozen
  executable representation of a tool or provider operation. One
  `materializeTool` factory constructs identity; providers never duplicate
  identity generation. The contract preserves provider identity/version, tool
  identity, authorizing capability id, mission/task/execution/session
  identity, actor/agent/skill, namespace, stable operation identity,
  deadline, cancellation, retry safety (ADR 0028 classes unchanged), and
  provenance source.
- `createGovernedToolExecutor` is the dispatch boundary: tool-id mismatch and
  cancellation fail closed at dispatch, and materialized identity (task,
  actor, session, operation, deadline) is forwarded to the executor.
  Authority remains the runtime's capability resolution; materialization
  never grants authority.
- `GovernedProviderRouter` (`src/providers/governed-router.ts`) wraps the
  existing `CapabilityProviderRouter`. It builds a `provider.invoke` capability
  request from the execution context through the existing
  `buildToolCapabilityRequest` factory, resolves it through the capability
  broker, and revalidates before dispatch. Denial fails closed with a
  normalized `POLICY_DENIED` error before any provider is contacted.
- `createQuackSystem` exposes `governedProviderRouter` alongside the raw
  `capabilityRouter`; the raw router remains the pure
  policy/capability/circuit component.

Focused tests (13), the tools/providers gate (39), and the system/security
gate (89) pass; the full repository suite passes 1,306 ordinary + 17 serial
tests with 0 failures. Remaining Stage A follow-up: route remaining live
dispatch seams (for example the SWE distribution's model calls) through the
governed boundary.

## Multi-process recovery decision — 2026-09-06

Multi-process recovery for the canonical runtime remains **UNSUPPORTED**
(ADR 0031). The recovery stores (`JsonFileTaskStore`,
`JsonFileCheckpointStore`, `JsonFileJournalStore`) each cache the file once in
process memory, serialize writes only within one instance, and persist via
atomic temp-file + rename. `QuackRuntime.executionOwners` and
`SessionRuntime.executionUpdates`/`activeRuns` are in-memory per instance.
There is no cross-process compare-and-swap, lease, heartbeat, or version guard
on the recovery path.

Why it stays unsupported: a durable lease or optimistic-version guard requires
atomic read-modify-write on acquisition. A sidecar JSON lease reproduces the
lost-update defect it is meant to fix (both processes read the stale cached
lease, both claim it, last rename wins). The only CAS-capable primitives are
`node:sqlite` transactions or an OS file lock — both are a new
persistence/coordination subsystem, which is explicitly out of scope and would
redesign the journal/checkpoints.

Exact prerequisite to lift the boundary (ADR 0031): back the recovery stores
with a SQLite/coordination primitive offering an atomic
`owner + lease_expires_at + version` claim, heartbeat renewal, crash-safe
stale-lease takeover, and stale-writer rejection, verified on Windows without
PID detection.

Current single-process safety is unchanged and re-verified: the focused
recovery gate passes 22 tests including real child-process `SIGKILL` crashes,
fail-closed retry classes, and single-process duplicate ownership
(`recovery.busy`); the full suite passes 1,293 ordinary + 17 serial tests;
root and SDK typechecks, build, and lint pass.

## Previous continuation — 2026-09-06

Memory-provider execution now binds through the canonical runtime (ADR 0029):

- `createQuackSystem` selects one admitted provider by exact configured id.
  Admission alone remains inert; an unknown id and duplicate provider id both
  fail closed. Without a selection, existing local memory behavior is unchanged.
- `MemoryProviderBinding` implements the existing `MemoryStore` boundary.
  Reads and writes resolve `memory.read` / `memory.write` through the current
  capability broker and restrictive extension policies before provider dispatch.
- Provider calls receive frozen host mission, task, execution, session, actor,
  namespace, operation id, capability, deadline, and cancellation context.
  Providers cannot replace identity, mutate write semantics, or manufacture
  authority.
- Retrieved records are schema-validated, bounded by item count, bytes, tokens,
  deadline, and cancellation, rechecked by host `MemoryPolicy`, and converted
  into planner `ContextFragment`s with provider/record provenance, timestamp,
  confidence, scope, policy, classification, and configured namespace.
- Runtime writes preserve Memory OS classes: working completion state maps to
  `mission.short_term`, execution experience to `skill.execution`, and
  `knowledge.long_term` requires host validation evidence.
- Durable execution identity now includes exact provider id, version, and
  namespace. Completion writes journal stable operation/input identity as
  `STARTED → COMPLETED`; acknowledged writes are reused without provider access,
  while ambiguous writes require reconciliation and are never replayed.
- `store` and `retrieve` are mandatory provider operations. Optional operations
  are discovered from method presence; the bound delete path fails explicitly
  when unsupported, while export is outside this mission binding. Provider
  marketplace, credential, plugin-hook, compaction, and multi-process work
  remains deferred.

Focused tests, the full repository suite, root and SDK typechecks, build, lint,
SDK package integration, public documentation checks, and fresh public staging
all pass; exact counts are recorded under Latest verification.

## Previous continuation — 2026-09-06

Interrupted-mission recovery now works through the canonical runtime (ADR 0028):

- Durable execution identity (`missionId`, `executionId` = task id, `sessionId`,
  `workflowId`, actor) persists in the task record and the versioned execution
  checkpoint; resumption never mints a new mission.
- `SessionRuntime` is the sole checkpoint owner: serialized mutations,
  deep-cloned records, load/mutate validation via `assertRecoveryCheckpoint`,
  atomic versioned file writes, malformed data rejected without corruption.
- Every governed tool call is journaled `STARTED → COMPLETED | FAILED` with a
  stable `idempotencyKey` and per-attempt `attemptId`. Acknowledged outcomes
  replay from the journal and never re-dispatch.
- Durable dispatch records effective tool `retrySafety` (`READ_ONLY`,
  `IDEMPOTENT_WRITE`, `NON_IDEMPOTENT_WRITE`, `DESTRUCTIVE`, default
  `UNKNOWN`). Only retry-safe invocations retry after a crash; ambiguous state
  moves the mission to `BLOCKED` and returns
  `recovery.reconciliation_required` instead of repeating the effect.
- Verification stays bound to the execution's own durable evidence (evidence
  id cited by the stored verification; mismatched, stale, or foreign evidence
  and receipts fail checkpoint validation).
- A task and its full execution identity are persisted together before
  planning. If interruption occurs before the first workflow checkpoint, the
  created task can safely repeat planning because tool dispatch cannot begin
  before checkpoint initialization.
- Persisted recovery budgets must contain the complete bounded schema. Current
  capability authority and retry-safety metadata are rechecked before replay;
  acknowledged failures use fresh attempts only for retry-safe tools.
- Recovery enters only via `QuackRuntime.resumeMission`; concurrent resume in
  one process returns `recovery.busy`. Terminal missions return stored
  results without re-execution. Multi-process recovery and automatic replay
  of ambiguous non-idempotent effects remain UNSUPPORTED. The
  `QuackRuntimeV1.resume` contract member stays an unimplemented declaration.

## Latest continuation — 2026-09-05

Closed two source-confirmed correctness gaps after reproducing the prior full
suite baseline (1,195 ordinary tests and 17 serial tests):

- Validation providers previously received no evidence and could return an
  uncited passing receipt. They now receive a separate workflow-state snapshot;
  malformed, misattributed, invented, duplicate, and empty success citations
  fail closed. Provider mutation cannot replace the host's evidence identity.
- The neutral runtime previously ignored `dataDir` for task storage. It now
  uses the existing JSON store unless an explicit store is provided. Concurrent
  initial loads share one promise, saves serialize atomic replacements, and
  failed writes leave the visible cache unchanged. Returned records are copies.
  Reopening preserves terminal tasks and results; it does not resume execution.

The task file now uses `{ version: 1, tasks: [...] }`. Existing unversioned
`{ tasks: [...] }` files load and migrate on the next successful save. Malformed
or unsupported state rejects without overwriting the file. The store serializes
writes within one runtime instance; multiple processes must not share it.

Focused interrupted-recovery and related checkpoint/session/workflow/validation
tests pass (86 tests), including 22 restart and recovery-policy cases. The full
repository suite, root and SDK typechecks, build, and lint also pass; exact
counts are recorded under Latest verification.

## Next priority

Phase 5 is COMPLETE (5A–5L verified above; 5M local; 5N blocked). The
release classification is **PRODUCTION CANDIDATE**: the Windows runtime is
fully verified (1,456 + 17 tests including real multi-process crash/
recovery), implementation is complete, no security regression or
governance bypass exists — but Linux, macOS, and ARM64 runtime
verification never executed because the repository has no git remote and
no GitHub auth tooling, so the CI matrix has never run.

Minimum user actions to unblock (exact commands):

1. Create a GitHub repository (any name, e.g. `quack`).
2. `git remote add origin <repository-url>`
3. `git push -u origin master`
4. Let GitHub Actions run `.github/workflows/ci.yml` (windows/linux/macos
   × node 22/24 + arm64-focused job).
5. Record per-OS evidence in `docs/platform/`; then reconsider PRODUCTION
   READY.

Remaining future capabilities (unchanged, not scheduled): container/
microVM isolation backend, secret mediation, network sealing,
browser-profile access, automatic durable-state retention/compaction,
remote skill execution, parallel delegation children, full MCP
materialization envelopes across transports, skill execution statistics
(5H: deferred — no consumer in the current architecture).

## Test-runner resolution — 2026-09-04

`skills/runtime/skill-runtime.test.ts` could hang in its timeout case. Its
test-only slow-tool fixture awaited a completion promise that was resolved only
when the tool body began. A one-millisecond graph deadline can cancel before
that dispatch, leaving cleanup awaiting a promise that can never resolve. The
fixture now waits only when execution began, while the test asserts the actual
deadline error text. No production runtime behavior changed.
