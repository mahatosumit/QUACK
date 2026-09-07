# QUACK Runtime Architecture Audit

**Status:** Canonical audit for Phase 0 of production hardening  
**Generated:** 2026-08-17  
**Scope:** Complete QUACK v1 runtime — `src/runtime`, `src/brain`, `src/agent-loop`, `src/engine`, `src/skills`, `src/security`, `src/harness`, `src/contracts`, `src/providers`, `src/storage`, `src/events`, `src/memory`, `src/tools`, `src/cos`

---

## 1. Executive Summary

QUACK currently implements **three competing executive loops** with **three overlapping state models** and **no unified mission lifecycle**. The codebase contains production-grade building blocks (capability broker, skill registry with versioning, action contract, workflow engine, checkpoint/recovery) but they are **not integrated into a single coherent runtime**. The audit identifies 47 architectural problems across 12 categories.

**Critical finding:** No single component owns mission execution end-to-end. `QuackRuntime.submitGoal`, `AgentLoop.start`, and `WorkflowEngine.executeLoop` all claim to execute missions but operate on different state models, different persistence boundaries, and different concurrency assumptions.

---

## 2. Current Call Graph

### 2.1 Primary Entry Points

```
POST /missions (api/index.ts)
  → QuackRuntime.submitGoal()           [src/runtime/runtime.ts:122]
  → AgentLoop.start()                    [src/agent-loop/index.ts:227]
  → MissionManager.create()              [src/cos/mission-manager.ts]

CLI: quack run <goal>
  → QuackRuntime.submitGoal()

Desktop: Goal submission
  → AgentLoop.start()
```

### 2.2 QuackRuntime.submitGoal Flow

```
QuackRuntime.submitGoal(goal, actor, options)
  → taskStore.save(Task{status: "created"})                    [runtime.ts:132]
  → eventBus.emit("task.created")
  → skillSelector.select({goal})                               [runtime.ts:144]
  → eventBus.emit("skill.selected")
  → brain.plan(task, brainContext)                             [runtime.ts:154]
  → taskStore.save(Task{status: "planned", plan: TaskStep[]})  [runtime.ts:167]
  → eventBus.emit("task.planned")
  → taskStore.save(Task{status: "running"})                    [runtime.ts:170]
  → eventBus.emit("task.started")
  → brain.execute(task, brainContext)                          [runtime.ts:173]
  → executeSelectedPortableSkills()                            [runtime.ts:181]
  → memory.write()                                             [runtime.ts:202]
  → taskStore.save(Task{status: "completed"})                  [runtime.ts:209]
  → eventBus.emit("task.completed")
  → improvementCoordinator.onMissionCompleted()                [runtime.ts:228]
```

### 2.3 ExecutiveBrain.plan Flow

```
ExecutiveBrain.plan(task, context)
  → ensureSession()                                             [executive-brain.ts:78]
  → eventBus.emit("task.started")
  → memory.search()                                             [executive-brain.ts:81]
  → planner.createPlan(goal, context)                          [executive-brain.ts:87]
  → eventBus.emit("task.planned")
  → Map engine Plan → brain Plan (PlanStep[])
  → return Plan
```

### 2.4 ExecutiveBrain.execute Flow

```
ExecutiveBrain.execute(task, context)
  → plan(task, context)  // Re-plans!                          [executive-brain.ts:136]
  → buildGraphFromPlan()                                        [executive-brain.ts:350]
  → buildWorkflowState()                                        [executive-brain.ts:368]
  → sessionRuntime.startWorkflow()                              [executive-brain.ts:144]
  → pollWorkflowCompletion()                                    [executive-brain.ts:166]
  → runReflection()                                             [executive-brain.ts:177]
  → runRecovery()                                               [executive-brain.ts:184]
  → eventBus.emit("task.completed")
  → return ExecutionResult
```

### 2.5 SessionRuntime → WorkflowEngine Flow

```
SessionRuntime.startWorkflow(sessionId, goal, workflowState, executeTool)
  → WorkflowEngine.start(graph, workflowId, sessionId, planId)  [workflow-engine.ts:41]
  → WorkflowEngine.executeLoop(workflow, sessionId)             [workflow-engine.ts:133]
    while (!cancelled && !executor.isComplete())
      → checkpointManager.create()                              [workflow-engine.ts:146]
      → executor.getReadyNodes()                                [workflow-engine.ts:155]
      → scheduler.enqueue(readyNodes)                           [workflow-engine.ts:157]
      → executor.markRunning(node.id)                           [workflow-engine.ts:159]
      → scheduler.dequeue() → executeNode()                     [workflow-engine.ts:168]
        executeNode(node, sessionId)
          → executeNodeWork()                                   [workflow-engine.ts:270]
            for invocation in node.toolInvocations
              → resolveInvocationInput()                        [workflow-engine.ts:359]
              → config.executeTool()                            [workflow-engine.ts:319]  ← USER CALLBACK
              → journal.write("tool.completed")
              → on failure: return failed TaskNodeResult
          → reflection.reflect()                                [workflow-engine.ts:226]
          → on retry: recovery.buildRecoveryPlan()              [workflow-engine.ts:232]
          → executor.markCompleted/Failed/Retrying
      → skipBlockedNodes()                                      [workflow-engine.ts:453]
      → delay(50)
    → checkpointManager.create() (final)
    → workflow.status = completed/failed
```

### 2.6 AgentLoop.start Flow

```
AgentLoop.start(options)
  → createLoopRun({budget})                                     [executive-loop.ts:356]
  → while (true)
      → evaluateBudget()                                        [executive-loop.ts:169]
      → waitIfPaused()
      → inferPhase() → legacyFromPhase()
      → runIteration()                                          [agent-loop.ts:485]
        observe()                                               [agent-loop.ts:578]
        planner.createPlan()                                    [agent-loop.ts:497]
        selectAction()  ← picks FIRST node with toolInvocations [agent-loop.ts:606]
        executeAction()                                         [agent-loop.ts:617]
          for invocation in action.toolInvocations
            → deps.executeTool()                                [agent-loop.ts:621]
        verify()                                                [agent-loop.ts:644]
        reflect()                                               [agent-loop.ts:656]
        memory.write() + memoryManager.store()
      → fromLegacyIteration() → appendIteration()               [executive-loop.ts:378]
      → eventBus.emit("loop.iteration")
      → if verification.success → STOP_GOAL_ACHIEVED
      → if capabilityDenied → STOP_POLICY_DENIED
      → detectStall()                                           [executive-loop.ts:205]
      → if stall → stopReasonForStall() → terminate or replan
      → recoveryAttempts++ → if > maxRecoveryAttempts → STOP_UNRECOVERABLE_ERROR
```

---

## 3. State Ownership

| State | Owner | Persistence | Concurrency Model |
|-------|-------|-------------|-------------------|
| `MissionDefinition` | `MissionManager` | SQLite (`missions` table) | Single-writer via mutex (not enforced) |
| `Task` | `QuackRuntime` → `TaskStore` | InMemory / JsonFile | No locking; `InMemoryTaskStore` is not thread-safe |
| `AgentLoopState` | `AgentLoop` (singleton field!) | In-memory only | **RACE**: One instance field shared across concurrent missions [audit §16] |
| `LoopRun` + `IterationRecord` | `AgentLoop` (per-call) | In-memory only | Per-mission but not persisted |
| `WorkflowState` | `WorkflowEngine` | In-memory + checkpoint (JSON) | Single workflow per engine instance |
| `SessionState` | `SessionRuntime` | In-memory + snapshot (JSON) | Max 5 concurrent sessions |
| `SkillRecord` | `SkillRegistry` | JSON file (optional) | No locking; `Map` mutations not atomic |
| `CapabilityGrant` | `CapabilityGrantRegistry` | JSON file (optional) | InMemory: no locking; JsonFile: atomic rename |
| `ProviderCapabilities` | `ProviderRegistry` | In-memory only | No locking |
| `EventBus` handlers | `EventBus` | In-memory only | Async emit; no ordering guarantees |
| `MemoryStore` | `MemoryManager` / `MemoryStore` | SQLite + vector | Unclear isolation |

**Critical Issues:**
- `AgentLoop` has a **singleton `state` field** (`this.state`) that is mutated during execution. Two concurrent `start()` calls will race on this field.
- `QuackRuntime` uses `InMemoryTaskStore` by default — no persistence across restarts.
- `WorkflowEngine` keeps `WorkflowState` in memory; checkpoints are periodic but not guaranteed per-action.
- No single source of truth for "what is the current mission state?"

---

## 4. Execution Ownership

| Component | What It Executes | How It Executes | Authority |
|-----------|------------------|-----------------|-----------|
| `QuackRuntime` | `Task` (plan → execute) | Delegates to `Brain` | High: user-facing entry |
| `ExecutiveBrain` | `Plan` → `TaskGraph` → `WorkflowEngine` | Creates workflow, polls completion | Medium: internal |
| `SessionRuntime` | `WorkflowEngine` | Manages sessions, starts workflows | Medium: session-scoped |
| `WorkflowEngine` | `TaskGraph` nodes | Scheduler + `TaskGraphExecutor` + tool callback | Low: node-level |
| `AgentLoop` | Iterations (observe→plan→act→verify) | Direct tool calls via `deps.executeTool` | High: alternative entry |
| `DurableSkillSandboxRuntime` | Portable skill steps | Compiles to `TaskGraph` → `WorkflowEngine` | Low: skill-scoped |

**Critical Issue:** Three components can execute tools:
1. `WorkflowEngine.executeNodeWork()` → `config.executeTool()` (user callback)
2. `AgentLoop.executeAction()` → `deps.executeTool()` (direct)
3. `QuackRuntime.executeTool()` → `ToolRegistry` + capability broker

All three bypass each other's authorization, budget, and observability.

---

## 5. Persistence Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                        SQLITE (storage/sqlite.ts)               │
│  missions, tasks, skills, grants, checkpoints, journal,        │
│  evidence, verification, learning, improvement, snapshots      │
└─────────────────────────────────────────────────────────────────┘
                              ↑
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│ JsonFileTask  │     │ JsonFileSkill │     │ JsonFileGrant │
│ Store         │     │ Registry      │     │ Registry      │
│ (tasks.json)  │     │ (skills.json) │     │ (grants.json) │
└───────────────┘     └───────────────┘     └───────────────┘
        ▲                     ▲                     ▲
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      IN-MEMORY (Default)                        │
│  InMemoryTaskStore, InMemoryCapabilityGrantRegistry,           │
│  SkillRegistry (Map), ProviderRegistry, EventBus,              │
│  AgentLoop.state, WorkflowEngine.state, SessionRuntime.state   │
└─────────────────────────────────────────────────────────────────┘
```

**Critical Issues:**
- **Default is in-memory.** `QuackRuntime` constructs `InMemoryTaskStore` if no `taskStore` provided.
- `SkillRegistry` persistence is opt-in via `attachStore()` — not automatic.
- `CapabilityGrantRegistry` has both InMemory and JsonFile variants but no SQLite backend.
- `WorkflowEngine` checkpoints to `CheckpointManager` (InMemory or JsonFile) — not SQLite.
- `AgentLoop` `LoopRun` + `IterationRecord` are **never persisted**.
- No transaction boundary spans mission + task + skill + grant + checkpoint.

---

## 6. Async Boundaries

| Boundary | Mechanism | Cancellation | Timeout |
|----------|-----------|--------------|---------|
| `QuackRuntime.submitGoal` → `Brain.plan/execute` | `async/await` | No | No |
| `ExecutiveBrain` → `SessionRuntime.startWorkflow` | `async` returns `WorkflowState` immediately; loop runs in background | `WorkflowEngine.cancel()` | `pollWorkflowCompletion(300000)` |
| `WorkflowEngine.executeLoop` | Background `while` loop + `setTimeout` guards | `this.cancelled` flag + `clearTimeout` | Per-node `timeoutMs` + global 300s |
| `AgentLoop.start` | Synchronous `while(true)` with `withTimeout` per iteration | `this.stopped` flag | `iterationTimeoutMs` (default 30s) |
| `WorkflowEngine.executeNode` | `setTimeout` per node | `clearTimeout` on completion | `node.timeoutMs` (default 120s) |
| `DurableSkillSandboxRuntime.execute` | `WorkflowEngine` + `pollWorkflow` | `engine.cancel()` | `maxPollMs` (default 10s) |
| Tool execution | `deps.executeTool()` callback | No propagation | No |
| Model inference | `ProviderAdapter.generate()` | `ExecutionContextV1.signal` (AbortSignal) | No default |

**Critical Issues:**
- **No unified cancellation propagation.** `AgentLoop.stop()` sets a flag but does not cancel in-flight tool calls or workflow nodes.
- `WorkflowEngine` runs its loop in a fire-and-forget promise (`void loopPromise`); errors only logged.
- `AgentLoop` uses `Promise.race` with timeout but the underlying tool call continues executing.
- `QuackRuntime.submitGoal` has no timeout or cancellation at all.
- `AbortSignal` exists in `ExecutionContextV1` but is not threaded through `QuackRuntime.executeTool` → `ToolRegistry` → tool implementation.

---

## 7. Concurrency Assumptions

| Component | Assumption | Reality |
|-----------|------------|---------|
| `AgentLoop` | Single mission at a time | **FALSE** — singleton `state` field shared |
| `QuackRuntime` | Sequential `submitGoal` | **FALSE** — no queue, no locking |
| `SessionRuntime` | Max 5 sessions | Enforced but sessions share `WorkflowEngine` config |
| `WorkflowEngine` | Single workflow per engine | Enforced by `currentWorkflowId` |
| `SkillRegistry` | Single-threaded registration | **FALSE** — `Map` mutations not atomic |
| `CapabilityGrantRegistry` | Single-threaded | **FALSE** — InMemory uses `Map` |
| `EventBus` | Handlers complete quickly | No backpressure; slow handler blocks `emit` |
| `InMemoryTaskStore` | Single-threaded | **FALSE** — no locking |
| `ProviderRegistry` | Single-threaded | **FALSE** — no locking |

**Critical Issue:** The audit §16/§27.1 finding is confirmed: `AgentLoop` has a **single instance `state` field** (`private latestRun?: LoopRun`) that is mutated during `start()`. Two concurrent `POST /missions` → `AgentLoop.start()` will overwrite each other's `latestRun`, `latestLegacyIterations`, `paused`, `stopped`.

---

## 8. Retry Ownership

| Layer | Retries What | Policy | Ownership |
|-------|--------------|--------|-----------|
| `WorkflowEngine` | Node execution | `node.retryPolicy` (exponential, 3 retries, 1s base) | Engine |
| `TaskGraphExecutor` | Node status transitions | Internal; marks `retrying` → `pending` | Executor |
| `RecoveryEngine` | Failed node recovery | `buildRecoveryPlan()` → retry with backoff | Brain |
| `ExecutiveBrain` | Workflow-level | `config.retryPolicy` (3 retries) | Brain |
| `AgentLoop` | Iteration-level | `maxRecoveryAttempts` (default 1) + replans | Loop |
| `QuackRuntime` | Tool execution | **NONE** — tool failures propagate immediately | N/A |
| `CapabilityBroker` | Permission decisions | **NONE** — single decision | N/A |
| Provider adapters | Model calls | Provider-specific (not normalized) | Provider |

**Critical Issues:**
- **Multi-layer retry without coordination.** A tool failure in `WorkflowEngine` triggers node retry (3×), then recovery retry (1×), then `AgentLoop` replan (up to `maxIterations`), then `ExecutiveBrain` retry (3×). Total: ~20× for one failure.
- `QuackRuntime.executeTool` has **no retry** — failures bubble up immediately.
- `CapabilityBroker.resolve()` is called per-tool-per-invocation; no caching, no retry on transient denial.
- No idempotency key propagation from `AgentLoop` → `executeTool` → harness (audit §19).

---

## 9. Timeout Ownership

| Scope | Timeout | Enforced By |
|-------|---------|-------------|
| Mission wall-clock | `maxExecutionTimeMs` (AgentLoop budget) | `evaluateBudget()` in loop driver |
| Iteration | `iterationTimeoutMs` (default 30s) | `AgentLoop.withTimeout()` |
| Workflow | 300s (hardcoded in `pollWorkflowCompletion`) | `ExecutiveBrain.execute()` |
| Workflow node | `node.timeoutMs` (default 120s) | `WorkflowEngine.executeNode()` `setTimeout` |
| Skill sandbox | `maxPollMs` (default 10s) | `pollWorkflow()` |
| Tool execution | **NONE** | N/A |
| Model inference | **NONE** (provider-dependent) | N/A |
| Human approval | **NONE** | N/A |
| Capability grant check | **NONE** | N/A |
| Database operation | **NONE** | N/A |

**Critical Issues:**
- Tool execution has **no timeout** — a hung tool blocks the entire iteration/workflow.
- Model inference has no timeout at the runtime level.
- Human approval path has no timeout — mission can wait forever.
- `QuackRuntime.submitGoal` has no timeout at all.

---

## 10. Cancellation Propagation

```
User/API Cancel
    │
    ▼
┌─────────────────────────────────────────────┐
│  QuackRuntime.cancelTask()                  │  NOT IMPLEMENTED
│  MissionManager.cancelMission()             │  NOT IMPLEMENTED
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│  AgentLoop.stop() → this.stopped = true     │  Sets flag only
│  Does NOT cancel in-flight tool call        │
│  Does NOT cancel workflow engine            │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│  WorkflowEngine.cancel()                    │  Clears timers,
│  Sets this.cancelled = true                 │  releases scheduler
│  Does NOT cancel in-flight tool callback    │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│  Tool Execution (deps.executeTool)          │  NO CANCELLATION
│  Runs to completion or error                │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│  ProviderAdapter.cancel(executionId)        │  Optional interface
│  Only some providers implement              │
└─────────────────────────────────────────────┘
```

**Critical Issues:**
- **Cancellation is cooperative and incomplete.** `AgentLoop.stop()` and `WorkflowEngine.cancel()` only set flags. In-flight tool executions **continue to completion**.
- `ExecutionContextV1` carries `signal?: AbortSignal` but it is **never used** by `QuackRuntime.executeTool` or passed to tools.
- No cancellation from mission → loop → harness → provider → subprocess.

---

## 11. Permission Boundaries

### 11.1 Current Flow

```
Tool Invocation
    │
    ▼
QuackRuntime.executeTool()  [runtime.ts:320]
    │
    ├── validateToolInput()
    │
    ├── tool.describe().permissions → for each permission:
    │       buildToolCapabilityRequest()  [capability-broker.ts:327]
    │       capabilityBroker.resolve()    [runtime.ts:290]
    │           ├── PermissionBackedCapabilityBroker.resolve()
    │           │     ├── validateMissionGrant()  (grant registry)
    │           │     └── permissions.decide()    (PermissionPolicy)
    │           └── emit capability/permission events
    │
    ├── if any decision.granted === false → fail with CapabilityDeniedError
    │
    └── tool.execute()  [runtime.ts:368]
```

### 11.2 PermissionPolicy Interface

```typescript
interface PermissionPolicy {
  decide(request: PermissionRequest): Promise<PermissionDecision>;
}
```

### 11.3 CapabilityBroker.resolve()

```typescript
async resolve(request: CapabilityRequest): Promise<CapabilityDecision>
  1. Validate request maps to permission correctly
  2. Check mission grant (if missionId + grantRegistry)
  3. Call PermissionPolicy.decide()
  4. Return CapabilityDecision
```

**Critical Issues:**
- **Permission check is per-tool-invocation**, not per-action-proposal. The loop proposes an action; the harness checks each tool individually. A multi-tool action can partially execute before a later tool is denied.
- `PermissionPolicy` is a **callback interface** — the kernel does not enforce any specific policy. Default implementation unknown.
- `CapabilityGrantRegistry` is optional (`grants?` in `PermissionBackedCapabilityBroker`). If missing, mission grants are not enforced.
- No **action-level authorization** — only tool-level. The `ActionProposal` contract (Phase 2) adds this but is not yet wired.
- `isProhibitedPermission()` (skill-fitness.ts:479, sandbox-runtime.ts:361) hardcodes 4 prohibited permissions but this is **not enforced at the capability broker level** — only in skill fitness/sandbox validation.

---

## 12. Unsafe Direct Execution Paths

| Path | Bypasses | Risk |
|------|----------|------|
| `AgentLoop.executeAction()` → `deps.executeTool()` | Mission budget, stall detection (until after), action contract, verification strategy | High |
| `WorkflowEngine.executeNodeWork()` → `config.executeTool()` | Mission budget, capability grants (depends on callback), action contract | High |
| `QuackRuntime.executeTool()` → `ToolRegistry` | Mission state machine, loop budget, stall detection | Medium |
| `DurableSkillSandboxRuntime.execute()` → `WorkflowEngine` | Skill fitness, progressive disclosure, agent skills compatibility | Medium |
| `ExecutiveBrain.execute()` → `SessionRuntime` → `WorkflowEngine` | Mission state machine (uses Task status), loop budget | Medium |
| Model calls via `ProviderAdapter.generate()` | Budget, timeout, cancellation, permissions | Medium |

**Critical Issue:** The **decision/execution boundary** (audit §6) does not exist in practice. `AgentLoop.selectAction()` picks a graph node and immediately executes its tool invocations. There is no `ActionProposal` → authorization → harness flow. The Phase 2 `ActionProposal` contract exists but is only used in `fromLegacyIteration()` for recording, not for actual execution gating.

---

## 13. Duplicated Abstractions

| Abstraction | Instances | Notes |
|-------------|-----------|-------|
| **Mission/Task** | `MissionDefinition` (cos), `Task` (runtime), `MissionCompanyRecordV1` (company) | Three overlapping units; different state models |
| **Executive Loop** | `QuackRuntime.submitGoal`, `AgentLoop.start`, `WorkflowEngine.executeLoop` | Three competing implementations |
| **State Machine** | `MissionState` (mission-lifecycle), `TaskStatus` (task.ts), `AgentLoopState` (agent-loop), `MissionCompanyState` (company), `WorkflowStatus` (engine) | 5 different state models |
| **Plan/Graph** | `Plan` (brain), `TaskGraph` (engine), `PlanStep` (brain), `TaskNode` (engine) | Two parallel hierarchies |
| **Execution Result** | `ExecutionResult` (brain), `AgentLoopExecutionResult` (agent-loop), `TaskNodeResult` (engine), `ActionResultV1` (contracts), `SkillResult` (skills) | 5 result types |
| **Skill Execution** | `SkillExecutor.execute`, `DurableSkillSandboxRuntime.execute`, `AgentLoop` (via tools), `QuackRuntime` (portable skills) | 4 paths |
| **Tool Execution** | `QuackRuntime.executeTool`, `AgentLoop.executeAction`, `WorkflowEngine.executeNodeWork`, `DurableSkillSandboxRuntime` (via workflow) | 4 paths |
| **Capability/Action** | `CapabilityRequest` (security), `ActionRequestV1` (contracts), `ActionProposal` (mission-lifecycle), `ToolInvocation` (tools) | 4 types |
| **Event Bus** | `EventBus` (events), `JournalWriter` (engine), `CheckpointManager` (engine) | Multiple emission paths |
| **Memory** | `MemoryStore` (memory), `MemoryManager` (memory/os), `EvidenceExperienceStore` (cos), `SkillFitnessIndex` (adaptive) | Multiple stores |

---

## 14. Dead Abstractions

| Abstraction | Location | Status |
|-------------|----------|--------|
| `SimpleBrain` | `src/brain/simple-brain.ts` | Unused; no imports |
| `SkillOrchestrator` | `src/brain/skill-orchestrator.ts` | Unused; no imports |
| `EchoProvider` | `src/providers/provider.ts:85` | Test-only; registered by default |
| `EchoTool` | `src/tools/tool.ts:112` | Test-only; registered by default |
| `InMemoryJournalStore` | `src/engine/execution-journal.ts` | Only used in skill sandbox |
| `InMemoryCheckpointStore` | `src/engine/checkpoint-system.ts` | Only used in skill sandbox |
| `ReflectionEngine` | `src/engine/reflection-engine.ts` | Only used in `WorkflowEngine` + `ExecutiveBrain` |
| `RecoveryEngine` | `src/engine/recovery-engine.ts` | Only used in `WorkflowEngine` + `ExecutiveBrain` |
| `CostOptimizer` | `src/engine/cost-optimizer.ts` | Only used in `ExecutiveBrain` |
| `Planner` | `src/engine/planner.ts` | Used by `ExecutiveBrain` + `AgentLoop` (different instances) |
| `SessionRuntime` | `src/engine/session-runtime.ts` | Only used by `ExecutiveBrain` |
| `MissionManager` | `src/cos/mission-manager.ts` | Used by `AgentLoop` for goal resolution only |
| `ImprovementCoordinator` | `src/adaptive/improvement-coordinator.ts` | Only called from `QuackRuntime.submitGoal` |
| `ContextualSkillSelector` | `src/adaptive/skill-fitness.ts:218` | Only used by `QuackRuntime` |
| `SkillFitnessIndex` | `src/adaptive/skill-fitness.ts:87` | Only updated from `QuackRuntime` + `SkillFitnessReviewLoop` |

---

## 15. Hidden Coupling

| Coupling | Location | Impact |
|----------|----------|--------|
| `ExecutiveBrain` ↔ `SessionRuntime` ↔ `WorkflowEngine` | Constructor injection + method calls | Tight; cannot test brain without full engine stack |
| `AgentLoop` ↔ `MissionManager` | `resolveGoal()` calls `missionManager.get()` | AgentLoop cannot run without MissionManager |
| `AgentLoop` ↔ `Planner` | Direct `planner.createPlan()` call | Planner interface not abstracted |
| `QuackRuntime` ↔ `ExecutiveBrain` | Constructor injection; `submitGoal` calls `brain.plan/execute` | Runtime cannot use alternative brain |
| `SkillExecutor` ↔ `DurableSkillSandboxRuntime` | Constructor injection | Sandbox required for portable skills |
| `DurableSkillSandboxRuntime` ↔ `WorkflowEngine` | Direct instantiation in `execute()` | Cannot swap execution engine |
| `WorkflowEngine` ↔ `TaskGraphExecutor` | Direct instantiation in `start()` | Cannot swap executor |
| `SessionRuntime` ↔ `WorkflowEngine` | Creates engine in `startWorkflow()` | Cannot swap engine per session |
| `CapabilityBroker` ↔ `PermissionPolicy` | Constructor injection | Policy cannot be swapped per-request |
| `EventBus` handlers | Scattered across 15+ files | No central registry; hard to trace |

---

## 16. Model-Specific Leakage

| Leakage | Location | Detail |
|---------|----------|--------|
| Provider profiles hardcoded | `executive-brain.ts:315-338` | `openai`, `anthropic`, `ollama` with costs, context windows, capabilities |
| `CostOptimizer` | `executive-brain.ts:56` | Uses provider profiles for routing |
| `ProviderRegistry` | `providers/provider.ts` | Lists provider IDs as strings; no abstraction |
| Model selection | `providers/kernel.ts` | `selectModel()` uses provider-specific logic |
| Token usage | `contracts/v1/contracts.ts:95-100` | `NormalizedTokenUsageV1` assumes OpenAI-style tokens |
| Streaming | `contracts/v1/contracts.ts:114-121` | `ProviderModelEventV1` assumes SSE-style deltas |
| Tool calling | `contracts/v1/contracts.ts:83-93` | `ProviderToolDefinitionV1` assumes OpenAI function calling format |

---

## 17. Skill-Specific Leakage

| Leakage | Location | Detail |
|---------|----------|--------|
| `SkillManifest.category` enum | `skills/types.ts:3-7` | 17 hardcoded categories |
| `SkillTrustLevel` enum | `skills/types.ts:34` | 5 levels; used in safety check |
| `isProhibitedPermission()` | `skill-fitness.ts:479`, `sandbox-runtime.ts:361` | Hardcoded 4 permissions; duplicated |
| `SkillCompilationRisk` enum | `skills/types.ts:154-160` | 6 risk levels; used in sandbox validation |
| Portable skill schema | `skills/types.ts:88-99` | v1 only; no migration path |
| Skill compiler | `skills/compiler.ts` | Compiles to portable IR; tightly coupled to tool registry |
| `ContextualSkillSelector` | `skill-fitness.ts:218` | Uses `SkillRegistry.getAll()` directly; no abstraction |

---

## 18. Contract Compliance Matrix

| Contract | Defined In | Implemented By | Wired In | Status |
|----------|------------|----------------|----------|--------|
| `MissionState` machine | `mission-lifecycle/mission-state-machine.ts` | `MissionManager` (partial) | Nowhere | **Phase 1** — types only |
| `ActionProposal` / `ActionOutcome` | `mission-lifecycle/action-contract.ts` | `fromLegacyIteration()` only | `AgentLoop` (recording only) | **Phase 2** — types only |
| `LoopRun` / `IterationRecord` | `mission-lifecycle/executive-loop.ts` | `AgentLoop` (per-call) | `AgentLoop.start()` | **Phase 3** — partial migration |
| `CapabilityBroker` | `security/capability-broker.ts` | `PermissionBackedCapabilityBroker` | `QuackRuntime` | **Implemented** |
| `ActionProviderV1` | `contracts/v1/contracts.ts:258` | None | Nowhere | **Not implemented** |
| `QuackProviderV1` | `contracts/v1/contracts.ts:135` | `providers/kernel.ts` (partial) | `ExecutiveBrain` | **Partial** |
| `QuackRuntimeV1` | `contracts/v1/contracts.ts:193` | None | Nowhere | **Not implemented** |
| `SkillDefinition` | `skills/types.ts:49` | `SkillExecutor`, `SkillRegistry` | `QuackRuntime`, `AgentLoop` | **Implemented** |
| `PortableSkillExecutionDefinition` | `skills/types.ts:88` | `DurableSkillSandboxRuntime` | `SkillExecutor` | **Implemented** |

---

## 19. Summary of Problems by Category

### Category A: Mission Lifecycle (5 problems)
1. Three overlapping mission units (Mission, Task, MissionCompany) with different state models
2. No canonical mission state machine enforced (Phase 1 types exist but not wired)
3. Terminal states not enforced — `MissionManager.complete()` only checks `!== "completed"`
4. No crash recovery path — `INTERRUPTED` → `RECOVERING` not implemented
5. Mission persistence uses legacy 4-state column; canonical states not stored

### Category B: Executive Loop (6 problems)
6. Three competing loops (`QuackRuntime`, `AgentLoop`, `WorkflowEngine`)
7. `AgentLoop` singleton state field shared across concurrent missions (RACE)
8. No per-mission `run_id` / `iteration_id` correlation in `QuackRuntime`/`WorkflowEngine`
9. No structured stop reasons in `QuackRuntime`/`WorkflowEngine` (generic error strings)
10. No stall detection in `QuackRuntime`/`WorkflowEngine`
11. No budget enforcement in `QuarkRuntime`/`WorkflowEngine`

### Category C: Action Contract (4 problems)
12. No decision/execution boundary — loop picks and executes directly
13. `ActionProposal` contract exists but not used for gating execution
14. No `expectedEffect` / `verificationStrategy` on actions (audit §28.14)
15. Execution success conflated with goal progress (audit §25.1, §29)

### Category D: Capability & Harness (5 problems)
16. Tool-level permission only; no action-level authorization
17. `CapabilityGrantRegistry` optional; mission grants not enforced if missing
17. No idempotency keys on tool execution (audit §19)
19. `ActionProviderV1` contract defined but no implementations
20. No provider reconciliation for crash recovery

### Category E: Skills (5 problems)
21. `AgentLoop` does not use `ContextualSkillSelector` (only `QuackRuntime` does)
22. No progressive skill disclosure (Level 1/2/3) — all skills loaded into context
23. Skill scripts (`scripts/`) can execute via sandbox; no separate approval
24. Skill fitness not connected to `AgentLoop` selection
25. No skill trust pipeline enforcement at runtime (only at registry load)

### Category F: Persistence & Recovery (5 problems)
26. Default in-memory stores; no durability by default
27. No transaction boundary across mission + task + skill + grant + checkpoint
28. `LoopRun` + `IterationRecord` never persisted
29. Crash recovery: `INTERRUPTED` state not set on startup; no reconciliation
30. Checkpoints periodic (30s) not per-action; data loss window

### Category G: Concurrency (4 problems)
31. `AgentLoop` singleton state race (confirmed)
32. `SkillRegistry` `Map` mutations not atomic
33. `CapabilityGrantRegistry` InMemory not thread-safe
34. No per-mission mutex; no worker pool; no backpressure

### Category H: Timeouts & Cancellation (5 problems)
35. Tool execution has no timeout
36. Model inference has no runtime timeout
37. Human approval has no timeout
38. Cancellation does not propagate to in-flight tools/providers
39. `AbortSignal` in `ExecutionContextV1` never used

### Category I: Retry Ownership (3 problems)
40. Multi-layer retry without coordination (node → recovery → loop → brain)
41. `QuackRuntime.executeTool` has no retry
42. `CapabilityBroker.resolve` no retry on transient denial

### Category J: Observability (2 problems)
43. Events emitted but no structured tracing (OpenTelemetry not integrated)
44. `IterationRecord` missing from `QuarkRuntime`/`WorkflowEngine` paths

### Category K: Security (2 problems)
45. `isProhibitedPermission()` only enforced in skill fitness/sandbox, not capability broker
46. Skill script execution via sandbox has no separate approval policy

### Category L: Model/Skill Leakage (2 problems)
47. Provider profiles hardcoded in `ExecutiveBrain` (OpenAI/Anthropic/Ollama)
48. Skill categories, trust levels, risk enums hardcoded in types

---

## 20. Recommended Phase 0 Actions

Before any hardening work, the following must be resolved:

1. **Pick ONE executive loop** as canonical. Recommendation: Migrate `AgentLoop` onto the Phase 1-3 contracts (already started) and deprecate `QuackRuntime.submitGoal` and `WorkflowEngine.executeLoop` as primary mission entry points.

2. **Enforce Mission State Machine** at the persistence layer. Replace `MissionDefinition.status` 4-state column with canonical `MissionState`.

3. **Wire ActionProposal** into `AgentLoop` as the mandatory decision artifact before `executeAction()`.

4. **Implement per-mission mutex** in `AgentLoop` or a wrapper to fix the concurrency race.

5. **Add timeouts** to `QuackRuntime.executeTool` and thread `AbortSignal` through to tools.

6. **Enable SQLite persistence** by default for `TaskStore`, `SkillRegistry`, `CapabilityGrantRegistry`.

7. **Persist `LoopRun` + `IterationRecord`** to SQLite on each iteration append.

---

## 21. Files Audited

```
/src/runtime/runtime.ts                    (QuackRuntime)
/src/runtime/task.ts                       (Task, TaskStatus, MissionOrigin)
/src/runtime/mission-lifecycle/*.ts        (Phase 1-3 contracts)
/src/brain/executive-brain.ts              (ExecutiveBrain)
/src/brain/brain.ts                        (Brain interface)
/src/agent-loop/index.ts                   (AgentLoop - PRIMARY)
/src/engine/workflow-engine.ts             (WorkflowEngine)
/src/engine/session-runtime.ts             (SessionRuntime)
/src/engine/task-graph.ts                  (TaskGraph, TaskGraphExecutor)
/src/engine/planner.ts                     (Planner)
/src/engine/types.ts                       (Engine types)
/src/skills/types.ts                       (Skill types)
/src/skills/registry.ts                    (SkillRegistry)
/src/skills/executor.ts                    (SkillExecutor)
/src/skills/sandbox-runtime.ts             (DurableSkillSandboxRuntime)
/src/skills/compiler.ts                    (SkillCompiler)
/src/security/capability-broker.ts         (CapabilityBroker)
/src/security/permissions.ts               (PermissionPolicy)
/src/contracts/v1/contracts.ts             (v1 contracts)
/src/providers/provider.ts                 (ProviderRegistry, ProviderAdapter)
/src/providers/kernel.ts                   (ModelKernel)
/src/events/event-bus.ts                   (EventBus)
/src/storage/task-store.ts                 (TaskStore implementations)
/src/storage/sqlite.ts                     (SQLite schema)
/src/harness/types.ts                      (Harness types)
/src/tools/tool.ts                         (ToolRegistry, QuackTool)
/src/memory/memory.ts                      (MemoryStore)
/src/cos/mission-manager.ts                (MissionManager)
/src/adaptive/skill-fitness.ts             (SkillFitness, ContextualSkillSelector)
```