# QUACK Architecture Audit

**Audit date:** 2026-09-23

**Repository:** `mahatosumit/QUACK`

**Branch:** `feat/quack-product-experience`

**Revision:** `8051397b5ca3eaf94228db87cb09fbfe396b8e51`

**Scope:** Phase 1 repository audit for the unified open-source AI operating platform mission

## 1. Executive conclusion

QUACK already contains a credible governed-runtime kernel. It should be extended,
not rewritten. The strongest implemented boundaries are:

- capability authorization and persisted mission grants;
- durable mission state, recovery, ownership leases, and fencing;
- deterministic workflow execution with evidence-bound completion receipts;
- governed model dispatch and provider-independent contracts;
- QIE context composition and structural prompt-injection defenses;
- semantic-memory admission, provenance, retrieval, and poisoning defenses;
- skill admission, validation, quarantine, and explicit promotion;
- process/container isolation contracts and verification probes;
- a loopback API and Studio client over the shared runtime;
- broad unit, integration, security, recovery, and deployment test coverage.

The platform is not yet the complete product described by the mission. The most
important blocker is architectural convergence: the current composition exposes
more than one mission execution lifecycle. `QuackRuntime.submitGoal()` drives the
documented `SessionRuntime -> DefaultLoopDriver -> WorkflowEngine ->
ExecutionScheduler` chain, while `GovernedMissionLoop.run()` owns a separate
model-in-the-loop iteration, checkpoint, run-store, approval, recovery, and
verification path. Compatibility harnesses and numerous specialized managers add
more lifecycle-shaped surfaces. They generally reuse the CapabilityBroker, but
shared authorization alone does not make their mission lifecycles canonical.

The next implementation phase must therefore consolidate the model-in-the-loop
behavior under `QuackRuntime` before adding desktop, gateway, scheduler, or more
agent features. Building new surfaces on both mission paths would make the split
permanent.

## 2. Audit method and repository baseline

The audit inspected repository instructions, the source and test inventory,
package scripts, CI workflows, current-state documents, ADRs, composition roots,
public entrypoints, core runtime code, and subsystem contracts. Graphify was not
available in this checkout (`graphify-out/` and the `graphify` command are absent),
so source navigation used tracked-file inventory, structural searches, call-site
tracing, and targeted file reads.

Current repository scale:

| Measure | Observed |
| --- | ---: |
| TypeScript files under `src/` | 637 |
| TypeScript test/e2e/security files under `src/` | 214 |
| TypeScript lines under `src/` | 124,676 |
| ADRs | 47 files (`0001`-`0036`, `0039`-`0049`) |
| Package manager | npm, lockfile v3 |
| Runtime requirement | Node.js `>=22.5.0` |
| Primary package shape | One root TypeScript package plus `sdk` workspace |

The checkout was clean before this audit document was added. The repository setup
report records a successful `npm ci` at this revision. Runtime services were not
needed for this documentation phase.

## 3. Current production composition

### 3.1 Static-graph mission path

The established runtime chain is real and should remain the kernel:

```text
CLI / API / SDK
  -> QuackRuntime.submitGoal
  -> SessionRuntime
  -> DefaultLoopDriver
  -> WorkflowEngine
  -> ExecutionScheduler
  -> QuackRuntime.executeTool
  -> CapabilityBroker
  -> tool execution
  -> workflow evidence
  -> verification record
  -> completion receipt
  -> durable task/checkpoint/memory updates
```

Evidence: `src/runtime/runtime.ts`, `src/engine/session-runtime.ts`,
`src/agent-loop/driver.ts`, `src/engine/workflow-engine.ts`, and
`src/engine/scheduler.ts`.

This path provides bounded budgets, durable checkpoints, invocation replay rules,
multi-process ownership, capability checks, workflow evidence, verification, and
receipts. Its planner is primarily deterministic/static; it is not the live QIE
model-action loop.

### 3.2 Governed model-in-the-loop path

The newer path is:

```text
CLI `govmission` / API engine=governed / `/governed-missions`
  -> GovernedMissionLoop.run
  -> semantic-memory retrieval
  -> QIE firewall/selection/composition/defense
  -> GovernedModelRuntime
  -> strict ActionProposal parser
  -> DefaultExecutionHarness
  -> CapabilityBroker
  -> ActionRuntime or QuackRuntime.executeTool
  -> ExecutionPolicy / isolation / probes
  -> step journal + mission checkpoint + run store
  -> mission-state transition
```

Evidence: `src/runtime/mission-lifecycle/governed-mission-loop.ts`,
`src/runtime/mission-lifecycle/harness.ts`, and the P11-P15 ADRs.

This path correctly treats model output as an untrusted proposal and reuses the
same capability broker. It is nevertheless a second mission lifecycle: it owns
its own run store, checkpoints, iteration records, recovery reconciliation,
approval store, and completion semantics, and is publicly addressable separately
from `QuackRuntime.submitGoal()`.

### 3.3 Compatibility and capability surfaces

- `AgentLoop` now delegates to `QuackRuntime`; keep it only as a temporary
  compatibility facade.
- `SkillRuntime` and portable skill execution submit governed graphs through
  `QuackRuntime`; this is a valid capability adapter, not a mission authority.
- `CompanyTaskScheduler` intentionally rejects executable callbacks and is not a
  second executor.
- `ComposableAgentHarness` routes tool execution through
  `QuackRuntime.executeTool`, but it also owns checkpoints, pause/resume state,
  trajectory events, and an H4 certification claim. It must remain an adapter
  behind the canonical mission runtime; its lifecycle records cannot become
  mission truth.
- `SEA`, COS, AIRM, UCP, DNPL, adaptive intelligence, workforce, organization,
  and self-modification managers are broad specialized surfaces. Most are not
  canonical authorities, but the composition does not make that distinction
  obvious enough.

### 3.4 Public surface mismatch

The CLI and HTTP API expose the split:

| Surface | Current execution path |
| --- | --- |
| `quack run`, `start`, `mission`, `trace`, `evaluate` | `QuackRuntime.submitGoal()` |
| `quack govmission run` | `GovernedMissionLoop.run()` |
| `POST /missions` | static path unless `engine`/`mode` is `governed` |
| `POST /governed-missions` | governed loop directly |
| `resume` | static runtime recovery |
| `govmission recover` | governed-loop recovery inspection |

`docs/cli/CLI.md` says there is no second runtime or execution path, but the
source exposes both. Documentation must follow code truth until convergence is
complete.

## 4. Existing authority map

| Authority | Current canonical candidate | Audit finding |
| --- | --- | --- |
| Runtime lifecycle | `QuackRuntime` | **KEEP and extend.** It must become the only public mission facade. |
| Mission lifecycle | `mission-state-machine.ts` | **KEEP.** Both paths use it, but persistence/orchestration remain split. |
| Capability authorization | `PermissionBackedCapabilityBroker` + grant registry | **KEEP.** Strong fail-closed core with revalidation and attenuation. |
| Policy | `RiskAwareApprovalPolicy`, extension policy, network policy, execution policy | **REFACTOR.** Valid layers, but no single five-level risk vocabulary and policy-decision envelope. |
| Events | `EventBus` | **KEEP and extend.** It is the shared dispatch bus, but durable event truth is fragmented. |
| Memory lifecycle | `SemanticMemoryService` is the strongest candidate | **REFACTOR.** Several memory stores/managers remain independently writable. |
| Model/provider routing | `QuackProviderV1` is the strongest contract; `ModelRuntime` is the live governed-loop runtime | **REFACTOR.** Registries and routers overlap. |
| Execution/evidence | `QuackRuntime.executeTool`, ActionRuntime, execution policy, isolation supervisor, evidence stores | **REFACTOR.** Governance is sound, but execution envelopes and evidence stores are split. |
| Verification/recovery | workflow verification/receipts plus governed step probes/checkpoints | **REFACTOR.** Two well-tested recovery/verification stacks need one mission-level owner. |
| Skills | `SkillRegistry` + `SkillRuntime` + package manager/compiler | **KEEP and extend.** Ecosystem catalog must remain admission-only until explicitly adapted. |

## 5. Completed milestones worth preserving

The code and recent history substantiate these completed foundations:

1. Provider-independent runtime, workspace tools, persistent state, and the
   workflow DAG/scheduler foundation (ADRs 0001-0009).
2. CapabilityBroker integration, explicit mission grants, scope restrictions,
   child-grant attenuation, and risk-aware approvals.
3. Public static mission convergence through `QuackRuntime`, including
   `SessionRuntime`, `DefaultLoopDriver`, workflow execution, and explicit
   verification (ADR 0027, still incomplete for the later governed loop).
4. Interrupted and multi-process recovery with SQLite leases, fencing, durable
   invocation records, and ambiguity refusal (ADRs 0028, 0031 update).
5. Canonical provider/tool materialization, governed provider dispatch,
   completion receipts, plugin hooks, delegation, and live composition wiring
   (ADRs 0032-0036).
6. Cross-platform process/path hardening and universal skill discovery with
   privacy controls (ADRs 0040-0041).
7. QIE deterministic context assembly, trust lanes, privacy admission,
   injection defense, governed model adaptation, and metadata-only
   observability (ADR 0042).
8. Governed semantic memory with provenance, explicit persistence, embedding,
   derived index, deletion, compaction, recovery, and poisoning defenses
   (ADR 0043).
9. Governed extension catalog with integrity, exact dependencies, lifecycle,
   transactionality, and no execution side effects (ADR 0044).
10. Governed model-in-the-loop proposal execution with execution policy,
    at-most-once journals, real process/container adapters, verification probes,
    approvals, recovery, and production coordination (ADRs 0045-0049).
11. Single-node deployment qualification, backup/restore, migrations, provider
    failure checks, security tests, packaging checks, and cross-platform CI.
12. Studio consolidation onto one HTTP server/UI, mission operations,
    approvals, traces, evidence views, audit views, and governed streaming.

These milestones are implementation assets, not proof that the full product
mission is finished.

## 6. Subsystem status against the requested platform

| Requested subsystem | Status | Evidence and gap |
| --- | --- | --- |
| One canonical runtime | **PARTIAL / P0** | `QuackRuntime` is canonical for static missions, but `GovernedMissionLoop` is separately public. |
| Canonical SENSE-to-LEARN loop | **PARTIAL / P0** | Phases exist across the two loops; there is no single persisted lifecycle that owns all phases. |
| Model-provider abstraction | **PARTIAL / P0** | Rich `QuackProviderV1` plus live `ModelProvider`; both are active abstractions. |
| OpenAI/OpenRouter/local endpoints | **PARTIAL** | OpenAI-compatible, OpenRouter, Ollama, vLLM, and NVIDIA paths exist. |
| Anthropic and Google adapters | **MISSING** | No native adapters or conformance coverage. They may be reachable only through an OpenAI-compatible gateway. |
| Intelligent routing/fallback | **PARTIAL / P0** | Capability/policy router and simpler model router coexist; governed missions use the simpler model runtime. Cost metadata is mostly static. |
| Coding agent | **PARTIAL** | Read/list/search/write, terminal, tests, git status/commit, docs, patch/intelligence foundations exist. First-class diff/history/blame/checkout/restore/delete tools and a complete iterative coding mission do not. |
| Build/plan/review/mission modes | **MISSING / P0-P1** | No canonical mode policy. Harness profiles are not mission modes and do not own broker policy. |
| Interactive terminal chat/TUI | **MISSING / P1** | CLI is command-oriented and one-shot; `quack` does not provide a persistent streaming chat session. |
| Polished CLI command set | **PARTIAL** | Strong diagnostics and governed commands; no `chat`, `plan`, `review`, `models`, `schedule`, `evidence`, or `logs` commands as specified. |
| Cross-platform desktop app | **MISSING / P2** | Studio is a browser SPA. Old desktop server was removed. `electron-builder.json` still references deleted `gui/` artifacts and is not a working desktop architecture. |
| Persistent semantic memory | **IMPLEMENTED FOUNDATION** | Strong semantic admission/retrieval/provenance. |
| Personal/user model | **MISSING / P1** | No canonical `UserModel`; preference/fact/inference/temporary distinctions are not modeled as a unified contract. |
| Automatic memory extraction | **PARTIAL** | Completion/experience writes exist, but conversation -> candidate -> validate -> store is not a canonical end-to-end lifecycle. |
| Self-improving skills | **PARTIAL** | Evidence-driven proposals, compiler, experiments, validation, and promotion exist; successful governed trajectories do not yet flow through one automatic candidate pipeline with operator approval. |
| External skill admission | **STRONG FOUNDATION** | Privacy-safe discovery, quarantine, integrity, validation, and explicit activation exist. OPTINX/ECC adapters must stay adapters. |
| MCP/tools/plugins/extensions | **PARTIAL** | MCP transports/actions and governed hooks exist. Extension catalog execution is intentionally absent; full operation materialization is incomplete. |
| Capability broker / least privilege | **STRONG FOUNDATION** | Grants, scopes, paths, commands, hosts, tools, actions, revocation, attenuation, and revalidation exist. |
| Five-level risk system | **MISSING / P0** | Current approvals use low/medium/high; skills and action contracts use additional incompatible risk vocabularies. |
| Human approvals | **IMPLEMENTED FOUNDATION** | Queue, console, durable approval records, identity binding, expiry, single use, and denial are present. |
| Host/process/container/remote execution | **PARTIAL** | Host policy, real process, and Docker container backends exist. Remote worker is scaffolding, not qualified production execution. |
| Immutable event log | **PARTIAL / P0** | Shared EventBus and append-only JSONL audit exist, but event storage is not the canonical durable mission ledger and is not cryptographically immutable. |
| Evidence/artifact system | **PARTIAL / P0** | Receipts, traces, workflow evidence, execution evidence, audit records, and artifact views exist across multiple stores. No single ArtifactStore/mission evidence manifest. |
| Verification engine | **STRONG BUT SPLIT** | Workflow verification and probe-based action verification are robust but owned by different mission paths. |
| Failure recovery/replanning | **STRONG BUT SPLIT** | Static workflow recovery and governed-loop recovery are independently implemented; model-driven replanning is limited. |
| Telegram/Discord gateway | **MISSING / P3** | No gateway implementation. Discord appears only as community planning text. |
| Cheap single-node server | **IMPLEMENTED FOUNDATION** | Loopback server, SQLite, backup/restore, startup/provider qualification, and documented single-host limits exist. |
| Recurring mission scheduler | **MISSING / P2** | Execution scheduling exists; product scheduling with cron/timezone/durable triggers does not. AIRM review/task schedulers are not mission scheduling. |
| Durable sessions | **PARTIAL / P0-P1** | Session runtime and mission persistence exist, but conversation/session/user/workspace identity is not unified across every surface. |
| Trajectory replay | **PARTIAL** | Trace/replay components exist; canonical governed replay/debugging across model input, policy, actions, evidence, and recovery is not unified. |
| Deep Git integration | **PARTIAL** | Status and commit tools plus internal worktree flows exist. User-facing governed Git operations are incomplete. |
| Central configuration | **PARTIAL / P0** | CLI JSON/env config and `config/models.json` coexist; provider/model/security/gateway/scheduler policy is not one validated schema. |
| Observability | **PARTIAL / P1** | Extensive event types and audit/trace views exist. Required trace/session/mission correlation fields are not uniform at event envelope level. |
| Durable database model | **PARTIAL / P1** | SQLite stores missions, tasks, traces, evaluations, two memory forms, action ledger, mission companies, and leases. Many core records remain JSON files; most requested tables are absent. |
| Open-source project quality | **STRONG FOUNDATION** | License, contribution/security/governance docs, ADRs, examples, CI, release and deployment documentation exist. Several docs are stale or contradictory. |
| Security threat model | **STRONG FOUNDATION** | Prompt injection, paths, processes, secrets, skills, isolation, recovery, and cross-suite adversarial tests exist. |
| Cost accounting/budgets | **PARTIAL** | Token/latency and loop budgets exist. End-to-end provider pricing, mission-cost persistence, and policy enforcement are incomplete. |
| Agent profiles | **PARTIAL** | Personas, agent definitions, and harness task profiles exist; they are not one canonical profile contract that controls runtime policy. |
| Final product scenario | **MISSING** | No test completes inspect -> plan -> edit -> fail -> diagnose -> replan -> pass -> skill candidate -> approval -> persistence across CLI/Desktop/Telegram/Discord. |

## 7. KEEP / EXTEND / REFACTOR / REPLACE / REMOVE

### KEEP

- `QuackRuntime` as the control-plane facade.
- `SessionRuntime`, `DefaultLoopDriver`, `WorkflowEngine`, and
  `ExecutionScheduler` as the established execution chain.
- the canonical mission state machine and transition guards.
- CapabilityBroker, durable grant registries, attenuation, revocation, and
  last-moment revalidation.
- QIE, its trust model, privacy firewall, deterministic composer, and injection
  defense.
- governed semantic memory's canonical record, provenance, admission, and
  derived-index rule.
- action contracts, execution policy, isolation supervisor/backends, probe
  runner, attempt journal, and ambiguity refusal.
- EventBus as the in-process event dispatch mechanism.
- workflow evidence, verification records, completion receipts, and ownership
  fencing.
- portable declarative skills, compiler, quarantine, validation, provenance,
  package lifecycle, and explicit promotion.
- QuackHttpServer and Studio as clients of the runtime, not alternative agents.
- SQLite migrations, local-first deployment, backup/restore, and the existing
  security/regression suites.

### EXTEND

- Extend `QuackRuntime` with one `submitMission` contract that selects behavior
  through mission mode/profile policy without selecting a second runtime.
- Fold QIE/model-driven proposal generation into the canonical loop as the
  planning/replanning driver.
- Compile approved action proposals into the canonical execution envelope and,
  where applicable, workflow nodes so they retain scheduler, journal, evidence,
  verification, and recovery semantics.
- Extend the durable event envelope with `traceId`, `sessionId`, `missionId`,
  `eventId`, component, severity, and schema version.
- Extend semantic memory with explicit memory kind (`fact`, `preference`,
  `inference`, `temporary`, `decision`, `workflow`, `failure`, `goal`),
  confidence, validation status, supersession, and source links.
- Extend skills with a verified-trajectory candidate builder that always stops
  at human approval.
- Extend the server/client contract for shared sessions, schedules, gateways,
  and desktop clients only after runtime convergence.

### REFACTOR

- Collapse the 1,262-line `src/distributions/swe-system.ts` composition root into
  bounded bootstrap modules while preserving a single returned `QuackSystem`.
- Converge `ProviderAdapter`, `ModelProvider`, `QuackProviderV1`, and AIRM model
  metadata on `QuackProviderV1` plus compatibility adapters. Do not create a
  fourth abstraction.
- Converge `ProviderFallbackRouter`, `ModelRuntimeRouter`, `ModelRouter`, and
  `CapabilityProviderRouter` behind one governed `ModelRouter` service.
- Make `SemanticMemoryService` the canonical long-term memory service; adapt or
  retire independent IdentityMemory, DecisionMemory, organizational, SEA,
  workspace, and computer-memory writes.
- Consolidate workflow evidence, action evidence, traces, audit records,
  receipts, and files under one mission evidence manifest and ArtifactStore
  interface.
- Normalize risk to `SAFE | LOW | MEDIUM | HIGH | CRITICAL`, with a lossless
  mapping from existing permission, skill, action, and execution risk types.
- Make profiles data that parameterize mode, capabilities, routing, approvals,
  memory, autonomy, budgets, and verbosity; profiles must never instantiate a
  runtime.
- Migrate durable JSON mission stores into versioned SQLite repositories where
  concurrency or transactional integrity matters. Retain exportable JSON as an
  interchange format, not parallel truth.

### REPLACE

- Replace the heuristic planner as the primary planning mechanism with a
  QIE-governed routed planning contract; retain it as an offline/bootstrap
  strategy.
- Replace the stale Electron packaging assumptions with a new desktop client
  ADR and build only after the shared client API/session contract is stable.
- Replace documentation that claims one path today with accurate transitional
  diagrams until the migration is complete.
- Replace product-visible legacy project branding in harness aliases with
  neutral compatibility identifiers; keep temporary aliases only where callers
  demonstrably require them.

### REMOVE (only after migrations and compatibility tests)

- direct public construction/invocation of `GovernedMissionLoop`;
- `/governed-missions` and `quack govmission` as separate lifecycle concepts;
- duplicate model/provider registries after all callers use the canonical
  router;
- mission-lifecycle state in capability harnesses;
- stale desktop documentation/configuration referring to deleted sources;
- compatibility exports that can independently claim mission completion;
- obsolete current-state sections whose claims are superseded by code and
  executable tests.

Nothing in this list should be deleted first. Migration adapters, contract tests,
and an ADR must precede removal.

## 8. Target canonical runtime

The target should preserve the existing chain and absorb the newer governed
features:

```text
Client (CLI / Desktop / API / Gateway / Scheduler)
  -> QuackRuntime.submitMission
  -> SessionRuntime
  -> canonical MissionState + durable MissionRepository
  -> DefaultLoopDriver
       SENSE      : workspace/session/event/memory observations
       UNDERSTAND : QIE-governed context assembly
       PLAN       : ModelRouter or deterministic bootstrap planner
       AUTHORIZE  : CapabilityBroker + approval policy
       ACT        : WorkflowEngine -> ExecutionScheduler -> ExecutionRuntime
       OBSERVE    : EventBus + EvidenceStore + ArtifactStore
       VERIFY     : VerificationEngine (workflow checks + trusted probes)
       LEARN      : evidence/trajectory analysis
       MEMORY     : governed memory candidate admission
       COMPLETE   : receipt, or bounded recovery/replan
```

Important invariants:

1. A client submits an objective and policy; it never chooses a runtime.
2. Model output is always untrusted proposal data.
3. CapabilityBroker authorizes every effect and remains the only authorization
   authority.
4. Execution policy and isolation determine how/where an authorized effect may
   run; authorization never implies isolation.
5. Verification is based on runtime evidence, never model assertion.
6. A mission has one state record, one checkpoint stream, one event timeline,
   and one final receipt.
7. Memory and generated skills consume verified evidence and never grant
   authority.
8. CLI, desktop, scheduler, Telegram, and Discord are clients/adapters over the
   same mission/session APIs.

## 9. Incremental implementation plan

### Phase 2A - Canonical lifecycle convergence (P0)

Create an RFC and ADR before code changes.

1. Define `MissionRequest`, `MissionMode`, `MissionPolicy`, and one public
   `QuackRuntime.submitMission()` contract.
2. Make current `submitGoal()` and governed endpoints adapters to that method.
3. Move governed loop run/checkpoint/recovery ownership under `QuackRuntime` and
   `SessionRuntime`; direct governed-loop access becomes internal.
4. Use one mission repository/state record and one ownership lease namespace.
5. Route action proposals through the canonical execution envelope and evidence
   pipeline.
6. Preserve static/offline planning as a strategy, not a separate runtime.
7. Add conformance tests proving every public entrypoint produces the same state,
   event, authorization, evidence, verification, recovery, and receipt shapes.

Exit gate: there is no public flag, command, route, SDK method, or adapter that
selects a competing mission lifecycle.

### Phase 2B - Provider/model convergence (P0)

1. Adopt `QuackProviderV1` as the canonical provider contract.
2. Adapt current Ollama/OpenAI-compatible/NVIDIA providers to it.
3. Merge live model selection, privacy policy, capability scoring, fallback,
   health, circuit breaking, token use, latency, and price metadata into one
   governed router.
4. Add native Anthropic and Google adapters plus conformance fixtures.
5. Add local llama.cpp/OpenAI-compatible configuration without provider-specific
   runtime branches.
6. Persist routing reason and provider/model identity with every generation.

Exit gate: switching provider/model changes no mission/runtime code.

### Phase 2C - Policy, evidence, and storage convergence (P0)

1. Introduce the five-level risk vocabulary and map all existing risk types.
2. Define one execution/evidence envelope from intent through verification.
3. Add durable event and artifact repositories with a per-mission evidence
   manifest.
4. Correlate events with mission/session/trace/component/severity metadata.
5. Move concurrency-sensitive governed run, checkpoint, approval, event,
   memory, skill-version, schedule, artifact, execution-run, and verification
   state into migrations.
6. Preserve JSON exports and backups without treating them as parallel truth.

### Phase 3 - Coding runtime

1. Add first-class governed tools for diff, history, blame, branch, checkout,
   restore, patch application, deletion, dependency inspection, and affected
   test selection.
2. Separate read, reversible write, irreversible write, package install, and
   network scopes.
3. Implement BUILD, PLAN, REVIEW, and MISSION as policies over the same runtime.
4. Build the understand -> plan -> edit -> test -> diagnose -> replan -> verify
   coding trajectory and its evidence contract.
5. Add malicious-repository and shell/argument injection suites.

### Phase 4 - Personal memory and user model

1. Extend the semantic record with typed kind, confidence, validation,
   supersession, and evidence references.
2. Implement conversation extraction as candidate generation only.
3. Require admission policy before persistence and keep repository/tool/external
   sources distinct from user-authored facts.
4. Add an editable, auditable `UserModel` projection derived from memory rather
   than a second store.
5. Bind retrieval to user/project/workspace/session scopes and prompt budgets.

### Phase 5 - Skill learning and ecosystem

1. Feed verified mission trajectories into a reusable-procedure analyzer.
2. Produce declarative, project-neutral skill candidates with prerequisites,
   capabilities, security constraints, validation, provenance, and version.
3. Reuse the existing compiler, sandbox, experiment, evaluation, and promotion
   gates.
4. Require explicit operator approval before registration/activation.
5. Keep OPTINX, ECC, MCP, and external repositories behind admission adapters.

### Phase 6 - Terminal product

1. Add a persistent streaming `quack`/`quack chat` session client.
2. Add mode/model/profile/permission/mission/memory/evidence controls.
3. Add progressive tool, diff, command, approval, error, recovery, cancellation,
   and resume rendering.
4. Add the requested `plan`, `review`, `models`, `schedule`, `evidence`, and
   `logs` commands as clients of shared APIs.

### Phase 7 - Desktop client

1. Write a replacement desktop ADR and client boundary.
2. Package the existing Studio product concepts in a maintained TypeScript
   desktop shell without copying runtime business logic.
3. Use the same authenticated client API, session, mission, approval, memory,
   model, schedule, and event contracts as CLI.
4. Qualify Windows, macOS, and Linux installers and upgrades.

### Phase 8 - Automation and scheduler

1. Add durable `ScheduledMission` records with cron, timezone, enabled state,
   owner, policy, and next/last fire times.
2. Make triggers submit normal `MissionRequest`s; do not create an automation
   executor.
3. Add single-node locking/misfire policy, receipts, notifications, and restart
   recovery.

### Phase 9 - Remote gateways

1. Add Telegram and Discord as authenticated channel adapters.
2. Map remote identities to existing users/sessions and enforce channel-specific
   scope/rate limits.
3. Support chat, mission creation/status, approvals, notifications, and reports
   through shared APIs only.
4. Add replay, forgery, webhook, abuse, and cross-session leakage tests.

### Phase 10 - Security hardening

Continuously update the threat model, then qualify prompt injection, malicious
repositories, MCP/tool poisoning, skill supply chain, secret exfiltration,
SSRF, path traversal, package installs, gateway abuse, memory poisoning,
cross-session isolation, and privilege escalation across the unified path.

### Phase 11 - Production qualification

Run cross-platform lint, typecheck, unit, integration, security, provider,
runtime, mission, memory, skill, capability, execution, verification, scheduler,
gateway, CLI, desktop, packaging, backup/restore, crash, and deployment tests.
Record limitations instead of converting environment-dependent checks into
claims.

### Phase 12 - Final scenario

Automate the complete acceptance scenario in a disposable project, including a
real initial test failure, diagnosis/replan, verified repair, skill candidate,
human approval, memory persistence, replay inspection, and observation of the
same mission/session from CLI, desktop, Telegram, and Discord.

## 10. Test and verification inventory

The test architecture is broad. Major test-file counts include runtime 26,
engine 12, models/providers 10, memory 8, skills 12, security 7, isolation 5,
actions 6, server/dashboard 7, system 12, deployment 5, extensions/ecosystem 8,
harness 4, agent-loop 2, tools 7, and storage 3.

The root test runner builds once, runs ordinary compiled Node tests with
concurrency 4, then runs two self-modification integration suites serially. CI
tests Node 22 and 24 on Ubuntu, Windows, and macOS; it also has ARM64 lanes,
installer smoke tests, focused security/recovery suites, CodeQL, secret scanning,
docs checks, coverage, nightly audit, and release workflows.

Audit-time validation initially exposed a full-suite concurrency hang. The
implementation follow-up traced it to a timing-dependent delegation test gate
and replaced the fixed sleep with an explicit barrier. A second load-dependent
recovery assertion was corrected to recognize both safe losing outcomes:
lease contention and arrival after the winner has already made the mission
terminal. The final concurrent suite terminated cleanly with 2,229 passes, zero
failures, and three documented skips; the serial self-modification suites added
17 passes.

Important missing acceptance coverage:

- one entrypoint-conformance matrix across every CLI/API/SDK/client surface;
- one canonical model-in-the-loop coding mission using workflow scheduling;
- end-to-end mode-policy tests;
- native Anthropic/Google provider conformance;
- persistent interactive session/chat tests;
- durable schedules and misfire/restart tests;
- native desktop packaging/e2e tests;
- Telegram/Discord identity and abuse tests;
- unified user-model and memory-candidate lifecycle tests;
- the final cross-interface skill-learning scenario.

## 11. Security boundaries to preserve

1. Repository content is untrusted data and must stay in QIE data/evidence trust
   lanes.
2. Provider/model output never supplies capability, risk, timeout, isolation,
   approval, identity, or verification truth.
3. A grant and an approval are different records; both are revocable and scoped.
4. Host-function execution is policy-restricted, not sandboxed. Only workloads
   mapped to an available isolation adapter may claim process/container
   isolation.
5. At-most-once does not mean exactly-once. Ambiguous effects remain parked
   until trusted reconciliation.
6. SHA-256 integrity records are not authenticity against an attacker who can
   rewrite the trusted store.
7. Current coordination is single-host and is not distributed consensus.
8. Extension and skill admission never implies activation or execution.
9. Memory is data, never policy or authority.
10. Desktop, gateways, schedulers, harnesses, and external agents must not own a
    mission state machine, broker, memory lifecycle, or verification engine.

## 12. Recommended first implementation ticket

**P0: Canonical Mission Entry Contract and Surface Convergence**

Deliverables:

1. RFC plus ADR defining the single `QuackRuntime.submitMission()` lifecycle.
2. Contract types for objective, mode, profile, routing, budgets, workspace,
   verification criteria, and requested capabilities.
3. Adapters from current `submitGoal`, `govmission`, `/missions`,
   `/governed-missions`, and SDK calls.
4. One persisted mission identity/state/checkpoint/event/receipt across both
   deterministic and model-planned strategies.
5. Conformance tests demonstrating equivalent governance and recovery across
   every entrypoint.
6. Deprecation notices for direct governed-loop access; no removal in this
   ticket.

Non-goals for the first ticket: desktop, gateways, recurring schedules, new
providers, new skills, or UI redesign. Those depend on the canonical contract.

## 13. Phase 1 disposition

Phase 1 changes documentation only. No working runtime, security, memory,
provider, skill, UI, or test implementation should be rewritten during this
audit. The repository is ready to proceed to a reviewed RFC/ADR for lifecycle
convergence, followed by small, compatibility-preserving implementation slices.

### Implementation follow-up

The first convergence slice is recorded in ADR 0050. It introduces
`QuackRuntime.submitMission()` as the canonical client entry, adapts
`submitGoal()`, and routes API, HTTP, CLI, and SDK mission execution through the
runtime-selected DAG or governed strategy. Durable state-schema convergence is
intentionally left to the next slice so ADR 0048/0049 recovery guarantees are
not rewritten implicitly.
