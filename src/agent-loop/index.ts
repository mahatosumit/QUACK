import { createId, now, type IsoTimestamp, type JsonObject, type JsonValue, ok, fail, type QuackResult } from "../core/types.js";
import { type EventBus } from "../events/event-bus.js";
import { type MemoryStore } from "../memory/memory.js";
import { type MemoryManager } from "../memory/os.js";
import { type MissionManager } from "../cos/mission-manager.js";
import { type Planner } from "../engine/planner.js";
import { type Plan as EnginePlan, type TaskGraph } from "../engine/types.js";
import { type SkillRegistry } from "../skills/registry.js";
import { type ToolInvocation } from "../tools/tool.js";
import type { MissionOrigin } from "../runtime/task.js";
import { type LoopPhase as ExecutiveLoopPhase, type StopReason as ExecutiveStopReason, type Budget, type BudgetUsage, type IterationRecord, type LoopRun, type PermissionDecision, createLoopRun, appendIteration, terminateRun, evaluateBudget, detectStall, stopReasonForStall, emptyBudgetUsage, recordModelCall, recordToolCall, recordFailure, recordReplan, nextLoopPhase, phaseFromLegacyAgentLoopState } from "../runtime/mission-lifecycle/executive-loop.js";
import type { ExecutionHarness } from "../runtime/mission-lifecycle/harness.js";
import { type CapabilityBroker } from "../security/capability-broker.js";
import { QuackRuntime } from "../runtime/runtime.js";
import {
  type LoopDriver,
  type LoopStartOptions,
  type LoopResult,
  type LoopState,
  type LoopPhase,
  type LoopIteration,
  type LoopBudget,
  type LoopConfig,
  type LoopExecutionContext,
  type LoopObservation,
  type LoopPlan,
  type LoopAction,
  type LoopToolCall,
  type LoopExecutionResult,
  type LoopVerificationResult,
  type LoopReflection,
  type ProgressSnapshot,
  type DoomLoopDetection,
  type LoopWakeEvent,
  type StopReason,
  DEFAULT_LOOP_BUDGET,
  DEFAULT_LOOP_CONFIG,
  type LoopDependencies,
  DefaultProgressDetector,
  DefaultDoomLoopDetector,
  DefaultWakeupManager,
} from "./contract.js";
import { type Harness, type HarnessExecutionContext, type HarnessTaskInput, type HarnessTaskOutput } from "../harness/contract.js";

/** Map executive-loop phases to contract LoopPhase */
function mapExecutivePhase(execPhase: ExecutiveLoopPhase): LoopPhase {
  switch (execPhase) {
    case "OBSERVE": return "OBSERVE";
    case "ORIENT": return "ORIENT";
    case "DECIDE": return "DECIDE";
    case "AUTHORIZE": return "AUTHORIZE";
    case "ACT": return "ACT";
    case "VERIFY": return "VERIFY";
    case "LEARN": return "LEARN";
  }
}

/** Map executive-loop stop reasons to contract StopReason */
function mapExecutiveStopReason(execReason: ExecutiveStopReason): StopReason {
  switch (execReason) {
    case "STOP_GOAL_ACHIEVED": return "GOAL_REACHED";
    case "STOP_MAX_ITERATIONS": return "ITERATION_LIMIT";
    case "STOP_MAX_MODEL_CALLS": return "BUDGET_EXCEEDED";
    case "STOP_MAX_TOOL_CALLS": return "BUDGET_EXCEEDED";
    case "STOP_BUDGET_EXCEEDED": return "BUDGET_EXCEEDED";
    case "STOP_TIMEOUT": return "TIMEOUT";
    case "STOP_POLICY_DENIED": return "POLICY_DENIED";
    case "STOP_STALL_NO_PROGRESS": return "NO_PROGRESS";
    case "STOP_STALL_OSCILLATION": return "DOOM_LOOP";
    case "STOP_STALL_REPEATED_FAILURE": return "DOOM_LOOP";
    case "STOP_UNRECOVERABLE_ERROR": return "ERROR";
    case "STOP_CANCELLED": return "CANCELLED";
    case "STOP_HUMAN_ABORT": return "CANCELLED";
  }
}

/** Map executive-loop Budget to contract LoopBudget */
function mapBudget(execBudget: Budget): LoopBudget {
  return {
    maxToolCalls: execBudget.maxToolCalls,
    maxConcurrentNodes: 3,
    maxIterations: execBudget.maxIterations,
    maxDurationMs: execBudget.maxExecutionTimeMs ?? 30 * 60 * 1000,
    maxTokens: 1_000_000,
    maxCostUsd: execBudget.maxCost ?? 10.00,
    maxRetries: 3,
    maxConsecutiveFailures: execBudget.maxConsecutiveFailures ?? 5,
    maxNoProgressIterations: 5,
    maxDelegationDepth: 3,
    maxAgents: 8,
    maxConcurrentAgents: 6,
  };
}

function toMissionOrigin(origin?: string): MissionOrigin {
  return origin === "user" || origin === "cli" || origin === "api" || origin === "sdk"
    || origin === "desktop" || origin === "improvement" || origin === "system"
    ? origin
    : "system";
}

/** Internal run state for AgentLoop as LoopDriver */
interface AgentLoopRun {
  readonly runId: string;
  readonly missionId: string;
  readonly goal: string;
  readonly actor: string;
  readonly origin: string;
  readonly budget: LoopBudget;
  readonly config: LoopConfig;
  readonly harness: Harness;
  readonly capabilityBroker: CapabilityBroker;
  readonly eventBus: EventBus;
  readonly memory: MemoryStore;
  readonly memoryManager?: MemoryManager;
  readonly progressDetector: DefaultProgressDetector;
  readonly doomLoopDetector: DefaultDoomLoopDetector;
  readonly wakeupManager: DefaultWakeupManager;
  readonly onMissionCompleted?: (context: { missionId: string; runId: string; goal: string; actor: string }) => Promise<void>;
  readonly planFn: LoopDependencies["plan"];
  readonly executeGraphFn: LoopDependencies["executeGraph"];
  readonly verifyExecutionFn: LoopDependencies["verifyExecution"];
  readonly workspaceRoot: string;
  readonly dataDir: string;
  
  // Mutable state
  state: LoopState;
  phase: LoopPhase;
  iterations: LoopIteration[];
  progressSnapshots: ProgressSnapshot[];
  doomLoopDetections: DoomLoopDetection[];
  checkpointsCreated: number;
  startTime: IsoTimestamp;
  lastWakeEvent?: LoopWakeEvent;
  paused: boolean;
  cancelled: boolean;
  cancelReason?: string;
  signal?: AbortSignal;
  controller: AbortController;
  budgetUsage: BudgetUsage;
  executiveRun: LoopRun;
}

/**
 * Compatibility facade for the retired AgentLoop surface.
 *
 * Public mission execution is owned by QuackRuntime. This class retains the
 * historical API shape, but its start method delegates to that runtime rather
 * than maintaining another production loop.
 */
export class AgentLoop implements LoopDriver {
  private currentRun?: AgentLoopRun;
  private canonicalController?: AbortController;
  private lastResult?: LoopResult;

  constructor(
    private readonly deps: {
      readonly runtime?: QuackRuntime;
      readonly verifyLoopExecution?: LoopDependencies["verifyExecution"];
      readonly missionManager: MissionManager;
      readonly planner: Pick<Planner, "createPlan">;
      readonly skills: SkillRegistry;
      readonly harness: Harness;
      readonly capabilityBroker: CapabilityBroker;
      readonly eventBus: EventBus;
      readonly memory: MemoryStore;
      readonly memoryManager?: MemoryManager;
      readonly verifyExecution?: (iteration: {
        readonly observation: LoopObservation;
        readonly plan: LoopPlan;
        readonly selectedAction?: LoopAction;
        readonly executionResult: LoopExecutionResult;
      }) => Promise<LoopVerificationResult> | LoopVerificationResult;
      readonly onMissionCompleted?: (context: {
        readonly missionId: string;
        readonly runId: string;
        readonly goal: string;
        readonly actor: string;
      }) => Promise<void>;
      readonly workspaceRoot?: string;
      readonly dataDir?: string;
    },
    private readonly config: Partial<AgentLoopConfig> = {}
  ) {}

  async start(options: LoopStartOptions): Promise<LoopResult> {
    const runtime = this.deps.runtime;
    if (!runtime) {
      throw new Error("Legacy AgentLoop direct execution is unsupported; construct it with QuackRuntime.");
    }
    if (this.canonicalController) throw new Error("This loop driver already has an active run.");

    const controller = new AbortController();
    this.canonicalController = controller;
    try {
      const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
      const task = await runtime.submitGoal(options.goal, options.actor ?? "agent-loop", {
        missionId: options.missionId,
        origin: toMissionOrigin(options.origin),
        budget: options.budget,
        signal,
      });
      if (!task.ok) throw new Error(task.error.message);
      const result = runtime.getLoopResult(task.data.id);
      if (!result) throw new Error("Mission was not admitted to the canonical runtime session.");
      this.lastResult = result;
      return result;
    } finally {
      this.canonicalController = undefined;
    }
  }

  /** @deprecated Retained only while private compatibility types are removed. Never call from production code. */
  private async startLegacyUnsafe(options: LoopStartOptions): Promise<LoopResult> {
    if (this.currentRun) throw new Error("This loop driver already has an active run.");
    
    const runId = createId("run");
    const missionId = options.missionId ?? `mission-${runId}`;
    const actor = options.actor ?? "agent-loop";
    const origin = options.origin ?? "system";
    
    // Merge budgets and configs
    const budget: LoopBudget = { ...DEFAULT_LOOP_BUDGET, ...options.budget };
    const loopConfig: LoopConfig = { ...DEFAULT_LOOP_CONFIG, ...options.config };
    
    // Use provided harness or default from deps
    const harness = options.harness ?? this.deps.harness;
    
    // Create default detectors if not provided
    const progressDetector = new DefaultProgressDetector(loopConfig.progressWindowSize);
    const doomLoopDetector = new DefaultDoomLoopDetector(loopConfig.doomLoopFingerprintWindow);
    const wakeupManager = new DefaultWakeupManager(this.deps.eventBus);
    
    // Create executive-loop budget
    const execBudget: Budget = {
      maxIterations: budget.maxIterations,
      maxToolCalls: budget.maxToolCalls,
      maxCost: budget.maxCostUsd,
      maxExecutionTimeMs: budget.maxDurationMs,
      maxConsecutiveFailures: budget.maxConsecutiveFailures,
      maxReplans: budget.maxRetries,
    };
    
    // Create executive loop run
    const executiveRun = createLoopRun({
      missionId,
      goal: options.goal,
      actor,
      origin,
      budget: execBudget,
    });
    
    // Create budget usage tracking
    const budgetUsage = emptyBudgetUsage();
    
    // Create plan and executeGraph functions that bridge to QuackRuntime/SEA
    const planFn = this.createPlanFunction(missionId, actor, origin, options);
    const executeGraphFn = this.createExecuteGraphFunction(harness, missionId, actor, origin, options);
    const verifyExecutionFn = this.createVerifyExecutionFunction();
    
    // Create run state
    const controller = new AbortController();
    const run: AgentLoopRun = {
      runId,
      missionId,
      goal: options.goal,
      actor,
      origin,
      budget,
      config: loopConfig,
      harness,
      capabilityBroker: this.deps.capabilityBroker,
      eventBus: this.deps.eventBus,
      memory: this.deps.memory,
      memoryManager: this.deps.memoryManager,
      progressDetector,
      doomLoopDetector,
      wakeupManager,
      onMissionCompleted: this.deps.onMissionCompleted,
      planFn,
      executeGraphFn,
      verifyExecutionFn,
      workspaceRoot: this.deps.workspaceRoot ?? "",
      dataDir: this.deps.dataDir ?? "",
      state: "IDLE",
      phase: "PREPARE",
      iterations: [],
      progressSnapshots: [],
      doomLoopDetections: [],
      checkpointsCreated: 0,
      startTime: now(),
      paused: false,
      cancelled: false,
      signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
      controller,
      budgetUsage,
      executiveRun,
    };
    
    this.currentRun = run;
    
    // Start heartbeat if enabled
    if (loopConfig.enableEventWakeups) {
      run.wakeupManager.startHeartbeat(loopConfig.heartbeatIntervalMs);
    }
    
    // Register wake event handlers
    const unsubscribeWake = run.wakeupManager.on("TOOL_COMPLETION", async (event: LoopWakeEvent) => {
      run.lastWakeEvent = event;
    });
    
    // Emit loop started event
    await run.eventBus.emit("loop.started", {
      runId,
      missionId,
      goal: options.goal,
      actor,
      budget: budget as unknown as JsonObject,
    }).catch(() => {});
    
    try {
      // Main loop
      run.state = "OBSERVING";
      run.executiveRun = { ...run.executiveRun, currentPhase: "OBSERVE" };
      
      while (true) {
        // Check for cancellation
        if (run.cancelled || run.signal?.aborted) {
          run.state = "CANCELLED";
          run.phase = "CANCEL";
          break;
        }
        
        // Check for pause
        while (run.paused && !run.cancelled && !run.signal?.aborted) {
          run.state = "WAITING_FOR_EXTERNAL_EVENT";
          run.phase = "WAIT";
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (run.paused) continue;
        
        // Check executive-loop budget
        const budgetStop = evaluateBudget(execBudget, run.budgetUsage, Date.now());
        if (budgetStop) {
          run.state = "FAILED";
          run.phase = "FAIL";
          run.cancelReason = mapExecutiveStopReason(budgetStop);
          break;
        }
        
        // Check timeout
        const elapsed = Date.now() - new Date(run.startTime).getTime();
        if (elapsed >= run.budget.maxDurationMs) {
          run.state = "FAILED";
          run.phase = "FAIL";
          run.cancelReason = "TIMEOUT";
          break;
        }
        
        // Run iteration using executive-loop phases
        const iteration = await this.runIteration(run);
        run.iterations.push(iteration);
        
        // Update executive run
        const execIteration = this.toExecutiveIteration(run, iteration);
        run.executiveRun = appendIteration(run.executiveRun, execIteration);
        run.budgetUsage = run.executiveRun.usage;
        
        // Emit iteration event
        await run.eventBus.emit("loop.iteration", {
          runId,
          iteration: iteration.index,
          phase: iteration.phase,
          verificationSuccess: iteration.verificationResult.success,
          progressScore: iteration.progressSnapshot?.progressScore ?? 0,
        }).catch(() => {});
        
        if (run.cancelled || run.signal?.aborted) { run.state = "CANCELLED"; run.phase = "CANCEL"; break; }
        
        // Check for verification success (goal achieved)
        if (iteration.verificationResult.success) {
          run.state = "COMPLETED";
          run.phase = "COMPLETE";
          break;
        }
        
        // Check for capability denied (hard stop)
        if (iteration.executionResult.capabilityDenied) {
          run.cancelReason = "POLICY_DENIED";
          run.state = "FAILED";
          run.phase = "FAIL";
          break;
        }
        
        // Check doom loop
        if (loopConfig.enableDoomLoopDetection && iteration.doomLoopDetection?.detected) {
          run.doomLoopDetections.push(iteration.doomLoopDetection);
          
          // Check if we've detected doom loops repeatedly
          const recentDetections = run.doomLoopDetections.slice(-3);
          if (recentDetections.length >= 3) {
            run.state = "FAILED";
            run.phase = "FAIL";
            run.cancelReason = "DOOM_LOOP";
            break;
          }
          
          // Otherwise replan
          run.phase = "REPLAN";
          continue;
        }
        
        // Check progress
        if (loopConfig.enableProgressDetection && iteration.progressSnapshot) {
          const noProgress = run.progressDetector.checkNoProgress(
            iteration.progressSnapshot,
            run.progressSnapshots
          );
          
          if (noProgress.detected) {
            run.state = "FAILED";
            run.phase = "FAIL";
            run.cancelReason = "NO_PROGRESS";
            break;
          }
        }
        
        // Determine next step from reflection
        switch (iteration.reflection.nextStep) {
          case "complete":
            run.state = "COMPLETED";
            run.phase = "COMPLETE";
            break;
          case "fail":
            run.state = "FAILED";
            run.phase = "FAIL";
            break;
          case "replan":
            run.phase = "REPLAN";
            continue;
          case "retry":
            run.phase = "ACT";
            continue;
          case "wait":
            run.state = "WAITING_FOR_EXTERNAL_EVENT";
            run.phase = "WAIT";
            // Wait for wake event
            await this.waitForWakeEvent(run);
            continue;
          case "escalate":
            run.state = "FAILED";
            run.phase = "FAIL";
            break;
        }
        
        if (run.state === "COMPLETED" || run.state === "FAILED") {
          break;
        }
      }
      
      if (run.state !== "COMPLETED" && run.state !== "CANCELLED") { run.state = "FAILED"; run.phase = "FAIL"; }
      
      // Determine stop reason
      let stopReason: StopReason = "ERROR";
      if (run.state === "COMPLETED") {
        stopReason = "GOAL_REACHED";
      } else if (run.state === "CANCELLED" || run.cancelled) {
        stopReason = "CANCELLED";
      } else if (run.cancelReason) {
        stopReason = run.cancelReason as StopReason;
      } else {
        const budgetStop = evaluateBudget(execBudget, run.budgetUsage, Date.now());
        stopReason = budgetStop ? mapExecutiveStopReason(budgetStop) : "ERROR";
      }
      
      // Create final result
      const result = this.createResult(run, stopReason);
      
      // Emit completion event
      await run.eventBus.emit(run.state === "COMPLETED" ? "loop.completed" : "loop.failed", {
        runId,
        missionId,
        state: run.state,
        stopReason,
        iterations: run.iterations.length,
        durationMs: Date.now() - new Date(run.startTime).getTime(),
      }).catch(() => {});
      
      // Call mission completed callback
      if (run.onMissionCompleted && run.state === "COMPLETED") {
        try {
          await run.onMissionCompleted({
            missionId,
            runId,
            goal: options.goal,
            actor,
          });
        } catch (error) {
          await run.eventBus.emit("loop.failed", {
            runId,
            error: error instanceof Error ? error.message : String(error),
          }).catch(() => {});
        }
      }
      
      // Stop heartbeat
      run.wakeupManager.stopHeartbeat();
      unsubscribeWake();
      
      return result;
    } catch (error) {
      run.wakeupManager.stopHeartbeat();
      unsubscribeWake();
      
      const message = error instanceof Error ? error.message : String(error);
      run.state = "FAILED"; run.phase = "FAIL";
      const result = this.createResult(run, "ERROR", message);
      
      await run.eventBus.emit("loop.failed", {
        runId,
        missionId,
        error: message,
      }).catch(() => {});
      
      return result;
    } finally {
      // Keep reference to final state for getStatus()
      this.currentRun = undefined;
    }
  }
  
  private createPlanFunction(
    _missionId: string,
    _actor: string,
    _origin: string,
    _options: LoopStartOptions
  ): LoopDependencies["plan"] {
    return async (goal: string, observation: LoopObservation, context: LoopExecutionContext) => {
      // Use the SEA planner to create a plan
      const plan = this.deps.planner.createPlan(goal, "");
      return {
        planId: plan.id,
        strategy: plan.strategy,
        nodes: plan.taskGraph.nodes.map((node) => ({
          id: node.id,
          description: node.description,
          toolInvocations: node.toolInvocations ?? [],
          requiredTools: node.requiredTools ?? [],
          dependencies: node.dependencies ?? [],
        })),
        requiredCapabilities: plan.requiresPermissions,
      };
    };
  }
  
  private createExecuteGraphFunction(
    harness: Harness,
    _missionId: string,
    _actor: string,
    _origin: string,
    _options: LoopStartOptions
  ): LoopDependencies["executeGraph"] {
    return async (plan: LoopPlan, loopContext: LoopExecutionContext) => {
      const calls: LoopToolCall[] = [];
      
      if (!plan.nodes.length || !plan.nodes[0].toolInvocations.length) {
        return { success: false, toolCalls: [], capabilityDenied: false, error: "No actionable tools in plan" };
      }
      
      // Execute tool invocations through harness
      for (const node of plan.nodes) {
        for (const invocation of node.toolInvocations) {
          const startedAt = now();
          const output = await harness.send(
            { goal: loopContext.goal, toolInvocations: [invocation] },
            {
              missionId: loopContext.missionId,
              runId: loopContext.runId,
              iterationId: node.id,
              actor: loopContext.actor,
              signal: loopContext.signal,
              deadline: loopContext.deadline,
              workspaceRoot: loopContext.workspaceRoot,
              dataDir: loopContext.dataDir,
              capabilities: loopContext.capabilities,
              trustClass: loopContext.trustClass,
            }
          );
          
          calls.push({
            toolId: invocation.toolId,
            input: invocation.input,
            success: output.success,
            output: output.result,
            error: output.error,
            startedAt,
            completedAt: now(),
            metrics: output.metrics,
          });
          
          if (!output.success) {
            return {
              success: false,
              toolCalls: calls,
              capabilityDenied: output.error?.includes("denied") ?? false,
              error: output.error ?? "Tool execution failed",
            };
          }
        }
      }
      
      return {
        success: true,
        toolCalls: calls,
        capabilityDenied: false,
      };
    };
  }
  
  private createVerifyExecutionFunction(): LoopDependencies["verifyExecution"] {
    return async (action: LoopAction, executionResult: LoopExecutionResult, context: LoopExecutionContext) => {
      if (!action) {
        return { success: false, reason: "No action selected", independent: false };
      }
      
      if (!executionResult.success) {
        return { success: false, reason: executionResult.error ?? "Execution failed", independent: false };
      }
      
      if (executionResult.toolCalls.length === 0) {
        return { success: false, reason: "No tool calls executed", independent: false };
      }
      
      // Use custom verifier if provided
      if (this.deps.verifyExecution) {
        return this.deps.verifyExecution({
          observation: {
            summary: context.goal,
            missionId: context.missionId,
            goal: context.goal,
            memoryMatches: [],
            activeSkillCount: 0,
            activeAgents: 1,
            pendingTasks: 0,
            budgetConsumed: {},
          },
          plan: { planId: "", strategy: "", nodes: [], requiredCapabilities: [] },
          selectedAction: action,
          executionResult,
        });
      }
      
      return { success: false, reason: "No mission validator is configured.", independent: false };
    };
  }

  private async runIteration(run: AgentLoopRun): Promise<LoopIteration> {
    const index = run.iterations.length + 1;
    const startedAt = now();
    
    // PREPARE phase
    run.phase = "PREPARE";
    run.executiveRun = { ...run.executiveRun, currentPhase: "OBSERVE" as ExecutiveLoopPhase };
    
    // OBSERVE phase
    run.phase = "OBSERVE";
    run.executiveRun = { ...run.executiveRun, currentPhase: "OBSERVE" as ExecutiveLoopPhase };
    const observation = await this.observe(run);
    
    // ORIENT phase - create plan
    run.phase = "ORIENT";
    run.executiveRun = { ...run.executiveRun, currentPhase: "ORIENT" as ExecutiveLoopPhase };
    const context: LoopExecutionContext = {
      missionId: run.missionId,
      runId: run.runId,
      goal: run.goal,
      actor: run.actor,
      origin: run.origin,
      budget: run.budget,
      config: run.config,
      startTime: run.startTime,
      harness: run.harness,
      capabilityBroker: run.capabilityBroker,
      eventBus: run.eventBus,
      memory: run.memory,
      memoryManager: run.memoryManager,
      signal: run.signal,
      deadline: new Date(Date.parse(run.startTime) + run.budget.maxDurationMs).toISOString(),
      workspaceRoot: run.workspaceRoot,
      dataDir: run.dataDir,
      capabilities: [],
      trustClass: "SYSTEM",
    };
    
    const plan = run.planFn
      ? await run.planFn(run.goal, observation, context)
      : { planId: createId("plan"), strategy: "No planner strategy is registered.", nodes: [], requiredCapabilities: [] };
    
    run.phase = "DECIDE";
    run.executiveRun = { ...run.executiveRun, currentPhase: "DECIDE" as ExecutiveLoopPhase };
    const selectedAction: LoopAction | undefined = plan.nodes.length ? {
      nodeId: plan.planId,
      description: run.goal,
      requiredTools: [...new Set(plan.nodes.flatMap((node) => node.requiredTools ?? []))],
      toolInvocations: plan.nodes.flatMap((node) => node.toolInvocations),
    } : undefined;
    
    run.phase = "AUTHORIZE";
    run.executiveRun = { ...run.executiveRun, currentPhase: "AUTHORIZE" as ExecutiveLoopPhase };
    
    run.phase = "ACT";
    run.executiveRun = { ...run.executiveRun, currentPhase: "ACT" as ExecutiveLoopPhase };
    const executionResult: LoopExecutionResult = selectedAction?.toolInvocations.length && run.executeGraphFn
      ? await run.executeGraphFn(plan, context)
      : { success: false, toolCalls: [], capabilityDenied: false, error: "No workflow executor is configured." };
    
    run.phase = "VERIFY";
    run.executiveRun = { ...run.executiveRun, currentPhase: "VERIFY" as ExecutiveLoopPhase };
    const verificationResult = await this.verifyResult(selectedAction, executionResult, context, run.verifyExecutionFn);
    
    run.phase = "LEARN";
    run.executiveRun = { ...run.executiveRun, currentPhase: "LEARN" as ExecutiveLoopPhase };
    const reflection = this.reflect(executionResult, verificationResult, index, run.budget.maxIterations);
    
    // Create progress snapshot
    const progressSnapshot = this.createProgressSnapshot(run, index, verificationResult, executionResult);
    run.progressDetector.record(progressSnapshot);
    run.progressSnapshots.push(progressSnapshot);
    
    // Check doom loop
    const doomLoopDetection = run.config.enableDoomLoopDetection
      ? run.doomLoopDetector.check(index, executionResult.toolCalls)
      : { detected: false, type: "UNKNOWN" as const, evidence: [], fingerprint: "", iterationsSinceDetection: 0 };
    
    if (doomLoopDetection.detected) {
      run.doomLoopDetections.push(doomLoopDetection);
    }
    
    const completedAt = now();
    
    return {
      index,
      phase: run.phase,
      startedAt,
      completedAt,
      observation,
      plan,
      selectedAction,
      toolCalls: executionResult.toolCalls,
      executionResult,
      verificationResult,
      reflection,
      progressSnapshot,
      doomLoopDetection: doomLoopDetection.detected ? doomLoopDetection : undefined,
    };
  }
  
  private async observe(run: AgentLoopRun): Promise<LoopObservation> {
    return {
      summary: `Goal: ${run.goal}\nMission: ${run.missionId}\nIteration: ${run.iterations.length + 1}\nMemory matches: 0`,
      missionId: run.missionId,
      goal: run.goal,
      memoryMatches: [],
      activeSkillCount: 0,
      activeAgents: 1,
      pendingTasks: 0,
      budgetConsumed: {
        iterations: run.iterations.length,
        maxIterations: run.budget.maxIterations,
      },
    };
  }
  
  private async verifyResult(
    action: LoopAction | undefined,
    executionResult: LoopExecutionResult,
    context: LoopExecutionContext,
    verifier?: LoopDependencies["verifyExecution"]
  ): Promise<LoopVerificationResult> {
    if (!action) {
      return { success: false, reason: "No action selected", independent: false };
    }
    
    if (!executionResult.success) {
      return { success: false, reason: executionResult.error ?? "Execution failed", independent: false };
    }
    
    if (executionResult.toolCalls.length === 0) {
      return { success: false, reason: "No tool calls executed", independent: false };
    }
    
    if (verifier) {
      return verifier(action, executionResult, context);
    }
    
    // Default: pass verification when no verifier is configured (for testing/backward compatibility)
    return { success: true, reason: "No verifier configured; assuming success", independent: true };
  }
  
  private reflect(
    executionResult: LoopExecutionResult,
    verificationResult: LoopVerificationResult,
    iteration: number,
    maxIterations: number
  ): LoopReflection {
    if (verificationResult.success) {
      return {
        summary: "Verification passed - goal achieved",
        recoverable: false,
        capabilityDenied: false,
        nextStep: "complete",
        confidence: 0.95,
      };
    }
    
    if (executionResult.capabilityDenied) {
      return {
        summary: `Capability denied: ${verificationResult.reason}`,
        recoverable: false,
        capabilityDenied: true,
        nextStep: "fail",
        confidence: 0.9,
      };
    }
    
    if (executionResult.toolCalls.length === 0) {
      return {
        summary: "No tool calls executed, waiting for external event",
        recoverable: true,
        capabilityDenied: false,
        nextStep: "wait",
        confidence: 0.7,
      };
    }
    
    if (iteration >= maxIterations) {
      return {
        summary: `Max iterations (${maxIterations}) reached`,
        recoverable: false,
        capabilityDenied: false,
        nextStep: "fail",
        confidence: 0.8,
      };
    }
    
    return {
      summary: `Verification failed: ${verificationResult.reason}. Will retry.`,
      recoverable: true,
      capabilityDenied: false,
      nextStep: "retry",
      confidence: 0.6,
    };
  }
  
  private createProgressSnapshot(
    run: AgentLoopRun,
    iteration: number,
    verificationResult: LoopVerificationResult,
    executionResult: LoopExecutionResult
  ): ProgressSnapshot {
    const completedReqs = verificationResult.success ? ["goal"] : [];
    const remainingReqs = verificationResult.success ? [] : ["goal"];
    const newEvidence = executionResult.toolCalls
      .filter((tc) => tc.success && tc.output)
      .map((tc) => `${tc.toolId}:${JSON.stringify(tc.output).slice(0, 50)}`);
    const newArtifacts: string[] = [];
    const failedAttempts = executionResult.toolCalls.filter((tc) => !tc.success).length;
    
    const score = run.progressDetector.calculateScore({
      timestamp: now(),
      iteration,
      completedRequirements: completedReqs,
      remainingRequirements: remainingReqs,
      blockedRequirements: [],
      newEvidence,
      newArtifacts,
      failedAttempts,
      progressScore: 0,
      details: {},
    });
    
    return {
      timestamp: now(),
      iteration,
      completedRequirements: completedReqs,
      remainingRequirements: remainingReqs,
      blockedRequirements: [],
      newEvidence,
      newArtifacts,
      failedAttempts,
      progressScore: score,
      details: { verificationSuccess: verificationResult.success },
    };
  }
  
  private async waitForWakeEvent(run: AgentLoopRun): Promise<void> {
    const maxWait = 30_000;
    const startWait = Date.now();
    
    while (!run.lastWakeEvent && !run.cancelled && !run.signal?.aborted) {
      if (Date.now() - startWait > maxWait) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    
    run.lastWakeEvent = undefined;
    run.state = "OBSERVING";
    run.phase = "OBSERVE";
  }
  
  private createResult(run: AgentLoopRun, stopReason: StopReason, error?: string): LoopResult {
    const totalDurationMs = Date.now() - new Date(run.startTime).getTime();
    const totalTokens = run.iterations.reduce((sum, it) => sum + it.toolCalls.reduce((total, call) => total + (call.metrics?.tokensUsed.total ?? 0), 0), 0);
    const totalToolCalls = run.iterations.reduce((sum, it) => sum + it.toolCalls.length, 0);
    const finalProgressScore = run.progressSnapshots[run.progressSnapshots.length - 1]?.progressScore ?? 0;
    
    return {
      runId: run.runId,
      missionId: run.missionId,
      goal: run.goal,
      state: run.state,
      phase: run.phase,
      iterations: run.iterations,
      stopReason,
      error: error ?? (run.state === "COMPLETED" ? undefined : run.iterations.at(-1)?.verificationResult.reason),
      progressSnapshots: run.progressSnapshots,
      doomLoopDetections: run.doomLoopDetections,
      finalProgressScore,
      totalDurationMs,
      totalTokens,
      totalCostUsd: run.iterations.reduce((sum, it) => sum + it.toolCalls.reduce((cost, call) => cost + (call.metrics?.costUsd ?? 0), 0), 0),
      totalToolCalls,
      totalSubagentSpawns: run.iterations.reduce((sum, it) => sum + it.toolCalls.reduce((count, call) => count + (call.metrics?.subagentSpawns ?? 0), 0), 0),
      checkpointsCreated: run.checkpointsCreated,
      completedAt: now(),
    };
  }
  
  private toExecutiveIteration(run: AgentLoopRun, iteration: LoopIteration): IterationRecord {
    return {
      runId: run.runId,
      missionId: run.missionId,
      iterationId: createId("it"),
      index: iteration.index,
      startedAt: iteration.startedAt,
      completedAt: iteration.completedAt,
      phase: "LEARN",
      goal: run.goal,
      observations: { summary: iteration.observation.summary },
      workingContext: {},
      relevantMemory: undefined,
      candidateActions: iteration.selectedAction ? [iteration.selectedAction.nodeId] : [],
      selectedAction: undefined,
      selectionReason: iteration.reflection.summary,
      permissionDecision: undefined,
      executionResult: undefined,
      verification: { status: iteration.verificationResult.success ? "PASSED" : "FAILED", message: iteration.verificationResult.reason },
      evaluation: { verdict: iteration.reflection.nextStep, confidence: iteration.reflection.confidence, message: iteration.reflection.summary },
      stateDelta: undefined,
      memoryDelta: undefined,
      nextStep: iteration.reflection.nextStep === "complete" ? "STOP_SUCCESS" : 
                iteration.reflection.nextStep === "fail" ? "STOP_FAIL" :
                iteration.reflection.nextStep === "retry" ? "RETRY" :
                iteration.reflection.nextStep === "replan" ? "REPLAN" :
                iteration.reflection.nextStep === "wait" ? "WAIT" : "PROCEED",
      stopReason: iteration.verificationResult.success ? "STOP_GOAL_ACHIEVED" : undefined,
      executionErrorSignature: iteration.executionResult.error,
    };
  }

  getStatus(): LoopState {
    return this.currentRun?.state ?? this.lastResult?.state ?? "IDLE";
  }
  
  getCurrentIteration(): LoopIteration | undefined {
    return this.currentRun?.iterations[this.currentRun.iterations.length - 1]
      ?? this.lastResult?.iterations.at(-1);
  }
  
  async pause(): Promise<void> {
    if (this.deps.runtime) throw new Error("Pausing execution is unsupported by the canonical runtime.");
    if (!this.currentRun) throw new Error("No active run to pause.");
    this.currentRun.paused = true;
  }
  
  async resume(): Promise<void> {
    if (this.deps.runtime) throw new Error("Resuming execution is unsupported by the canonical runtime.");
    if (!this.currentRun) throw new Error("No active run to resume.");
    this.currentRun.paused = false;
  }
  
  async cancel(reason?: string): Promise<void> {
    if (this.canonicalController) {
      this.canonicalController.abort(new Error(reason ?? "Loop cancelled."));
      return;
    }
    if (!this.currentRun) throw new Error("No active run to cancel.");
    this.currentRun.cancelled = true;
    this.currentRun.controller.abort(new Error(reason ?? "Loop cancelled."));
    this.currentRun.cancelReason = reason as StopReason | undefined;
  }
  
  async injectEvent(event: LoopWakeEvent): Promise<void> {
    if (this.currentRun) {
      await this.currentRun.wakeupManager.emit(event);
    }
  }
  
  onWakeEvent(handler: (event: LoopWakeEvent) => Promise<void>): () => void {
    if (this.currentRun) {
      const eventTypes: LoopWakeEvent["type"][] = [
        "TOOL_COMPLETION", "BACKGROUND_JOB_COMPLETION", "PROVIDER_RECOVERED",
        "APPROVAL_DECISION", "CHILD_REPORT", "FILE_CHANGE", "GIT_STATUS_CHANGE",
        "TEST_COMPLETION", "EXTERNAL_WATCHED_CONDITION", "TIMER_DEADLINE",
        "HARNESS_HEALTH_CHANGE", "BUDGET_WARNING", "PARENT_FOLLOWUP",
      ];
      const unsubscribers = eventTypes.map((type) => this.currentRun!.wakeupManager.on(type, handler));
      return () => { for (const unsubscribe of unsubscribers) { unsubscribe(); } };
    }
    return () => {};
  }
  
  getProgressSnapshots(): readonly ProgressSnapshot[] {
    return this.currentRun?.progressSnapshots ?? [];
  }
  
  getDoomLoopDetections(): readonly DoomLoopDetection[] {
    return this.currentRun?.doomLoopDetections ?? [];
  }
}

export type AgentLoopState =
  | "IDLE"
  | "OBSERVING"
  | "PLANNING"
  | "EXECUTING"
  | "VERIFYING"
  | "REFLECTING"
  | "COMPLETED"
  | "FAILED";

export interface AgentLoopConfig {
  readonly maxIterations: number;
  readonly iterationTimeoutMs: number;
  readonly maxRecoveryAttempts: number;
  readonly maxConsecutiveFailures?: number;
  readonly maxReplans?: number;
  readonly maxExecutionTimeMs?: number;
}

export interface AgentLoopStartOptions {
  readonly missionId?: string;
  readonly goal?: string;
  readonly actor?: string;
  readonly origin?: MissionOrigin;
  readonly signal?: AbortSignal;
}

export interface AgentLoopObservation {
  readonly summary: string;
  readonly missionId?: string;
  readonly goal: string;
  readonly memoryMatches: readonly string[];
  readonly activeSkillCount: number;
}

export interface AgentLoopAction {
  readonly nodeId: string;
  readonly description: string;
  readonly requiredTools: readonly string[];
  readonly toolInvocations: readonly ToolInvocation[];
}

export interface AgentLoopToolCall {
  readonly toolId: string;
  readonly input: JsonObject;
  readonly success: boolean;
  readonly output?: JsonObject;
  readonly error?: string;
}

export interface AgentLoopExecutionResult {
  readonly success: boolean;
  readonly toolCalls: readonly AgentLoopToolCall[];
  readonly error?: string;
  readonly capabilityDenied: boolean;
}

export interface AgentLoopVerificationResult {
  readonly success: boolean;
  readonly reason: string;
}

export interface AgentLoopReflection {
  readonly summary: string;
  readonly recoverable: boolean;
  readonly capabilityDenied: boolean;
  readonly nextStep: "complete" | "retry" | "fail";
}

export interface AgentLoopIteration {
  readonly index: number;
  readonly observation: AgentLoopObservation;
  readonly plan: EnginePlan;
  readonly selectedAction?: AgentLoopAction;
  readonly toolCalls: readonly AgentLoopToolCall[];
  readonly executionResult: AgentLoopExecutionResult;
  readonly verificationResult: AgentLoopVerificationResult;
  readonly reflectionSummary: string;
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface AgentLoopResult {
  readonly loopId: string;
  readonly runId: string;
  readonly state: AgentLoopState;
  readonly phase: ExecutiveLoopPhase | undefined;
  readonly missionId?: string;
  readonly goal: string;
  readonly iterations: readonly AgentLoopIteration[];
  readonly error?: string;
  readonly stopReason?: ExecutiveStopReason;
  readonly stallClassification?: string;
}

/** Legacy compatibility adapter - wraps AgentLoop as LoopDriver for old callers */
export class LegacyAgentLoopAdapter {
  private readonly agentLoop: AgentLoop;
  private readonly config: AgentLoopConfig = {
    maxIterations: 3,
    iterationTimeoutMs: 30000,
    maxRecoveryAttempts: 3,
  };
  
  constructor(deps: AgentLoopDependencies, config: Partial<AgentLoopConfig> = {}) {
    this.agentLoop = new AgentLoop(deps, config);
  }
  
  async start(options: AgentLoopStartOptions): Promise<AgentLoopResult> {
    const result = await this.agentLoop.start({
      missionId: options.missionId,
      goal: options.goal ?? "",
      actor: options.actor ?? "agent-loop",
      origin: options.origin,
      signal: options.signal,
      budget: { maxIterations: this.config.maxIterations ?? 3 },
    });
    
    return {
      loopId: result.runId,
      runId: result.runId,
      state: result.state as AgentLoopState,
      phase: phaseFromLegacyAgentLoopState(result.state),
      missionId: result.missionId,
      goal: result.goal,
      iterations: result.iterations.map((it) => ({
        index: it.index,
        observation: { summary: it.observation.summary, missionId: it.observation.missionId, goal: it.observation.goal, memoryMatches: it.observation.memoryMatches, activeSkillCount: it.observation.activeSkillCount },
        plan: { id: it.plan?.planId ?? "", goal: it.observation.goal, strategy: it.plan?.strategy ?? "", taskGraph: { id: "", description: "", nodes: [], edges: [], createdAt: now(), updatedAt: now(), metadata: {} } as TaskGraph, riskEstimate: { level: "low" as const, factors: [], mitigation: [] }, costEstimate: { estimatedTokens: 0, estimatedCostUsd: 0, estimatedDurationMs: 0, confidence: 0 }, requiresPermissions: it.plan?.requiredCapabilities ?? [], contextSummary: "", createdAt: it.startedAt },
        selectedAction: it.selectedAction ? { nodeId: it.selectedAction.nodeId, description: it.selectedAction.description, requiredTools: it.selectedAction.requiredTools, toolInvocations: it.selectedAction.toolInvocations } : undefined,
        toolCalls: it.toolCalls.map((tc) => ({ toolId: tc.toolId, input: tc.input, success: tc.success, output: tc.output, error: tc.error })),
        executionResult: { success: it.executionResult.success, toolCalls: it.executionResult.toolCalls, error: it.executionResult.error, capabilityDenied: it.executionResult.capabilityDenied },
        verificationResult: { success: it.verificationResult.success, reason: it.verificationResult.reason },
        reflectionSummary: it.reflection.summary,
        startedAt: it.startedAt,
        completedAt: it.completedAt,
      })),
      error: result.error,
      stopReason: result.stopReason as ExecutiveStopReason | undefined,
    };
  }
  
  getState(): AgentLoopState { return "IDLE"; }
  getStatus(): LoopState { return "IDLE"; }
  getIterations(): readonly AgentLoopIteration[] { return []; }
  async pause(): Promise<void> { throw new Error("Pausing execution is unsupported."); }
  async resume(): Promise<void> { throw new Error("Resuming execution is unsupported."); }
  async cancel(): Promise<void> { await this.agentLoop.cancel(); }
  async injectEvent(_event: LoopWakeEvent): Promise<void> { throw new Error("Legacy event injection is unsupported; use the canonical runtime."); }
}

export interface AgentLoopDependencies {
  readonly runtime?: QuackRuntime;
  readonly verifyLoopExecution?: LoopDependencies["verifyExecution"];
  readonly missionManager: MissionManager;
  readonly planner: Pick<Planner, "createPlan">;
  readonly skills: SkillRegistry;
  readonly harness: Harness;
  readonly capabilityBroker: CapabilityBroker;
  readonly eventBus: EventBus;
  readonly memory: MemoryStore;
  readonly memoryManager?: MemoryManager;
  readonly verifyExecution?: (iteration: {
    readonly observation: LoopObservation;
    readonly plan: LoopPlan;
    readonly selectedAction?: LoopAction;
    readonly executionResult: LoopExecutionResult;
  }) => Promise<LoopVerificationResult> | LoopVerificationResult;
  readonly onMissionCompleted?: (context: {
    readonly missionId: string;
    readonly runId: string;
    readonly goal: string;
    readonly actor: string;
  }) => Promise<void>;
}
