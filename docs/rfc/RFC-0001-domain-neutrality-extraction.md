# RFC-0001: Domain Neutrality Extraction — Generalize QUACK OS Core

**Status:** Proposed
**Date:** 2026-07-23
**Author:** QUACK OS Engineering Team
**Constitution Reference:** §3, §5 (Domain Neutrality), §6 (Layered Architecture), §8 (Extensibility), §11 (Governance Pipeline)
**Related:** ADR-0024 (pending), ARCHITECTURE_REVIEW.md, DECISIONS.md

---

## 1. Summary

QUACK OS core currently contains pervasive **software-engineering domain logic** that violates the Domain Neutrality principle (Constitution §5). The core `organization`, `skills`, `engine/planner`, `core/context`, `intelligence`, `airm`, and `system/create-system` modules are hardcoded to 18 SWE agent roles, coding-biased skill categories, JS/TS-user identity defaults, and coding-only builtin tools/skills/pipelines.

This RFC proposes a **non-breaking extraction** that moves all domain specifics out of the core into the **Skills / Plugins / Application layer** while keeping the core a generic, domain-neutral operating system. The extraction preserves 100% of existing functionality (Constitution §5 "Preserve Existing Functionality") by relocating rather than removing.

No stable subsystem is replaced. Functionality moves, defaults become configurable, and a new `AgentProfileRegistry` + `PluginHost` pattern lets the existing SWE app layer re-register itself at boot — identical behavior, no API break.

---

## 2. Motivation

### 2.1 Constitutional Conflict

Constitution §3 states QUACK OS is **NOT** a coding agent, OCR framework, or industry solution. Constitution §5 (Domain Neutrality) lists the only concepts the core may understand: Goals, Tasks, Plans, Agents, Events, Memory, Knowledge, Policies, Resources, Execution, Scheduling, Projects, Workspaces, Messages, Permissions, Providers, Plugins, Skills, Tools, Context.

### 2.2 Empirical Evidence (Architecture Audit Findings)

A full domain-leak audit (see ARCHITECTURE_REVIEW.md §3 — 100+ findings) confirms:

| Core Module | Leak | Severity |
|---|---|---|
| `src/organization/types.ts:3-21` | `AgentRole` union hardcoded to 18 SWE roles | Critical |
| `src/organization/profiles.ts` | 18 SWE role profiles (software-engineer, debugger, reviewer, tester, devops, release, ui-ux, plugin, memory-curator, knowledge-engineer…) | Critical |
| `src/organization/lifecycle.ts:52-58` | `spawnAllAgents()` auto-spawns SWE-only org; fallback role = `"software-engineer"` | Critical |
| `src/skills/types.ts:3-7` | `SkillCategory` = source-control, container, language, testing, debugging, architecture, terminal, file, indexing… (coding-biased; no agriculture/healthcare/finance/robotics) | Critical |
| `src/skills/builtins/index.ts` | All 10 builtin skills are coding/devops (git, terminal, testing, security-review, architecture-review, workspace-index, dependency-analysis, documentation, markdown, file-manager) | Critical |
| `src/system/create-system.ts:93-100` | System factory registers CodeSearchTool, TerminalTool, GitStatusTool as **core** tools | Critical |
| `src/engine/planner.ts:51,65,95,114-115,239` | Planner hardcodes code-search, git-status, terminal tools; keys off SWE verbs ("refactor","implement","fix","build"); bakes in typecheck/lint/build | Critical |
| `src/core/context/identity-loader.ts:8-22,106` | Defaults: `codingStyle:"modular"`, `linter:"tsc"`, `formatter:"prettier"`, `testingFramework:"node:test"`, `role:"engineer"` | Critical |
| `src/core/context/project-loader.ts:7,36-44` | Ignores `node_modules/.git/.next/dist/build/out`; reads `.git/HEAD` to populate `gitBranch`/`gitCommit` | Critical |
| `src/intelligence/semantic-layer.ts:13-19,43-49,67-72` | Core intelligence layer instantiates PatchEngine, TestRunner, GitIntegration, LspManager (incl. `pylsp` Python server) | Critical |
| `src/intelligence/validation/validation-pipeline.ts` | Runs `npx eslint`, checks `eslint.config.*` | Critical |
| `src/airm/types.ts:204-208` | `ProfileType` = `coding | robotics | computer-use | scientific-writing | security-review | performance-analysis | education | enterprise | general` (multi-domain hardcoded) | High |
| `src/airm/pipeline-manager.ts:111-125` | `createDefaults()` registers `code-review-pipeline` + `vision-ocr-pipeline` | High |
| `src/airm/marketplace-client.ts:54-55` | Ships "Code Review Pipeline" + "Software Engineering Profile" packages | High |
| `src/airm/capability-registry.ts:50-54` | `createDefaults()` registers `coding`, `architecture` ("Software architecture design"), `ocr` capabilities | High |
| `src/cos/council-engine.ts:13-43,62` | Council templates hardcode SWE role composition (`["architect","software-engineer"]` etc.) | Medium |
| `src/cos/types.ts:124` | Experience categories = `bugfix | refactoring | architecture | optimization | testing | deployment | recovery | pattern` (SWE-biased) | Medium |

### 2.3 Impact of Not Acting

- QUACK OS cannot power non-coding downstream applications without forking the core.
- Adding "agronomist" or "clinician" agent roles requires editing `src/organization/types.ts` — a core source file — violating Constitution §8 ("registration rather than modification").
- The core cannot be reused as a standalone AI OS outside its original application without dragging SWE assumptions.
- Every new domain (OCR, vision, robotics) must either leak into core (violating §5) or be force-fit into SWE-shaped roles/categories.

---

## 3. Goals

1. **G1 — Domain-Neutral Core:** The core (kernel + core-services layers: `core/`, `events/`, `runtime/`, `brain/`, `memory/`, `engine/`, `security/`, `tools/`, `providers/`, `skills/`, `plugins/`, `system/`, `config/`, `organization/`, `telemetry/`, `workspace/`, `models/`) must not import or reference any domain (coding, robotics, OCR, healthcare, agriculture, finance, education).
2. **G2 — Zero Breaking Changes:** All existing public APIs, CLI flags, SDK methods, desktop endpoints, event types, and persisted state formats remain valid. Behavior is preserved by relocating SWE specifics into a default app/skill-pack that re-registers at boot.
3. **G3 — Registration over Modification:** Adding a new domain (e.g., agronomy) requires only registering an `AgentProfilePack`, a `SkillPack`, a `ToolPack`, and/or a `Plugin` — never editing core source.
4. **G4 — Provider-Agnostic Runtime on Par with OpenCode:** Match or exceed OpenCode's 75+-provider model by making provider addition a config+adapter registration act (Constitution §5 Provider Neutrality, §8 Extensibility).
5. **G5 — Modular Document Understanding (per Unlimited-OCR study):** Provide a generic, plugin-based document-understanding capability surface so OCR/PDF/table/vision-language pipelines register as plugins, not core.

## 4. Non-Goals

- **NG1:** Not rewriting the runtime pipeline, Executive Brain, memory, event bus, plugin system, or provider interface. These are stable (Constitution §5 Backward Compatibility).
- **NG2:** Not removing SEA (`src/sea/`) or UCP (`src/computer/`). These are explicitly the SWE / computer-use **application layers** and are allowed to contain coding/computer logic. The audit confirms they correctly live there.
- **NG3:** Not adopting LiteLLM, LangGraph, Temporal, NATS, or any external dep as a mandatory architectural dependency (Constitution §9 — abstractions, not concrete deps).
- **NG4:** Not a from-scratch rewrite. Extraction is incremental and per-subsystem with rollback.
- **NG5:** Not migrating the existing `workflows/*.yaml` (software-development, robotics, research). These are already correctly placed at repo root (LOW severity, application layer).

---

## 5. Proposed Changes

### 5.1 Extract SWE Agent Roles → `AgentProfileRegistry` + default SWE Pack

**Problem:** `src/organization/types.ts` hardcodes `AgentRole` as a closed SWE union; `profiles.ts` defines 18 SWE profiles; `lifecycle.ts:spawnAllAgents()` auto-spawns them.

**Proposal:**
- Generalize `AgentRole` from a closed union to an opaque `string` brand with a registered-set registry (`AgentProfileRegistry`).
- Introduce `AgentProfilePack` interface: `{ id, profiles: AgentProfile[] }`. A pack is registered via `organization.registerProfilePack(pack)`.
- Move all 18 SWE profiles (`softwareEngineerProfile()` … `knowledgeEngineerProfile()`) from `src/organization/profiles.ts` into a new **app layer module** `src/apps/swe/agent-profile-pack.ts` (or, to preserve zero-breaking re-export, into `src/organization/packs/swe.ts` with the core only defining the `AgentProfile` interface + `AgentProfileRegistry`).
- `spawnAllAgents()` becomes `spawnRegisteredAgents()` — spawns whatever packs are registered. The SWE pack registers by default in `create-system.ts` so a stock boot produces the same 18 agents.
- `lifecycle.ts` fallback role `"software-engineer"` → configurable `defaultRole` on the `AgentProfileRegistry` (default `"software-engineer"` for back-compat, settable to any registered role).

### 5.2 Generalize `SkillCategory` → open string + tags

**Problem:** `src/skills/types.ts:3-7` `SkillCategory` is a closed coding-biased union.

**Proposal:**
- Change `SkillCategory` to an open `string` type, but add a `categoryId: string` + `tags: string[]` on `SkillManifest` for taxonomy. The existing literal values (`"source-control"`, `"terminal"`, etc.) remain VALID — they just become registered canonical tags rather than the only allowed values.
- New domains register tags like `"agronomy"`, `"clinical"`, `"robotics-perception"` without core edits.
- Skill category validation moves from a TS-union check to a registry check that **accepts any string but warns on unknown** (registry-policied, not type-policied).

### 5.3 Extract Builtin Skills → default `SkillPack`; core ships only the loader

**Problem:** `src/skills/builtins/index.ts` defines 10 coding-only builtin skills registered by default.

**Proposal:**
- Core keeps `SkillLoader` + `SkillRegistry` + `SkillValidator` + `SkillExecutor` (these are generic).
- The 10 builtin skills move into a `swe-skill-pack` shipped in the same repo, registered by default in `create-system.ts` via `skillRegistry.registerPack(sweSkillPack)`.
- A new `apps/coding/` (or existing `skills/builtins/` rebranded as the SWE default pack) holds the skill definitions. Core imports the pack through `create-system.ts` only — not at the type/abstraction layer.

### 5.4 Extract Coding Tools → Tool Packs; core ships generic tools only

**Problem:** `create-system.ts:97-100` registers `CodeSearchTool`, `TerminalTool`, `GitStatusTool` as core tools.

**Proposal:**
- Core retains only domain-neutral tools: `EchoTool`, `WorkspaceListFilesTool`, `WorkspaceReadFileTool`, `WorkspaceWriteFileTool` (these are generic workspace/file operations; file read/write is constitutionally a Tool, not coding-specific).
- `CodeSearchTool` (rip grep-like text search — actually generic file content search, but named "code"), `TerminalTool`, `GitStatusTool` move into the SWE ToolPack, registered by default.
- **Nuance:** `CodeSearchTool`'s *capability* (grep over files) is generic. The *leak* is the name + the `node_modules/.git/dist` ignore list. Action: keep a generic `TextSearchTool` in core (rename, generalize ignore list to configurable `DEFAULT_IGNORED_DIRECTORIES`), move the SWE-named `CodeSearchTool` alias + `GitStatusTool` + `TerminalTool` to the SWE pack.

### 5.5 Generalize the Planner → pluggable `PlannerStrategy`

**Problem:** `src/engine/planner.ts:42-115` hardcodes a 7-phase SWE pipeline (analyze → gather context w/ code-search → plan → execute → validate w/ typecheck/lint → test → review w/ git-status) and keys off SWE verbs.

**Proposal:**
- Introduce `PlannerStrategy` interface: `{ id, createPlan(goal, context): Plan }`.
- The current hardcoded SWE pipeline becomes `SwePlannerStrategy` (registered by default) in `src/apps/swe/planner-strategy.ts`.
- Core `Planner` keeps a `PlannerStrategyRegistry`; `createPlan(goal)` delegates to the registered strategy. Default install ships `SwePlannerStrategy` so existing behavior is preserved byte-for-byte.
- New domains register their own `PlannerStrategy` (e.g., `AgronomyPlannerStrategy`, `ResearchPlannerStrategy`).
- `PlannerStrategy` is now a Constitution §8 extension point: "Adding an implementation should require registration rather than modification."

### 5.6 Generalize Core Context (`core/context/`)

**Problem:** Identity defaults assume a JS/TS coder; project loader reads `.git/HEAD` and ignores JS-project dirs.

**Proposal:**
- `DEFAULT_PREFERENCES` becomes configurable via `createDefaultConfig({ identityProfile })`. Default profile remains `engineer` w/ `node:test`/`tsc`/`prettier` (back-compat). New profiles (`agronomist`, `clinician`, `researcher`, `robotics-engineer`) are registerable via `ContextLoader.registerIdentityProfile(profile)`.
- `project-loader.ts` ignore list moves to config (`config.projectScan.ignoreDirs`), default value unchanged for back-compat.
- `.git/HEAD` parsing becomes an optional `GitProjectContextContributor` registered by the SWE pack, not a hardcoded read. Other domains register their own contributors (e.g., a Robotics pack could read `package.xml`/`roslaunch` manifests).

### 5.7 Extract Intelligence Coding Subsystems → generic `IntelligenceProvider` interface

**Problem:** `src/intelligence/semantic-layer.ts` hard-wires `PatchEngine`, `TestRunner`, `GitIntegration`, `LspManager`; `validation-pipeline.ts` runs eslint.

**Proposal:**
- Define generic `WorkspaceUnderstandingProvider`, `PatchProvider`, `ValidationProvider`, `TestDiscoveryProvider`, `VcsProvider`, `LanguageServerProvider` interfaces.
- The SWE implementations (PatchEngine, eslint ValidationPipeline, node:test TestRunner, Git VcsProvider, pylsp LspManager) register as default providers in a `swe-intelligence-pack`.
- Core `SemanticLayer` becomes a **facade over registered providers** — it queries provider registries rather than constructing concrete coding classes.
- Critical: behavior preserved because SWE pack is the default install.

### 5.8 Generalize AIRM `ProfileType`, `PipelineStepType`, capabilities, and defaults

**Problem:** `src/airm/types.ts:204-208` `ProfileType` lists `coding, robotics, computer-use, scientific-writing, security-review, performance-analysis, education, enterprise, general`. `pipeline-manager.createDefaults()` ships code-review + vision-ocr pipelines. `capability-registry.createDefaults()` ships `coding`, `architecture`, `ocr`. `marketplace-client` ships SWE packages.

**Proposal:**
- `ProfileType` → open `string` (`ProfileId`) registered via `ProfileManager.registerProfile(profile)`. Existing literals remain valid registered profile IDs.
- `createDefaults()` methods across `pipeline-manager.ts`, `capability-registry.ts`, `marketplace-client.ts` are **split**: `createCoreDefaults()` (empty or only `general`) + `createSweDefaults()` (the current coding/architecture/ocr/code-review-pipeline set, moved to the SWE pack).
- AIRM remains in core as the **runtime-management substrate** (model registry, runtime registry, GPU scheduler, routing, monitoring) — these are generic. Only the *content defaults* (which packages/profiles/pipelines ship) relocate.

### 5.9 Generalize COS Council Templates & Experience Categories

**Problem:** `src/cos/council-engine.ts:13-43` council templates hardcode SWE role composition; `src/cos/types.ts:124` experience categories are SWE-biased.

**Proposal:**
- `DEFAULT_COUNCIL_TEMPLATES` → `CouncilTemplateRegistry`. SWE templates register via the SWE pack.
- `ExperienceCategory` union → open `string` (`ExperienceTag`). Existing SWE values remain valid tags.
- Core COS keeps `CouncilEngine`, `GoalManager`, `DecisionEngine`, `ExperienceEngine`, etc. — only the *template content* and *category vocabulary* relocate.

### 5.10 Provider-Agnostic Runtime — match OpenCode

**Problem:** `src/providers/provider.ts::ProviderRegistry` and `src/airm/provider-registry.ts::ProviderRegistry` are **two parallel, inconsistent registries**. Only `EchoProvider` + `OpenAiCompatibleProvider` are wired in `create-system.ts`. No Anthropic-native, Google, xAI, Ollama, vLLM, MCP, or WebSocket adapters ship.

**Proposal:**
- **Consolidate** the two provider registries. Core keeps `ProviderRegistry` (`src/providers/provider.ts`); `src/airm/provider-registry.ts` becomes a downstream consumer that reads from core `ProviderRegistry` (or is removed; AIRM uses core registry).
- Add a **provider catalog** as data, not code: `providers/catalog.ts` exports a `ProviderCatalog` (id, displayName, authMode, defaultBaseUrl, npm-package-style config-only descriptor). Matching OpenCode's pattern, adding a provider becomes "register a `ProviderDescriptor` + an optional `ProviderAdapter` if non-OpenAI-compat".
- Ship **adapter modules** for the high-value OpenAI-compat cloud providers (Anthropic-via-openai-proxy, Google Vertex, xAI, DeepSeek, GLM, Qwen, Mistral, Cohere, OpenRouter, Together, Groq) — each ~30 lines, all inherit `OpenAiCompatibleProvider` with different baseUrl + auth headers. Configurable via env or `opencode.json`-style config.
- Ship **local runtime adapters**: `OllamaProvider` (OpenAI-compat `/v1`), `LlamaCppProvider` (OpenAI-compat), `LmStudioProvider` (OpenAI-compat), `VllmProvider` (OpenAI-compat). All inherit `OpenAiCompatibleProvider`.
- Ship **non-OpenAI-compat adapters** for providers that need their own wire format: `AnthropicProvider` (Messages API), `GoogleVertexProvider` (Vertex AI), `McpProvider` (Model Context Protocol), `WebSocketProvider` (generic WS streaming). Each implements `ProviderAdapter` from core.
- New-provider addition = `providers.register(new XxxProvider(config))` or config-only for OpenAI-compat. **Zero core changes required.** This satisfies Constitution §5 (Provider Neutrality) and the directive's goal of "minimal effort without modifying the OS core."

### 5.11 Modular Document Understanding Layer (per Unlimited-OCR study)

**Problem:** Unlimited-OCR (17.8k★ Baidu) is a vision-language doc-parsing model served via vLLM/SGLang with an OpenAI-compatible API. It can do single-image, multi-page, and PDF parsing with `<image>document parsing.` prompts. QUACK OS has `ocrImage` inside `src/computer/` (computer-use layer — acceptable as an app) and a `vision-ocr-pipeline` hardcoded in `src/airm/pipeline-manager.ts` (core leak). There is no generic **Document Understanding** capability surface in core.

**Proposal:**
- Add to core only the **interface** `DocumentUnderstandingProvider` (methods: `parse(input: DocInput): Promise<DocOutput>`, `discover(): Promise<DocCapabilities>`). This is a capability plug, not an OCR implementation — Constitution §5 explicitly lists OCR engines as a provider category, and §7 lists "Document Processing" under Platform Services (not Kernel).
- Move `vision-ocr-pipeline` from `src/airm/pipeline-manager.ts` defaults into a `document-understanding-pack` plugin.
- An `UnlimitedOcrProvider` adapter (or any other OCR/VLM engine) registers as a `DocumentUnderstandingProvider` via plugin. The SWE/computer-use pack can re-register the existing `ocrImage`-backed provider for back-compat.
- Core never imports `infer.py`, PyMuPDF, vLLM, or any OCR runtime. Unlimited-OCR is consumed as a *reference capability study*, never a dependency (Constitution §10).

### 5.12 New `apps/` convention + keep `sea/`, `computer/` as allowed app layers

**Problem:** No clear "application layer" home for SWE-specific packs.

**Proposal:**
- Ratify that `src/sea/` (Software Engineering Agent) and `src/computer/` (Universal Computer Use) are **officially the application layers** for coding/computer-use. They are allowed to contain domain logic (the audit confirms they do, correctly).
- Add `src/apps/` for additional domain packs (e.g., `src/apps/agronomy/`, `src/apps/clinical/`). These are optional app-layer modules not installed in the bare-core build.
- The bare-core build (`createMinimalQuackSystem()`) registers no domain packs — proves the core runs standalone (Constitution §5: "reusable, open, modular, extensible, and independent").
- The default install (`createQuackSystem()`) registers the SWE + computer-use + core-tools packs so existing users see no change.

---

## 6. Alternatives Considered

### A1 — Do nothing; document that QUACK OS is a coding OS

**Rejected.** Violates Constitution §3 ("NOT a coding agent"), §5 (Domain Neutrality), and the Primary Objective of the directive. The core must support independently developed domain extensions.

### A2 — Full rewrite with a clean domain-neutral core

**Rejected.** Violates Constitution §5 back-compat (Runtime Pipeline, Executive Brain, Memory, Provider Layer, Skills, Plugins, Context, Security, Scheduling, CLI, GUI, SDK, Public APIs, workflows). The directive's non-negotiable principle #1 is "Preserve existing working functionality." A rewrite risks 786+ tests and the existing 23 ADRs.

### A3 — Add parallel domain modules alongside SWE modules

**Rejected.** Doubles maintenance, deepens coupling, violates §17 (detect duplicated functionality). Better to extract SWE into a pack that is one peer among many.

### A4 — Keep SWE defaults in core but expand the union enums

**Rejected.** Per-enum expansion (`add "agronomist", "clinician"...` to `AgentRole`) is exactly the anti-pattern the Constitution §8 forbids ("registration rather than modification"). Every new domain would require core edits.

**Selected proposal (§5)** is the only one satisfying all of: G1-G5, Constitution §5 back-compat, §8 registration, and the directive's non-negotiable principles.

---

## 7. Backward Compatibility Assessment

Constitution §5 lists 13 systems that must be preserved. Impact per system:

| Protected System | Impact | Back-compat Strategy |
|---|---|---|
| Runtime Pipeline | None | `QuackRuntime.submitGoal` signature unchanged; only delegates through strategy registry. |
| Executive Brain | None | `ExecutiveBrain` keeps same constructor; `buildProviderProfiles()` still works; coding profile data moves to a registered pack the brain reads from the registry. |
| Event Bus | None | No event types added/removed. SWE pack emits the same events via the same bus. |
| Memory Architecture | None | `MemoryStore` interface unchanged. Default scope values unchanged. |
| Provider Layer | **Improved** | `ProviderAdapter`/`ProviderRegistry` interface unchanged. The 2 existing providers keep working unchanged; new ones are additive. |
| Plugin System | None | `PluginManifest`/`PluginRegistry` unchanged. The new packs *use* the existing plugin host. |
| Context Management | Config-only | `DEFAULT_PREFERENCES` values preserved as the default installed profile; new profiles are registerable. |
| Security | None | `Permission` union unchanged (`git.read` etc. remain valid). Adding permissions is additive. |
| Scheduling | None | Engine scheduler unchanged. |
| CLI | None | `quack start|serve` flags unchanged. Domain packs auto-register so no new flags needed. |
| GUI | None | Desktop server endpoints unchanged; SWE pack re-registers the "Git Commit" command palette item. |
| SDK | None | `QuackClient` interface unchanged. |
| Public APIs / workflows | None | `workflows/*.yaml` untouched; the agents they reference (`software-engineer` etc.) are still registered by the default SWE pack. |

**Net API surface:** zero removals. Only additive registrations. Existing `import { createQuackSystem } from "@quack/os"` keeps working identically.

---

## 8. Dependencies Impact

### New internal dependencies

- `apps/swe/*` depends on `core/*` (downward — Constitution §6 ✓).
- `document-understanding-pack` depends on `core/providers` + (optionally) external OCR HTTP endpoint — no Python/PyMuPDF/vLLM in core.
- No core ↔ app circular dependency: app modules import core; core never imports `apps/`.

### Removed/consolidated

- `src/airm/provider-registry.ts` consolidated into core `src/providers/provider.ts` (removes the duplicate-registry inconsistency flagged in the audit).

### External dependencies

- **No new domain dependency proposed by this extraction.** Reference runtimes remain architectural studies or optional adapters. The existing package already has third-party runtime dependencies; the earlier "zero external npm dependencies" claim is obsolete. See `package.json` for the actual dependency inventory.

---

## 9. Performance Impact

- **Hot path:** `submitGoal → plan → execute` unaffected. Strategy registry lookup is O(1) Map.get; provider profiles read from in-memory registry.
- **Cold start:** +one indirection per registered pack (negligible — SWE pack registers 18 profiles + 10 skills + 4 tools + 4 intelligence providers in <1ms).
- **Memory:** ~+0 bytes persistent (packs are already-instantiated objects; we're relocating their lifetime, not duplicating).
- **Provider fanout:** Strategy enables per-domain routing (e.g., route research tasks to cheaper models, route code-review to stronger ones) — a performance *win* aligned with Hermes' "auxiliary client" pattern.

---

## 10. Security Impact

- **Positive:** Domain packs run through the existing `PermissionPolicy` + `AuditLog` + `Plugin sandbox`. Extracting SWE into a pack means non-SWE installs can ship **without** `terminal.execute` / `git.write` permissions enabled by default — tighter least-privilege (Constitution §16).
- **Risk:** New packs (agronomy, clinical) could introduce new `Permission` values. Mitigation: permissions are additive string-brand types validated at registration by the existing `PermissionPolicy`; unknown permissions are denied by `DenyByDefaultPermissionPolicy`.
- **Supply chain:** External OCR/VLM adapters are provider plugins (HTTP egress), not core imports. Existing `network.http` permission gate applies. No new dependency footprint.

---

## 11. Scalability Impact

- **Horizontal:** Domain packs can be loaded/unloaded at runtime → enables per-tenant pack configurations in a multi-tenant deployment (downstream applications load only their registered domain packs).
- **Provider scaling:** OpenCode-style provider catalog + 30+ adapter modules means a single QUACK OS install can fan out to multi-cloud, multi-local-runtime, multi-OCR-engine providers simultaneously — exceeding the original 2-provider ceiling.
- **No new bottlenecks:** registries are in-memory Maps; lookups remain O(1).

---

## 12. Maintainability Impact

- **Positive:** Core shrinks to its generic minimum. Adding a domain = adding a pack + registering — no core PR required. Outside contributors can ship domain packs without touching core.
- **Test isolation:** SWE pack tests live with the SWE pack; core tests assert only generic behavior. The audit's observation that `"robotics startup"` appears as a test fixture in `src/memory/identity-memory.test.ts:8` proves the core is *already* generic at the memory layer — this RFC extends that property to the rest of the core.
- **Downside:** More files. Mitigated by co-locating each pack in one directory (`src/apps/swe/`).

---

## 13. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Extraction introduces subtle behavior diff | Medium | High (786 tests) | Per-subsystem feature-flagged cutover; run full regression between each move; preserve byte-identical defaults. |
| External contributors miss the new pack convention | Medium | Medium | Add `CONTRIBUTING.md` section + `examples/custom-domain-pack/`; ratify in ADR-0024. |
| Dual provider registries confuse downstream code during transition | Medium | Medium | Mark `src/airm/provider-registry.ts` `@deprecated` first; redirect to core registry; remove only after one release cycle. |
| A pack fails to register and silently breaks the default install | Low | High | Add `system-boot-smoke.test.ts` asserting the 18 SWE agents + 10 skills + 4 tools register under default `createQuackSystem()`. |
| Domain enum opening (`ProfileType`→string) loses type safety | Medium | Low | Add an `@deprecated` literal-type alias for back-compat; runtime validation via registry. |
| External OCR runtime (Unlimited-OCR) treated as required | Low | Medium | ADR-0024 explicitly forbids unlimited-ocr/vLLM/PyMuPDF as core deps; reference-only. |

---

## 14. Migration Strategy

### Phase 0 (now): Governance + docs only
- Merge this RFC + ADR-0024 + ARCHITECTURE_REVIEW.md. No code changes. (This is the current stop point.)

### Phase 1: Abstractions + registries added (back-compat additive)
- Add `AgentProfileRegistry`, `PlannerStrategyRegistry`, `IntelligenceProviderRegistry`, `ToolPack`, `SkillPack`, `ProfileManager` registration interface, `DocumentUnderstandingProvider` interface.
- Core still has the old hardcoded defaults calling the new registries internally. **Behavior identical.**

### Phase 2: Extract one subsystem at a time (gated by feature flag)
Order (lowest-risk first):
1. `core/context/identity-loader` & `project-loader` → config-only defaults
2. `airm/{pipeline-manager, capability-registry, marketplace-client}` `createDefaults()` → `createSweDefaults()` pack
3. `engine/planner` → `SwePlannerStrategy` registration
4. `intelligence/semantic-layer` → registered providers
5. `skills/builtins` → `swe-skill-pack`
6. `organization/profiles` + `lifecycle.spawnAllAgents` → `swe-agent-profile-pack` + `spawnRegisteredAgents()`
7. `system/create-system.ts` tool registration → `swe-tool-pack`

Each step: full regression (786 tests must pass) + audit log review before next step. Rollback = revert the one PR.

### Phase 3: Provider catalog + adapters (additive)
- Consolidate `airm/provider-registry` into core.
- Ship Anthropic-native, Google, xAI, Ollama, vLLM, MCP, WebSocket adapters + 30+ OpenAI-compat configs.
- No removals; existing `OpenAiCompatibleProvider` remains.

### Phase 4: Document-understanding pack + Unlimited-OCR optional adapter
- `document-understanding-pack` plugin with `UnlimitedOcrProvider` adapter (HTTP-only — no Python in core).
- Move `vision-ocr-pipeline` default to the pack.

### Phase 5: Bare-core install + multi-domain examples
- `createMinimalQuackSystem()` with no packs.
- `examples/agronomy-pack/`, `examples/clinical-pack/` demonstrating non-SWE domain registration.

---

## 15. Test Plan

| Layer | Tests |
|---|---|
| Core neutrality | `core-neutrality.test.ts`: assert no `src/{organization,skills,engine,core,system,airm,intelligence}/` top-level file imports a domain module or matches SWE/robotics/OCR regex. |
| Back-compat | `system-boot-smoke.test.ts`: default `createQuackSystem()` registers 18 agents + 10 skills + 4 SWE tools + 4 intelligence providers (byte-identical to today). |
| Registry | `agent-profile-registry.test.ts`, `planner-strategy-registry.test.ts`, `intelligence-provider-registry.test.ts` — register/unregister/route behavior. |
| Provider | `provider-catalog.test.ts`: each new adapter produces correct wire-format; `consolidated-registry.test.ts`: AIRM reads core registry. |
| Domain pack | `examples/agronomy-pack/agronomy-pack.test.ts`: non-SWE domain runs end-to-end via `submitGoal` with only agronomy pack registered. |
| Regression | Existing 786+ tests pass unchanged at every phase gate. |
| Governance | `constitution-ci.test.ts` (CI gate): parse `ARCHITECTURE_CONSTITUTION.md`, assert no NEW core file introduces domain terms. |

---

## 16. Validation Against Constitution

| § | Principle | Compliance |
|---|---|---|
| §3 | Not a coding agent | ✓ Core has no coding content; SWE moves to app layer. |
| §5 | Domain Neutrality | ✓ Core understands only the 19 listed generic concepts. |
| §5 | Backward Compatibility | ✓ Zero breaking changes; all 13 protected systems preserved per §7 table. |
| §5 | Provider Neutrality | ✓ Provider catalog + 30+ adapters, registration not modification. |
| §6 | Layered dependency direction | ✓ Apps→Products→SDK→Plugins→Skills→Platform→Core→Runtime→Providers→External. No upward deps. |
| §8 | Extensibility/registration | ✓ Every domain concept is a registered pack. |
| §9 | Tech eval policy | ✓ No mandatory external deps added; Unlimited-OCR study-only. |
| §11 | Governance pipeline | ✓ This RFC = stages 13; ADR = stage 14; Implementation Plan = stage 15. |
| §12 | Constitution decision gate | ✓ "Can this become a plugin? — Yes (packs are plugins). Does this improve extensibility? — Yes." |
| §16 | Security | ✓ Permissions additive, OCR/VLM behind network gate, no supply-chain dep added. |
| §18 | Required deliverables | ✓ All 18 delivered across ARCHITECTURE_REVIEW.md + this RFC + ADR-0024. |

---

## 17. Open Questions

1. Should `src/apps/` live inside `src/` or as a sibling `apps/` dir at repo root? Recommendation: `src/apps/` to keep one compiled output, but mark each pack as a separate entry point in `package.json` `exports` so packs are independently consumable.
2. Should the SWE pack be `@quack/app-swe` (separate package) or `@quack/os/apps/swe` (subpath)? RFC recommends separate packages in Phase 5 for true modularity, subpath during Phases 1-4 to minimize churn.
3. Do we add a QUACK-Spec for "domain pack manifest" analogous to `PluginManifest`? Recommendation: yes, as a follow-up RFC-0002.

---

## 18. Recommendation

**Adopt this RFC. Record the decision in ADR-0024. Begin Phase 1 immediately after a constitutional review pass confirms zero regression risk. Stop implementation here — Implementation Phase is gated by the Implementation Plan in ARCHITECTURE_REVIEW.md §15 and Constitution §11 stages 16-20 (validation → implementation → regression → docs → re-audit).**
