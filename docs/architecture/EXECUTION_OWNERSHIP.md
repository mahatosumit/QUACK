# QUACK Execution Ownership Analysis

**Date**: 2026-08-18  
**Purpose**: Trace the real call graph from user objective to model/tool execution. Identify every production path capable of invoking models, providers, tools, actions, agents, workflows without passing through the new Harness/Loop architecture.

## Current status update — 2026-09-06

Configured extension memory now joins the same canonical path (ADR 0029).
`createQuackSystem` selects one admitted `MemoryProvider` by exact id and wraps
it in the runtime-owned `MemoryProviderBinding`. Provider reads enter bounded
planner context only after capability and host memory-policy checks; completion
writes run before mission success and use the checkpoint owned by
`SessionRuntime`. Durable executions bind provider id, version, and namespace.
Acknowledged writes are reused on resume, while ambiguous writes fail closed
without provider replay. Unselected providers remain inert and the existing
local memory store remains unchanged.

## Current status update — 2026-09-09 (multi-process ownership)

The earlier statement in this document that "multi-process recovery is
unsupported" is superseded. Multi-process ownership and recovery are now part
of the canonical path:

- Mission ownership is a fenced lease state machine (`UNOWNED → ACQUIRING →
  OWNED → HEARTBEATING → COMPLETING → RELEASED`, plus `LEASE_LOST`,
  `STALE_OWNER`, `OWNERSHIP_CONFLICT`) backed by the coordination database
  with monotonic fencing epochs and release tombstones.
- Atomic acquisition, heartbeat lease renewal (fail-closed at lease/3), stale
  takeover, crash recovery, and write fencing (`assertOwnedForWrite`) are all
  implemented; durable transitions route through `fencedTransition`.
- Verified by real forked-process tests in
  `src/runtime/multi-process-recovery.test.ts` (crash at six boundaries,
  simultaneous recovery converging to one owner, stale re-execution blocked,
  repeated crash/restart cycles, SIGKILL mid-mission resume) and adversarial
  tests (forged owner rejected, DB-tampered version cannot re-open a fenced
  epoch).
- No process may continue durable writes after losing ownership; the fencing
  epoch embedded in every write enforces this.

Limitations that remain accurate: recovery requires a runtime created with a
`dataDir`; in-memory runtimes fail closed.

## Current status update — 2026-09-06 (interrupted recovery)

Interrupted-mission recovery joins the canonical path (ADR 0028):
`QuackRuntime.resumeMission(taskId)` is the only recovery entry point. It
validates the durable execution checkpoint owned by `SessionRuntime`,
reconciles the invocation journal (acknowledged tool outcomes are replayed
from the journal, never re-executed), refuses ambiguous non-idempotent side
effects (`BLOCKED` / `recovery.reconciliation_required`), and re-enters the
same `SessionRuntime → DefaultLoopDriver → WorkflowEngine → CapabilityBroker →
verification` pipeline. Recovery requires a runtime created with a `dataDir`;
in-memory runtimes fail closed. The task and execution identity persist before
planning, while tool dispatch cannot start before the first canonical
checkpoint exists. Within a single process, resume uses this canonical path;
cross-process takeover additionally requires the fenced ownership lease
described in the 2026-09-09 update above.

## Current status update — 2026-09-04

The public mission lifecycle now has one canonical path:

```text
CLI / API / HTTP server / SDK / direct QuackRuntime
  → QuackRuntime
  → SessionRuntime
  → DefaultLoopDriver
  → WorkflowEngine / ExecutionScheduler
  → CapabilityBroker
  → governed tool execution
  → explicit verification before completion
```

`AgentLoop.start()` is a compatibility facade over `QuackRuntime.submitGoal()`.
It rejects when constructed without a runtime, and therefore cannot operate its
former planner/harness loop in production. `QuackNativeHarness.send()` and
direct `QuackRuntime.executeTool()` remain governed action helpers, not mission
completion paths. `SkillExecutor` accepts only portable skills; direct callable
legacy definitions fail closed so they cannot bypass the runtime, broker, or
evaluation. `CompanyTaskScheduler` is an explicitly unsupported compatibility
surface: it validates its input and rejects before invoking its former arbitrary
callback, and no longer owns a workflow engine or scheduler. Workforce portable
skill dispatch is compatibility wiring over the canonical graph runtime. These
are not public mission lifecycle entry points. The remainder of this document
is the historical baseline that led to this consolidation; it is not a
description of current public routing.

---

> Historical analysis. Current native harness support is limited to explicit runtime tool invocations and emulated streaming, with `H0_DETECTED` status. Subagent/background execution and native lifecycle recovery methods shown in interface diagrams are unsupported; method presence is not evidence of implementation. The loop has no trusted default mission validator.

## EXECUTION PATHS RECORDED BY THE HISTORICAL ANALYSIS

### Path 1: CLI `submitGoal` → `QuackRuntime` → `ExecutiveBrain` → `SessionRuntime` → `WorkflowEngine`
**Entry Point**: `cli.ts:448` - `system.runtime.submitGoal(options.goal, "cli")`

```
CLI (start command)
    ↓
QuackRuntime.submitGoal(goal, actor, options)
    ├── Task creation & storage (task-store.ts)
    ├── Skill selection (ContextualSkillSelector)
    ├── Event emission (task.created, skill.selected)
    ├── Brain planning (ExecutiveBrain.plan)
    │   └── Planner.createPlan → TaskGraphBuilder → TaskGraph
    ├── Task storage with plan (status: planned)
    ├── Brain execution (ExecutiveBrain.execute)
    │   ├── Re-plan (creates fresh TaskGraph)
    │   ├── SessionRuntime.createSession
    │   ├── SessionRuntime.startWorkflow
    │   │   └── WorkflowEngine initialization
    │   ├── pollWorkflowCompletion (200ms polling)
    │   │   └── WorkflowEngine.getWorkflowState()
    │   ├── Node execution via TaskGraphExecutor
    │   │   └── executeToolInvocation → QuackRuntime.executeTool
    │   ├── ReflectionEngine.reflect
    │   └── RecoveryEngine.buildRecoveryPlan (if failures)
    └── Task completion/failure storage
```

**Model Invocation**: Via `ExecutiveBrain` → `SessionRuntime` → `WorkflowEngine` → `TaskGraphExecutor` → tool calls (no direct model calls in this path - tools do the work)

**Provider/Tool Invocation**: `QuackRuntime.executeTool` → capability broker → tool.execute

**Agents/Workflows**: `SessionRuntime` + `WorkflowEngine` + `TaskGraphExecutor`

---

### Path 2: CLI `mission` command → `AgentLoop` → Old `ExecutionHarness`
**Entry Point**: `cli.ts:423` - `system.agentLoop.start({ goal: options.goal, actor: "cli", origin: "cli" })`

```
CLI (mission command)
    ↓
AgentLoop.start(AgentLoopStartOptions)
    ├── createLoopRun (executive-loop.ts)
    ├── Event emission (loop.started)
    ├── While loop (maxIterations budget)
    │   ├── observe() → memory search + skill count
    │   ├── Planner.createPlan(goal, observation)
    │   ├── selectAction(plan) → first node with toolInvocations
    │   ├── executeAction()
    │   │   ├── Build ActionProposal
    │   │   ├── HarnessExecutionContext
    │   │   ├── ExecutionHarness.execute(proposal, context)
    │   │   │   ├── validateProposal
    │   │   │   ├── resolveCapability (action providers + tools)
    │   │   │   ├── authorize (capability broker)
    │   │   │   ├── lowerProposal → ActionRequestV1
    │   │   │   ├── getEffectiveTimeout
    │   │   │   ├── executeWithTimeout
    │   │   │   │   └── ActionProvider.execute / ToolRegistry.execute
    │   │   │   ├── verifyResult
    │   │   │   └── build Outcome
    │   │   └── Convert to AgentLoopExecutionResult
    │   ├── verify() → AgentLoopVerificationResult
    │   ├── reflect() → AgentLoopReflection
    │   ├── Memory write + MemoryManager.store
    │   ├── Event emission (loop.iteration)
    │   ├── Check verification success → COMPLETED
    │   ├── Check capability denied → FAILED
    │   ├── detectStall → replan or terminate
    │   ├── Recovery attempts check
    │   └── Loop continues
    └── terminateRun → Event emission (loop.completed/failed)
```

**Model Invocation**: None directly - the old `ExecutionHarness` doesn't call models, it executes tools/actions

**Provider/Tool Invocation**: `ExecutionHarness.execute` → `ActionProvider.execute` or `ToolRegistry.get().execute`

**Agents**: None - single-threaded loop, no subagents

**Workflows**: None - simple plan → execute → verify loop

---

### Path 3: NEW - Harness v2 + LoopDriver (NOT YET CONNECTED TO CLI)
**Entry Point**: Not connected to any user-facing command

```
Harness Interface (harness/contract.ts)
    ├── metadata()
    ├── health()
    ├── capabilities()
    ├── certification()
    ├── start(config)
    ├── send(input, context) → HarnessTaskOutput
    ├── stream(input, context) → AsyncIterable
    ├── checkpoint(missionId, runId)
    ├── resume(checkpoint)
    ├── pause(missionId)
    ├── cancel(missionId, runId)
    ├── interrupt(missionId, runId)
    ├── getStatus(missionId, runId)
    ├── spawnSubagent(options) → SubagentReport
    ├── startBackgroundJob(job) → jobId
    ├── getBackgroundJobStatus(jobId)
    ├── cancelBackgroundJob(jobId)
    ├── waitBackgroundJob(jobId)
    ├── streamBackgroundJobOutput(jobId)
    ├── shutdown()
    └── dispose()

LoopDriver (agent-loop/driver.ts)
    ├── start(LoopStartOptions) → LoopResult
    │   ├── Budget enforcement (checkBudget)
    │   ├── Phase progression: PREPARE→REQUEST→OBSERVE→ACT→VERIFY→ASSESS_PROGRESS
    │   ├── runIteration
    │   │   ├── observe() → memory search
    │   │   ├── createSimplePlan()
    │   │   ├── selectAction()
    │   │   ├── executeAction() → Harness.send()
    │   │   ├── verifyResult()
    │   │   ├── reflect()
    │   │   ├── createProgressSnapshot()
    │   │   ├── doomLoopDetector.check()
    │   │   └── ProgressDetector.checkNoProgress()
    │   ├── Check verification → COMPLETED
    │   ├── Check capability denied → FAILED
    │   ├── Check doom loop → replan or FAILED
    │   ├── Check no-progress → FAILED
    │   ├── Reflection nextStep handling
    │   └── waitForWakeEvent (if WAIT)
    ├── pause()/resume()/cancel()
    ├── injectEvent(LoopWakeEvent)
    └── onWakeEvent handlers
```

**Model Invocation**: None directly - `Harness.send()` is expected to call models

**Provider/Tool Invocation**: Via `Harness.send()` implementation

**Agents**: Via `spawnSubagent()` - one-shot or continuable

**Workflows**: Not directly - would need to be built on top

---

## COMPETING PRODUCTION LOOPS IDENTIFIED

| Path | Status | Connected to CLI | Uses New Harness/Loop |
|------|--------|------------------|----------------------|
| `QuackRuntime.submitGoal` → `ExecutiveBrain` → `SessionRuntime` | **ACTIVE** | Yes (`start` command) | NO |
| `AgentLoop.start` → Old `ExecutionHarness` | **ACTIVE** | Yes (`mission` command) | NO |
| New `Harness` + `LoopDriver` | **INACTIVE** | NO | YES (but unused) |

---

## AUTHORITATIVE EXECUTION PATH DECISION

**The new Harness v2 + LoopDriver MUST become the single authoritative execution path.**

### Migration Plan:

1. **Deprecate Path 1** (`QuackRuntime.submitGoal` → `ExecutiveBrain` → `SessionRuntime`)
   - This is the "start" command path
   - Replace with CLI command that uses `LoopDriver` + `QuackNativeHarness`

2. **Deprecate Path 2** (`AgentLoop` → Old `ExecutionHarness`)
   - This is the "mission" command path
   - Replace with CLI command that uses `LoopDriver` + `QuackNativeHarness`

3. **Activate Path 3** (New `Harness` + `LoopDriver`)
   - Connect to CLI via new `mission` command implementation
   - `QuackNativeHarness` wraps existing QUACK infrastructure

### Files Requiring Changes:

| File | Current Role | Required Change |
|------|--------------|-----------------|
| `cli.ts` | Routes to Path 1 (`submitGoal`) and Path 2 (`agentLoop.start`) | Route all mission execution to new `LoopDriver` + `QuackNativeHarness` |
| `system/create-system.ts` | Creates both old `agentLoop` and new `harness` | Create `LoopDriver` + `QuackNativeHarness`; deprecate old `AgentLoop` |
| `harness/registry.ts` | Defines `QuackNativeHarness` | Ensure it properly wraps QUACK runtime for tool execution |
| `agent-loop/driver.ts` | Implements `LoopDriver` | Verify it works with `QuackNativeHarness` |

---

## PRODUCTION PATHS WITHOUT NEW ARCHITECTURE

The following can invoke models/providers/tools/actions/agents/workflows WITHOUT passing through new Harness/Loop:

| Capability | Path 1 (submitGoal) | Path 2 (AgentLoop) | Path 3 (New) |
|------------|---------------------|-------------------|--------------|
| **Models** | Via tools only | No | Via Harness.send() |
| **Providers** | Via tools only | No | Via Harness.send() |
| **Tools** | ✅ `QuackRuntime.executeTool` | ✅ `ExecutionHarness` → ToolRegistry | ✅ `QuackNativeHarness` → `system.runtime.executeTool` |
| **Actions** | Via `ActionProvider` in tools | Via `ExecutionHarness` → ActionProvider | Via `QuackNativeHarness` → ActionRuntime |
| **Agents** | No | No | Via `spawnSubagent` |
| **Workflows** | ✅ `SessionRuntime` + `WorkflowEngine` | No | Not directly |
| **Subagents** | No | No | Via `spawnSubagent` |
| **Background Jobs** | No | No | Via `startBackgroundJob` |
| **Checkpoint/Resume** | Via `SessionRuntime` snapshots | No | Via `checkpoint`/`resume` |

---

## ACTION ITEMS

### Immediate (Phase 1 Completion):
1. ✅ Document execution ownership (this file)
2. Update `cli.ts` to route `mission` command to new `LoopDriver`
3. Update `create-system.ts` to instantiate `LoopDriver` + `QuackNativeHarness`
4. Wire `QuackNativeHarness` to use `system.runtime.executeTool` and `system.actionRuntime`
5. Run conformance tests against real `QuackNativeHarness`

### Deprecation Markers:
- Mark `AgentLoop` class as `@deprecated` with migration guide
- Mark `ExecutiveBrain.execute` path as `@deprecated` 
- Mark old `ExecutionHarness` as `@deprecated`
- Keep `SessionRuntime`/`WorkflowEngine` for internal workflow execution (not top-level mission loop)

---

## VERIFICATION CRITERIA

After migration, verify:
- [ ] `quack mission "goal"` uses new `LoopDriver` + `QuackNativeHarness`
- [ ] `quack start "goal"` uses new `LoopDriver` + `QuackNativeHarness`  
- [ ] All tool execution goes through `QuackNativeHarness` → `system.runtime.executeTool`
- [ ] All action execution goes through `QuackNativeHarness` → `system.actionRuntime`
- [ ] Subagents work via `QuackNativeHarness.spawnSubagent`
- [ ] Background jobs work via `QuackNativeHarness.startBackgroundJob`
- [ ] Checkpoint/resume works via `QuackNativeHarness.checkpoint`/`resume`
- [ ] Flight Recorder captures all Harness/Loop events
- [ ] No path invokes models/providers/tools/actions without Harness
- [ ] Old `AgentLoop` and `ExecutiveBrain.execute` paths are unreachable from CLI
