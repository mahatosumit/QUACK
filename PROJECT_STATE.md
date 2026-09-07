# PROJECT_STATE

Last updated: 2026-08-07

## Purpose

This file is the persistent handoff map for QUACK OS development. Read this before starting future work, then read only the relevant source files and architecture docs for the specific task.

## Repository Snapshot

QUACK OS is a TypeScript Node.js project (`@quack/os`) targeting Node >= 20. The public package entrypoint is `src/index.ts`, build output goes to `dist/`, and validation is driven by:

- `npm run build`: TypeScript compile.
- `npm run typecheck`: TypeScript compile without emit.
- `npm test`: build, then run Node's built-in test runner over `dist/**/*.test.js`.

The repo currently contains a large uncommitted working tree from prior development. Preserve it. Do not revert or overwrite previous changes unless explicitly instructed.

## Architecture Summary

The documented QUACK OS flow is:

```text
Mission
-> Planner
-> Workforce Router / Organization
-> Skill Registry
-> Task Graph
-> Tool Runtime
-> Verification / Reflection
-> Evidence
-> Memory
-> Learning
```

The implemented system composition root is `src/system/create-system.ts`. It wires the runtime, event bus, tool registry, provider registry, memory, audit log, SEA, skill registry/executor, organization, COS, UCP, DNPL, AIRM, adaptive learning, context bootloader, evaluator, workflow loader, and controlled self-modification gate.

Current runtime path:

- `QuackRuntime.submitGoal()` creates a task, selects contextual skills, asks the brain for a plan, executes the brain, runs selected portable skills, writes memory, emits events, and records learning evidence.
- `ExecutiveBrain` uses `Planner` to create a DAG-like plan, then runs it through `SessionRuntime` and `WorkflowEngine`.
- `Planner` builds `TaskGraph` nodes with required tools and, for some recognized goals, concrete `toolInvocations`.
- `WorkflowEngine` executes only declared `toolInvocations`; a node with required tools but no invocation fails instead of silently succeeding.
- `ToolRegistry` exposes permission-declaring tools. `QuackRuntime.executeTool()` validates input, checks every declared permission through the capability broker, emits enforcement audit events, and executes the tool only after all required capabilities are allowed.
- `AgentLoop` orchestrates mission-aware Observe -> Plan -> Act -> Verify -> Reflect -> Update State cycles over the existing planner, skill registry, runtime tool executor, capability broker, event bus, and memory store.
- `Harness` observes loop/event output to create mission traces, collect metrics, evaluate outcomes, and compare deterministic replay signatures without controlling core execution.
- `RiskAwareApprovalPolicy` auto-approves low-risk permissions when configured and denies medium/high risk actions without an approver callback.

## Implemented Components

- Mission and COS layer: `src/cos/*` defines goals, missions, strategy, decisions, council, governance, progress, context, capability inventory, experience, learning, and skill evolution.
- Planner and task graph: `src/engine/planner.ts`, `src/engine/task-graph.ts`, and `src/engine/types.ts`.
- Workflow execution: `src/engine/workflow-engine.ts`, `src/engine/session-runtime.ts`, `src/engine/checkpoint-system.ts`, `src/engine/execution-journal.ts`, scheduler, recovery, reflection, and cost optimizer.
- Tool runtime: core tools include echo, workspace list/read/write, code search, terminal, and git status.
- Skill system: manifests, registry versioning/persistence, compiler, sandbox runtime, executor, built-ins, and adaptive skill selection are present.
- Skill Runtime v1: `src/skills/runtime/*` loads declarative manifests, validates metadata/security boundaries, resolves required capabilities, gates lifecycle status, and executes bounded workflows only through the runtime tool executor.
- Skill Package Management v1.1: `src/skills/packages/*` imports portable package folders, validates manifests and workflows, rejects untrusted or unauthorized packages, persists installed metadata/workflows/enabled state, and rehydrates packages through Skill Runtime on startup.
- Memory OS v1: `src/memory/os.ts` provides policy-aware persistent memory items, storage adapters, retrieval, and mission/capability isolation.
- Multi Agent Workforce v1: `src/agents/*` provides specialist agent definitions, registry, router, and Skill Runtime-backed execution.
- Production interfaces: CLI commands, programmatic API, and developer dashboard expose mission, skill, agent, trace, evaluation, and observability surfaces.
- Skill package interfaces: CLI supports `quack skills install/list/enable/disable`; HTTP API supports `POST /skills/import`, `GET /skills`, `POST /skills/:id/enable`, and `POST /skills/:id/disable`.
- Security foundation: permission types, allow/deny policies, risk-aware approval policy, workspace path confinement, protected-core write restrictions, mission-aware capability broker, persisted grant registry, active tool-execution enforcement, and audit events are present.
- Agent execution loop: `src/agent-loop/*` implements Observe -> Plan -> Act -> Verify -> Reflect -> Update State with mission-aware execution, lifecycle controls, iteration records, bounded recovery, timeout handling, and capability-denial handling. `createQuackSystem()` exposes `system.agentLoop`.
- Harness engineering: `src/harness/*` implements trace recording, metrics collection, mission evaluation, deterministic replay, and benchmark scenario definitions. `createQuackSystem()` exposes `system.harness`.
- Evidence and learning: runtime task completion is recorded into evidence experience stores and feeds skill fitness/adaptive evolution paths.
- Self-modification gate: `src/selfmod/*` implements proposal, isolated worktree, verification, human gate, promotion, and rollback-related controls. It is wired in `createQuackSystem()` and documented as never auto-merging.
- SEA: repository understanding, navigation, editing, review, memory, reporting, and testing subsystems are exposed through `src/sea/*`.
- AIRM/DNPL/UCP/platform layers: runtime/model capability routing, distributed/native platform abstractions, and computer-use primitives are implemented.

## Tests And Validation Surface

There are 89 TypeScript test files under `src/**/*.test.ts`.

Important coverage areas:

- Runtime/tool permission flow: `src/runtime/runtime.test.ts`, `src/tools/workspace-filesystem.test.ts`, `src/security/permissions.test.ts`, `src/security/approval-controller.test.ts`.
- Executable DAG contract: `src/system/planner-tool-contract.test.ts`, `src/system/executable-dag.integration.test.ts`, `src/engine/workflow-engine.test.ts`.
- Skill safety and lifecycle: `src/skills/compiler.test.ts`, `src/skills/sandbox-runtime.test.ts`, `src/skills/registry-persistence.test.ts`, `src/skills/registry-versioning.test.ts`.
- COS/evidence learning: `src/cos/cos.test.ts`, `src/cos/evidence-learning.test.ts`.
- Adaptive learning: `src/adaptive/evidence-driven-skill-evolution.test.ts`, `src/adaptive/evidence-improvement-cycle.test.ts`, `src/adaptive/skill-fitness.test.ts`.
- Self-modification safety: `src/selfmod/code-improvement-controller.integration.test.ts`, `src/selfmod/promotion.integration.test.ts`.

Full verification after the initial broker increment passed on 2026-08-07.

## Incomplete Or Risk Areas

- The Phase 2 Capability Broker now supports mission-level grants through `InMemoryCapabilityGrantRegistry`.
- Permission names are still a fixed union in `src/security/permissions.ts`; richer external policy loading is not yet implemented.
- Mission capability grants now persist through `JsonFileCapabilityGrantRegistry` at `dataDir/security/capability-grants.json`, with config grant de-duplication and a `MissionManager.onActivate()` hook for mission-scoped loading.
- Capability enforcement now blocks tool execution before the tool runs when mission grants, resource scope, capability metadata, action class, or permission policy do not allow access. Denials return `CapabilityDeniedError` details in the stable `tool.permission_denied` result.
- Broker-level audit events now include mission, agent, skill, and grant context for tool access, but a persisted/queryable audit view tying mission -> agent/skill -> capability decision -> resource scope is not yet explicit.
- Planner output is only executable for recognized goals with `toolInvocations`; generic multi-step plans currently declare tools but may fail execution without concrete invocations.
- Harness replay v1 compares deterministic trace signatures and does not re-execute tools; active replay should remain sandboxed and capability-gated.
- The skill blueprint shape exists in `SkillManifest` plus portable execution, but the requested blueprint fields (`purpose`, `inputs`, `allowed tools`, `workflow`, `verification`) are not yet consistently represented as a formal source format.
- Skill packages are declarative and persisted, but package signing, remote package repositories, dependency resolution, and package test execution are not yet implemented.
- Execution safety has risk-aware permission approval and skill compilation risk classes, but a unified READ / REVERSIBLE CHANGE / IRREVERSIBLE ACTION classifier is not yet the shared runtime contract.
- Documentation has some stale-looking references in capability docs to ADR filenames that do not appear in the current ADR list.
- The working tree is dirty with many modified and untracked files from prior work; every future change should isolate its own touched files and avoid cleanup/refactors unless requested.

## Current Milestone

Agent Loop v1, Harness Engineering v1, and Skill Runtime v1 are now implemented. The next major milestone should build on the secure skill runtime with richer policy loading, signed skill bundles, and benchmark-driven skill promotion.
Memory OS v1, Multi Agent Workforce v1, Planning Engine v1 helpers, production interfaces, dashboard, and e2e validation scenarios are now implemented for QUACK OS v1 completion.
QUACK OS v1.1 hardening has begun with Real Model Runtime Integration as the first isolated increment.
Skill Package Management v1.1 is implemented as a portable lifecycle over Skill Runtime without bypassing sandbox or capability enforcement.

## Latest Verification

Baseline before Phase 2 edits:

- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- Focused foundation tests passed: 47 tests across system composition, planner/tool contract, executable DAG integration, workflow engine, runtime, workspace tools, security approval, skill sandbox, and COS evidence learning.

Post Phase 2 broker increment:

- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- Expanded focused tests passed: 50 tests including `src/security/capability-broker.test.ts`.
- `npm.cmd test` passed: 958 tests.

Post mission grant increment:

- Focused security/runtime tests passed: 28 tests covering grant allow, missing capability deny, expired grant deny, path scope deny, grant revocation/query, and bootstrapped mission grants in real workspace tool access.
- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd test` passed: 964 tests.

Current validation refresh on 2026-08-07:

- Rebuilt from a clean `dist/` after a stale saved test output showed an old `GoalsProgressTracker` failure.
- Focused `dist/core/goals/goals.test.js` passed: 5 tests.
- `npm.cmd run typecheck` passed.
- `npm.cmd test` passed: 964 tests.

Post persistent grant increment:

- Added JSON-backed mission grant persistence, de-duplicated config grant seeding, persisted revocation metadata, and mission activation listeners.
- Focused tests passed: `dist/security/capability-broker.test.js` (9 tests), `dist/tools/workspace-filesystem.test.js` (3 tests), and `dist/cos/cos.test.js` (49 tests).
- `npm.cmd run typecheck` passed.
- `npm.cmd test` passed: 966 tests.

Post capability enforcement increment:

- Added active capability contract validation before permission policy decisions.
- Added `capability.checked`, `capability.allowed`, and `capability.denied` audit events while preserving `capability.requested`, `capability.decided`, `permission.requested`, and `permission.decided`.
- Added structured `CapabilityDeniedError` context to denied tool execution results.
- Focused tests passed: `dist/security/capability-broker.test.js` (10 tests), `dist/tools/workspace-filesystem.test.js` (5 tests), and `dist/runtime/runtime.test.js` (2 tests).
- `npm.cmd run typecheck` passed.
- `npm.cmd test` passed: 969 tests.

Post Agent Loop v1 increment:

- Added `AgentLoop` with states `IDLE`, `OBSERVING`, `PLANNING`, `EXECUTING`, `VERIFYING`, `REFLECTING`, `COMPLETED`, and `FAILED`.
- Integrated MissionManager, Planner, SkillRegistry, runtime tool execution, EventBus, capability-enforced tool access, and MemoryStore.
- Each iteration records observation, selected action, tool calls, execution result, verification result, and reflection summary.
- Added safeguards for max iterations, iteration timeout, bounded recovery, stop/pause/resume, and capability-denied failures.
- Added audit events: `loop.started`, `loop.iteration`, `loop.action_selected`, `loop.completed`, and `loop.failed`.
- Focused `dist/agent-loop/agent-loop.test.js` passed: 4 tests.

Post Harness Engineering v1 increment:

- Added `src/harness/` with `TraceRecorder`, `MetricsCollector`, `MissionEvaluator`, `ReplayEngine`, and benchmark scenario catalog.
- Mission traces capture mission input, generated plans, selected skills, capability events, executed tools, outputs/errors, verification results, loop iterations, and final outcome.
- Metrics cover task success rate, tool failure rate, capability violations, recovery attempts, execution latency, iteration count, tool calls, and capability checks.
- Added Mission Evaluation API through synchronous `evaluateMission(trace)` and event-emitting `MissionEvaluator.evaluateMission(trace)`.
- Added deterministic replay signature comparison through `ReplayEngine` / `replayTrace`.
- Added audit events: `evaluation.started`, `evaluation.completed`, and `trace.created`.
- Added benchmark fixtures under `tests/harness/scenarios/`.
- Focused `dist/agent-loop/agent-loop.test.js` and `dist/harness/harness.test.js` passed: 9 tests.
- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd test` passed: 978 tests.

Post Skill Runtime v1 increment:

- Added `src/skills/runtime/` with a declarative `SkillRuntimeManifest` schema and `SkillRuntime` execution layer.
- Manifest schema includes id, name, version, description, author, trust level, required capabilities, allowed tools, input/output schemas, execution limits, and declarative workflow steps.
- Skill Runtime integrates with `SkillRegistry` for loading, registering, discovering, validating, enabling, disabling, and lifecycle-gated execution.
- Skill execution path is `SkillRuntime -> CapabilityBroker -> RuntimeExecutor`; skills do not receive direct tool access and arbitrary JS/Python skill code is not executed.
- Sandbox boundaries enforce timeout limits, iteration limits, max tool calls, retry limits, tool allowlists, capability declarations, and workspace tool confinement.
- Added lifecycle events: `skill.loaded`, `skill.validated`, `skill.started`, `skill.completed`, and `skill.failed`.
- Added example manifests: `examples/filesystem-assistant.skill.json`, `examples/code-analysis.skill.json`, and `examples/research.skill.json`.
- Documented in `docs/SKILL_RUNTIME.md`.
- Focused `dist/skills/runtime/skill-runtime.test.js` passed: 5 tests.
- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd test` passed: 983 tests.

Post QUACK OS v1 completion increment:

- Added persistent Memory OS v1 with memory manager, storage adapters, retrieval engine, and memory policy.
- Added memory item schema: id, type, source, timestamp, confidence, access policy, related mission, content, and metadata.
- Integrated Agent Loop observation/outcome storage with Memory OS while keeping the legacy memory store fallback.
- Added Multi Agent Workforce v1 with specialist agents: coding, research, engineering, and documentation.
- Added agent routing based on mission goal, required skills, and required capabilities.
- Improved Planner with goal decomposition, task graph helper, dependency validation, execution ordering, and graph metadata for skills/tools/order.
- Added production CLI commands: `init`, `mission`, `skills`, `agents`, `trace`, and `evaluate`.
- Added programmatic API for mission submission, status, traces, and evaluations.
- Added developer dashboard snapshots for active missions, agents, skills, capability decisions, traces, failures, and evaluations.
- Added e2e v1 validation scenarios for software development, research, document generation, and engineering analysis.
- Added architecture documentation in `docs/QUACK_OS_V1_ARCHITECTURE.md`.
- Focused v1 completion tests passed: 17 tests.
- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd test` passed: 1001 tests.

Post v1.1 Model Runtime increment:

- Added `src/models/runtime.ts` with `ModelProvider`, `OllamaModelProvider`, `OpenAICompatibleModelProvider`, `ModelRuntimeRouter`, `ModelRuntime`, and `loadModelRuntimeConfig`.
- Added `config/models.json` defaulting to Ollama `qwen3.6:27b`.
- Model Runtime supports model selection, fallback providers, streaming chunks, token usage tracking, latency tracking, and provider failure recording.
- Integrated model selection metadata with Planner, model hints with Agent Router, and optional model selection notes in Reflection Engine.
- `createQuackSystem()` now exposes `system.modelRuntime`.
- Documented in `docs/MODEL_RUNTIME.md`.
- Focused model/planner/agent tests passed: 16 tests.
- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd test` passed: 1010 tests.

Post v1.1 Persistent Mission Storage increment:

- Added SQLite-backed storage repositories for missions, tasks, traces, evaluations, legacy memory records, and Memory OS items.
- `MissionManager` now persists through an injected repository while keeping its synchronous public API stable.
- `createQuackSystem()` now exposes `system.storage` and uses `dataDir/quack.sqlite` as primary storage.
- Runtime tasks are persisted to SQLite and mirrored to `tasks.json` for backward compatibility.
- Harness traces and evaluations persist through repository injection; API submissions add loop-id lookup records.
- Documented in `docs/PERSISTENT_STORAGE.md`.
- Focused storage/API/runtime persistence tests passed: 4 tests.
- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd test` passed: 1012 tests.

Post v1.1 Production HTTP API Server increment:

- Added `src/server/` with `QuackHttpServer` and `createApiServer()`.
- Implemented HTTP routes for missions, mission status, traces, skills, agents, health, and Event Bus SSE streaming.
- Mission submission is accepted asynchronously and executed through the existing `QuackApi` facade.
- Structured JSON error responses cover validation, malformed JSON, body limits, missing routes, and unexpected failures.
- Server startup/shutdown is configurable and graceful, including active event stream cleanup.
- Documented in `docs/API_SERVER.md`.
- Focused server/API/storage tests passed: 8 tests.
- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd test` passed: 1017 tests.

Post v1.1 Dashboard Foundation increment:

- Added `src/dashboard/web/` with lightweight dashboard HTML, CSS, client script, and read-only state builder.
- API Server now serves `/dashboard`, dashboard assets, `/dashboard/state`, and `GET /missions`.
- Dashboard state combines API server mission records, Event Bus history, persistent traces/evaluations, agents, and skills.
- Browser updates live through existing `/events` Server-Sent Events and refreshes dashboard state without direct runtime object access.
- Documented in `docs/DASHBOARD.md`.
- Focused dashboard/server/storage tests passed: 11 tests.
- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd test` passed: 1020 tests.

## Recommended Roadmap

1. Capability Broker foundation:
   - Added `CapabilityRequest`, `CapabilityDecision`, `CapabilityScope`, action classes, resource-kind mapping, and `PermissionBackedCapabilityBroker`.
   - Runtime tool execution now emits `capability.requested`, `capability.checked`, `capability.allowed`, `capability.denied`, and `capability.decided` while preserving legacy permission events.
   - Tool execution is actively denied before execution when capability checks fail.
   - Documented in `docs/CAPABILITY_BROKER.md`.

2. Planner executable contract:
   - Decide whether generic planner nodes should compile to concrete `toolInvocations`, route through selected skills, or remain non-executable plan-only nodes.
   - Add tests before changing behavior.

3. Capability grant model:
   - Added mission-level `CapabilityGrant` records.
   - Added optional agent and skill grant scopes.
   - Added workspace path, command, and resource restrictions.
   - Added JSON-backed persistence and restart loading for grants.
   - Current permission policy remains the fallback enforcement layer after grant validation.

4. Resource-specific policy:
   - Workspace path and command scope matching are implemented conservatively.
   - Reuse workspace path confinement already present in workspace tools.

5. Agent execution loop:
   - Added v1 mission-aware loop over existing planner/runtime/tool/capability/memory/event components.
   - The loop does not replace planner/runtime behavior; it orchestrates one executable planner action per iteration.

6. Harness engineering:
   - Added v1 observation-only harness for mission traces, metrics, evaluation, deterministic replay, and benchmarks.
   - The harness observes event/loop output and does not modify runtime execution behavior.

7. Queryable audit trail:
   - Persist capability request/decision records for mission accountability.
   - Add tests for audit correlation.

8. Skill Runtime v1:
   - Added declarative portable skill runtime with manifest validation, lifecycle events, capability preflight, runtime-executor-only tool execution, sandbox limits, docs, examples, and tests.

9. Execution safety unification:
   - Introduce READ / REVERSIBLE CHANGE / IRREVERSIBLE ACTION classification as a shared runtime/security type.
   - Map existing approval risk and skill compilation risk onto it.

10. Learning loop hardening:
   - Keep self-improvement proposal-only and human-gated.
   - Connect evidence -> evaluation -> proposal -> test -> promotion with explicit audit and rollback notes.

## Next Recommended Task

Implement Skill Runtime v1: portable skills with sandbox execution, safe loading, and runtime capability boundaries.
