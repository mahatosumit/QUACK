# QUACK Loop & Harness Convergence Research

**Mission**: Converge QUACK's execution loop and harness architecture with patterns from DeepSeek Harness and Ruflo, while preserving QUACK's core invariants.

**Date**: 2026-08-18  
**Sources**: 
- deepseek-ai/deepseek-harness (GitHub)
- ruvnet/ruflo (GitHub)
- QUACK existing research: paperclipai/paperclip, yc-software/qm, andrewyng/openworker, MervinPraison/PraisonAI, msitarzewski/agency-agents, gastownhall/gastown, the-open-engine/zeroshot

---

## 1. DEEPSEEK HARNESS ANALYSIS

### Architecture: "Everything is a Plugin" (Cordis-based)

#### Key Architectural Properties

| Feature | Classification | QUACK Adoption |
|---------|----------------|----------------|
| Capability seams (Service Definition/Provider/Consumer) | **ADOPT** | Core pattern for QUACK plugin system |
| Plugin lifecycle with reversible registrations | **ADOPT** | Critical for QUACK plugin registry |
| Profiles/config composition (cordis.yml overlays) | **ADAPT_PATTERN_ONLY** | QUACK uses its own config system |
| Append-only session events | **ADOPT** | Converge with Flight Recorder |
| Durable replay | **ADOPT** | Converge with Flight Recorder replay |
| Model-visible-input reconstruction | **ADOPT** | Required for prompt-injection containment |
| Guarded tool pipeline | **ADOPT** | QUACK already has capability broker |
| Subagent provider registry | **ADOPT** | Needed for harness provider registry |
| One-shot children | **ADOPT** | QUACK company runtime supports this |
| Continuable children (durable identity + temp compute) | **ADOPT** | Key gap - QUACK needs cold resume |
| Cold resume | **ADOPT** | Major gap - implement via dormant agent snapshots |
| Child activations | **ADOPT** | QUACK company runtime has this |
| Lineage tracking | **ADOPT** | QUACK has parent authorization |
| Capability negotiation | **ADOPT** | QUACK capability broker |
| Tool filtering | **ADOPT** | QUACK tool scoping exists |
| Persona scoping | **ADAPT_PATTERN_ONLY** | QUACK has skill/agent roles |
| Depth limits | **ADOPT** | QUACK has maxDelegationDepth |
| Structured output | **ADOPT** | QUACK contracts support this |
| Child reporting (quiet vs wake-parent) | **ADOPT** | Major gap - QUACK needs report delivery modes |
| Child-first teardown | **ADOPT** | QUACK company runtime finalize does this |
| Background jobs | **ADAPT_PATTERN_ONLY** | QUACK has mission companies |
| Session fork/resume | **ADOPT** | QUACK needs mission fork |

#### What NOT to Adopt
- **Cordis as mandatory framework** - QUACK keeps its own DI/event system
- Vendored dependency model - QUACK uses standard npm
- TypeScript-only - QUACK supports multi-language via adapters

---

## 2. RUFLO ANALYSIS

### Architecture: "Meta-harness" for Claude Code/Codex

#### Key Architectural Properties

| Feature | Classification | QUACK Adoption |
|---------|----------------|----------------|
| Meta-harness model | **ADAPT_PATTERN_ONLY** | QUACK has harness registry |
| Swarm/team orchestration | **ADOPT** | QUACK company runtime |
| Hierarchical coordination | **ADOPT** | QUACK supervisor + specialists |
| Anti-drift controls | **ADOPT** | Progress/doom-loop detectors |
| Worktree isolation | **ADOPT** | QUACK needs Windows-reliable implementation |
| Agent monitoring | **ADAPT_PATTERN_ONLY** | QUACK agent monitor exists |
| Autonomous completion loops | **ADAPT_PATTERN_ONLY** | QUACK agent loop |
| Progress tracking | **ADOPT** | Major gap - implement ProgressSnapshot |
| Event-driven wakeups | **ADOPT** | QUACK loop needs event wakeups |
| Resumable workflows | **ADOPT** | QUACK workflow runtime |
| Pause/resume/cancel state machine | **ADOPT** | QUACK loop state machine |
| Parallel fan-out | **ADOPT** | QUACK DAG supports this |
| Pipelines | **ADOPT** | QUACK DAG pipeline operator |
| Phase orchestration | **ADOPT** | QUACK DAG phase operator |
| Learned task patterns | **ADOPT** | QUACK learning loop |
| Trajectory recording | **ADOPT** | QUACK Flight Recorder |
| Retrieve→Judge→Distill→Consolidate | **ADOPT** | QUACK learning pipeline |
| Goal decomposition | **ADOPT** | QUACK planner |
| Cost tracking | **ADOPT** | QUACK needs per-mission/agent tracking |
| Observability | **ADOPT** | QUACK needs loop doctor |
| Security scanning | **ADAPT_PATTERN_ONLY** | QUACK has approval/policy |
| Metaharness health/config evaluation | **ADOPT** | QUACK harness doctor |

#### What NOT to Adopt (for current solo release)
- ❌ Huge permanent swarms (100+ agents)
- ❌ Distributed federation / cross-machine swarm networking
- ❌ Byzantine consensus / Raft for local missions
- ❌ Uncontrolled neural training
- ❌ Autonomous production modification
- ❌ Exact Claude-specific heartbeat timings
- ❌ Unnecessary plugin explosion

---

## 3. QUACK CURRENT STATE AUDIT

### Existing Strengths (Preserve)

✅ **Zero permanent compute agents at boot** - Company runtime creates/destroys
✅ **Objective-specific temporary teams** - MissionCompanyRuntime
✅ **Mission/agent/lease execution principals** - CompanyExecutionPrincipal
✅ **Identity validation before privileged discovery** - ActionRuntime validateExecutionContext
✅ **Bounded DAG scheduler** - SEA with maxParallelNodes
✅ **Dependencies, concurrency limits, resource locks** - SEA/Company runtime
✅ **Retries, timeout/cancellation drain** - AgentLoop budget/stall detection
✅ **Verifier-last enforcement** - MissionCompanyRuntime markVerifying/recordVerification
✅ **Durable task state** - CompositeTaskStore + SQLite
✅ **Dormant agent snapshots** - MissionCompanyRuntime finalize → DORMANT
✅ **Knowledge/evidence persistence** - MemoryManager + learning experiences
✅ **Provider-independent routing** - CapabilityProviderRouter
✅ **Action Runtime** - DefaultExecutionHarness + ActionRuntime
✅ **MCP runtime** - McpServerRegistry + action providers
✅ **Browser runtime** - PlaywrightBrowserActionProvider
✅ **Durable action ledger** - SQLite action_executions table
✅ **Approval gates** - RiskAwareApprovalPolicy + capability broker
✅ **Mission Flight Recorder direction** - Harness traceRecorder
✅ **Knowledge Fabric direction** - SemanticLayer + KnowledgeIngestionPipeline

### Critical Gaps (Must Fix)

| Gap | Source | Priority |
|-----|--------|----------|
| **Harness Contract v2** (metadata, health, capabilities, start/send/stream/checkpoint/resume/pause/cancel/interrupt/status/shutdown) | DeepSeek | P0 |
| **Harness Provider Registry** (QUACK_NATIVE, CODEX, OPENCODE, CLAUDE_CODE, HERMES, PRAISON, DEEPSEEK_HARNESS) | DeepSeek | P0 |
| **Harness Certification** (H0-H6 levels) | DeepSeek | P0 |
| **Progress Detector** (ProgressSnapshot with score) | Ruflo | P0 |
| **Doom-Loop Detector** (fingerprint-based) | Ruflo | P0 |
| **Event-driven Loop Wakeups** (not blind polling) | Ruflo | P0 |
| **Background Job Runtime** (start/status/streamOutput/cancel/wait/cleanup) | Ruflo | P0 |
| **Continuable Subagents** (durable identity + cold resume) | DeepSeek | P0 |
| **Child Report Delivery Modes** (QUIET vs WAKE_PARENT) | DeepSeek | P0 |
| **Tool Filtering** (visibility + runtime authorization) | DeepSeek | P0 |
| **Worktree Isolation** (Windows reliability gate) | Ruflo | P1 |
| **Learning Loop** (RETRIEVE→JUDGE→DISTILL→CONSOLIDATE) | Ruflo | P1 |
| **Trajectory Recording** (Flight Recorder integration) | Ruflo | P1 |
| **Routing from Learned Performance** | Ruflo | P1 |
| **Mission Fork** (safe branching) | DeepSeek | P1 |
| **Approval Pause/Resume** (release compute while waiting) | DeepSeek | P1 |
| **External Wait Support** (WAITING_FOR_EXTERNAL_EVENT) | Ruflo | P1 |
| **Loop Doctor / Harness Doctor** | Ruflo/DeepSeek | P1 |
| **NVIDIA Live Path Certification** | QUACK | P0 |
| **Windows Worktree Determinism** (20 consecutive PASS) | QUACK | P0 |

---

## 4. CLASSIFICATION DECISIONS

### ADOPT (Implement in QUACK Core)
1. Capability seams: Service Definition → Provider → Consumer
2. Reversible plugin registration (load→use→unload→reload test)
3. Append-only canonical event log (converge with Flight Recorder)
4. Model-visible provenance (source, trust class, timestamp, mission, agent, evidence ref)
5. Single normalized execution loop (PREPARE→REQUEST→ACT→OBSERVE→ASSESS→REPLAN→WAIT→VERIFY→COMPLETE→FAIL→CANCEL)
6. Explicit loop bounds (maxIterations, maxDuration, maxTokens, maxCost, maxRetries, maxConsecutiveFailures, maxNoProgressIterations, maxDelegationDepth, maxAgents, maxConcurrentAgents)
7. ProgressSnapshot with progress_score
8. Doom-loop detector with fingerprints
9. Event-driven wakeups (tool completion, background job, approval, child report, file change, Git, test, timer)
10. Background job contract (QUEUED→RUNNING→SUCCEEDED/FAILED/CANCELLED/TIMED_OUT)
11. Temporary team model (1 Supervisor, 2-5 Specialists, 1 Verifier = 6-8 max)
12. Hierarchical anti-drift (authoritative mission state + optimistic concurrency)
13. Task specialization (narrow responsibilities)
14. One-shot subagents (parent→task→child→structured result→teardown)
15. Continuable subagents (PERSISTED AGENT INSTANCE → optional LIVE ACTIVATION)
16. Subagent provider contract (advertise capabilities BEFORE start)
17. Child authorization (verify mission, parent, child, principal, lease, lineage)
18. Tool filtering (visibility + runtime authorization)
19. Delegation depth (persist absolute depth)
20. Child reporting (ChildReport with QUIET/WAKE_PARENT delivery)
21. Child-first teardown (stop admissions → cancel descendants → drain → flush → dispose → release)
22. Workflow runtime (CREATED→RUNNING→PAUSED→RUNNING→COMPLETED/CANCELLED/FAILED)
23. Orchestration operators (agent, parallel, pipeline, phase, sequence, route, join, verify, repeatUntil, fallback)
24. Checkpoint/Resume (mission state, task states, agent descriptors, dependencies, budgets, artifacts, evidence, knowledge, provider decisions, workflow position)
25. Mission Fork (source mission, event boundary, new mission ID, new policy, new provider/harness)
26. Learning loop (RETRIEVE→JUDGE→DISTILL→CONSOLIDATE from VERIFIED only)
27. Trajectory recording (Flight Recorder as source)
28. Routing from learned performance (below hard policy)
29. Self-improvement boundary (Forge experiment → benchmark → RFC → OWNER APPROVAL)
30. Worktree isolation (Agent→worktree, Merge Coordinator)
31. Harness contract v2 (metadata, health, capabilities, start, send, stream, checkpoint, resume, pause, cancel, interrupt, status, shutdown)
32. Harness provider registry (multiple implementations coexist)
33. Harness certification (H0-H6)
34. Plugin/capability seams (justified only when multiple implementations exist)
35. Reversible runtime registration
36. Canonical durable event log
37. Model-visible provenance
38. Agent loop contract
39. Loop policy with completion reasons
40. Progress detector
41. Doom-loop detector
42. Event-driven loop wakeups
43. Background job runtime
44. Temporary swarm/team model
45. Hierarchical anti-drift
46. Task specialization
47. One-shot subagents
48. Continuable subagents
49. Subagent provider contract
50. Child authorization
51. Tool filtering
52. Delegation depth
53. Child reporting
54. Child-first teardown
55. Workflow runtime
56. Orchestration operators
57. Checkpoint/resume
58. Mission fork
59. Learning loop
60. Trajectory recording
61. Routing from learned performance
62. Self-improvement boundary
63. Worktree isolation (after Windows gate)
64. Windows worktree reliability
65. Provider + harness matrix
66. NVIDIA production proof
67. Ollama release policy
68. MCP/tool pipeline
69. Background loop security
70. Approval pause/resume
71. External wait
72. Cost control
73. Observability
74. Harness health/metaharness
75. Loop health
76. Loop state machine tests (LOOP-001 to LOOP-020)
77. Harness conformance tests (HAR-001 to HAR-020)
78. Subagent tests (SUB-001 to SUB-018)
79. Workflow tests (WF-001 to WF-015)
80. Plugin tests (PLG-001 to PLG-010)
81. Learning tests (LRN-001 to LRN-010)

### ADAPT_PATTERN_ONLY (Take Principle, Not Implementation)
1. Cordis plugin architecture → QUACK PluginRegistry
2. Ruflo meta-harness → QUACK HarnessRegistry
3. Ruflo swarm coordination → QUACK CompanyRuntime
4. Ruflo goal planner → QUACK Planner
5. Ruflo vector memory → QUACK SemanticLayer
6. Ruflo federation → QUACK future distributed adapter
7. DeepSeek session log → QUACK Flight Recorder

### OPTIONAL_ADAPTER (External Integration Points)
1. LiteLLM / Portkey / TensorZero / Vercel AI SDK → Provider adapters
2. E2B / Daytona / ToolHive → Environment adapters
3. Playwright MCP / Browser Use → Browser adapters
4. Zapier / Composio / Activepieces / n8n / Pipedream → MCP adapters
5. Dapr Agents → Future distributed adapter
6. OpenHands / OpenAkita → Optional worker adapters
7. DeepSeek Harness → Harness adapter
8. Ruflo → Harness adapter
9. Codex / OpenCode / Claude Code / Hermes / PraisonAI → Harness adapters
10. ACP agents → Future harness adapter

### REFERENCE_ONLY
1. Karpathy LLM Wiki (immutable sources, derived knowledge)
2. OpenAkita (AGPL - pool/blackboard concepts only)
3. Gas Town (worktree patterns but Windows limitations)

### REJECT_FOR_CURRENT_RELEASE
1. Permanent 100+ agent swarms
2. Distributed federation / cross-machine networking
3. Byzantine / Raft consensus for local missions
4. Uncontrolled neural training
5. Autonomous source modification
6. Claude-specific heartbeat timings
7. Unnecessary plugin explosion

---

## 5. IMPLEMENTATION ROADMAP

### Phase 1: Foundation (Week 1-2)
- [ ] Harness Contract v2 interface
- [ ] Harness Provider Registry
- [ ] Harness Certification framework (H0-H6)
- [ ] Loop Contract (state machine, bounds, completion reasons)
- [ ] Progress Detector (ProgressSnapshot)
- [ ] Doom-Loop Detector (fingerprints)
- [ ] Event-driven Loop Wakeups

### Phase 2: Execution Core (Week 2-3)
- [ ] Background Job Runtime
- [ ] Continuable Subagents (cold resume)
- [ ] Child Report Delivery Modes
- [ ] Tool Filtering (visibility + runtime auth)
- [ ] Mission Fork
- [ ] Approval Pause/Resume
- [ ] External Wait Support

### Phase 3: Workflow & Learning (Week 3-4)
- [ ] Workflow Runtime (persisted + stateless)
- [ ] Orchestration Operators
- [ ] Checkpoint/Resume
- [ ] Learning Loop (RETRIEVE→JUDGE→DISTILL→CONSOLIDATE)
- [ ] Trajectory Recording (Flight Recorder)
- [ ] Routing from Learned Performance

### Phase 4: Hardening & Tests (Week 4-5)
- [ ] Loop State Machine Tests (20 tests)
- [ ] Harness Conformance Tests (20 tests)
- [ ] Subagent Tests (18 tests)
- [ ] Workflow Tests (15 tests)
- [ ] Plugin Tests (10 tests)
- [ ] Learning Tests (10 tests)
- [ ] Windows Worktree Reliability (20 consecutive PASS)
- [ ] NVIDIA Live Path Certification
- [ ] Ollama Release Decision

### Phase 5: Production Completion Mission (Week 5-6)
- [ ] Real QUACK-on-QUACK mission
- [ ] Endurance & resource cleanup
- [ ] Final readiness report

---

## 6. DOCUMENTATION TO CREATE/UPDATE

- `docs/architecture/HARNESS_RUNTIME.md`
- `docs/architecture/EXECUTION_LOOP.md`
- `docs/architecture/SUBAGENT_RUNTIME.md`
- `docs/architecture/WORKFLOW_RUNTIME.md`
- `docs/architecture/PLUGIN_CAPABILITY_SEAMS.md`
- `docs/architecture/BACKGROUND_JOBS.md`
- `docs/architecture/FLIGHT_RECORDER.md`
- `docs/agents/CONTEXT_POLICY.md`
- `docs/agents/DELEGATION.md`
- `docs/agents/VERIFICATION.md`
- `docs/production/PRODUCTION_READINESS_REPORT.md`
- `docs/production/COMPANY_RUNTIME_READINESS_REPORT.md`
- `docs/production/PERFORMANCE_REPORT.md`
- `docs/security/THREAT_MODEL.md`

---

## 7. FINAL READINESS CRITERIA

These are proposed acceptance criteria, not current test results. The native harness currently reports `H0_DETECTED` (uncertified); the higher-level criteria below remain unmet.

Before private readiness:

| Category | Criteria |
|----------|----------|
| BASELINE | BUILD, TYPECHECK, LINT, FULL REGRESSION ×5 PASS; Windows nondeterminism CLOSED |
| HARNESS | Contract PASS, Native H6, Capability checks PASS, Cancel PASS, Checkpoint PASS, Resume PASS, Failure recovery PASS |
| LOOP | Contract PASS, Progress detection PASS, No-progress PASS, Doom-loop PASS, Event wake PASS, Approval pause/resume PASS, Background jobs PASS, Restart PASS |
| SUBAGENTS | One-shot PASS, Continuable PASS, Cold resume PASS, Direct-parent auth PASS, Tool scoping PASS, Depth limit PASS, Child report PASS, Child-first teardown PASS |
| WORKFLOW | Sequence PASS, Parallel PASS, Pipeline PASS, Join PASS, Route PASS, Phase PASS, Pause/resume PASS, Bounded repeat PASS, Verifier-last PASS |
| PROVIDERS | NVIDIA LIVE PASS, Ollama PASS or OPTIONAL_NOT_INSTALLED, Privacy boundary PASS |
| SECURITY | MCP isolation PASS, Network/DNS PASS, Action ledger PASS, Approval PASS, Secret redaction PASS, CRITICAL=0, HIGH=0 |
| RECOVERY | Mission restart PASS, Action reconciliation PASS, Orphan agents=0, Orphan jobs=0, Orphan worktrees=0, Orphan MCP=0 |
| LEARNING | Verified trajectories PASS, Pattern distillation PASS, Provenance PASS, No auto source promotion PASS |
| E2E | Real self-hosted QUACK production-completion mission PASS |

**Final Label**: One of `COMPANY_RUNTIME_READY`, `COMPANY_RUNTIME_READY_WITH_WARNINGS`, `COMPANY_RUNTIME_NOT_READY`  
**Public Distribution**: `YES` / `NO`