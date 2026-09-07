/**
 * QUACK Loop Driver - Main execution loop implementation
 * 
 * Implements the canonical execution loop with:
 * - Explicit bounds (budget)
 * - Progress detection
 * - Doom-loop detection
 * - Event-driven wakeups
 * - Checkpoint/resume
 * - Verification-last enforcement
 */

import { createId, now, type IsoTimestamp, type JsonObject } from "../core/types.js";
import { type LoopDriver, type LoopStartOptions, type LoopResult, type LoopState, type LoopPhase, type LoopIteration, type LoopBudget, type LoopConfig, type LoopExecutionContext, type LoopObservation, type LoopPlan, type LoopAction, type LoopToolCall, type LoopExecutionResult, type LoopVerificationResult, type LoopReflection, type ProgressSnapshot, type DoomLoopDetection, type LoopWakeEvent, type StopReason, DEFAULT_LOOP_BUDGET, DEFAULT_LOOP_CONFIG, type LoopDependencies } from "./contract.js";
import { type Harness, type HarnessExecutionContext, type HarnessTaskInput } from "../harness/contract.js";
import { type CapabilityBroker } from "../security/capability-broker.js";
import { type EventBus } from "../events/event-bus.js";
import { type MemoryStore } from "../memory/memory.js";
import { type MemoryManager } from "../memory/os.js";
import { DefaultProgressDetector, DefaultDoomLoopDetector, DefaultWakeupManager, createDefaultLoopDependencies } from "./contract.js";

/** Internal loop run state */
interface LoopRun {
  readonly runId: string;
  readonly missionId: string;
  readonly goal: string;
  readonly actor: string;
  readonly origin: string;
  readonly budget: LoopBudget;
  readonly config: LoopConfig;
  readonly harness?: Harness;
  readonly capabilityBroker: CapabilityBroker;
  readonly eventBus: EventBus;
  readonly memory: MemoryStore;
  readonly memoryManager?: MemoryManager;
  readonly progressDetector: DefaultProgressDetector;
  readonly doomLoopDetector: DefaultDoomLoopDetector;
  readonly wakeupManager: DefaultWakeupManager;
  readonly onMissionCompleted?: (context: { missionId: string; runId: string; goal: string; actor: string }) => Promise<void>;
  
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
}

/** Verify execution result */
async function verifyResult(
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
  
  // Check if any tool calls were made
  if (executionResult.toolCalls.length === 0) {
    return { success: false, reason: "No tool calls executed", independent: false };
  }
  
  return verifier ? verifier(action, executionResult, context) : { success: false, reason: "No mission validator is configured.", independent: false };
}

/** Reflect on execution and verification */
function reflect(
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

    // Check if we should wait for external event
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

/** Create progress snapshot */
function createProgressSnapshot(
  run: LoopRun,
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

/** Check budget and return stop reason if exceeded */
function checkBudget(run: LoopRun): StopReason | undefined {
  const budget = run.budget;
  const elapsed = Date.now() - new Date(run.startTime).getTime();
  const totalTokens = run.iterations.reduce((sum, it) => sum + it.toolCalls.reduce((total, call) => total + (call.metrics?.tokensUsed.total ?? 0), 0), 0);

  if (run.iterations.length >= budget.maxIterations) {
    return "ITERATION_LIMIT";
  }

  if (elapsed >= budget.maxDurationMs) {
    return "TIMEOUT";
  }

  if (totalTokens >= budget.maxTokens || run.iterations.reduce((sum, it) => sum + it.toolCalls.reduce((cost, call) => cost + (call.metrics?.costUsd ?? 0), 0), 0) >= budget.maxCostUsd) {
    return "BUDGET_EXCEEDED";
  }

  return undefined;
}

/** Main Loop Driver Implementation */
export class DefaultLoopDriver implements LoopDriver {
  private currentRun?: LoopRun;
  private readonly dependencies: LoopDependencies;
  private readonly defaultBudget: LoopBudget;
  private readonly defaultConfig: LoopConfig;

  constructor(dependencies: LoopDependencies, defaultBudget?: Partial<LoopBudget>, defaultConfig?: Partial<LoopConfig>) {
    this.dependencies = dependencies;
    this.defaultBudget = { ...DEFAULT_LOOP_BUDGET, ...defaultBudget };
    this.defaultConfig = { ...DEFAULT_LOOP_CONFIG, ...defaultConfig };
  }

  async start(options: LoopStartOptions): Promise<LoopResult> {
    if (this.currentRun) throw new Error("This loop driver already has an active run.");
    const runId = options.runId ?? createId("run");
    const missionId = options.missionId ?? `mission-${runId}`;
    const actor = options.actor ?? "loop-driver";
    const origin = options.origin ?? "system";
    
    // Merge budgets and configs
    const budget: LoopBudget = { ...this.defaultBudget, ...options.budget };
    const config: LoopConfig = { ...this.defaultConfig, ...options.config };
    
    // Use provided harness or default
    const harness = options.harness ?? this.dependencies.harness;
    
    // Create default detectors if not provided
    const progressDetector = this.dependencies.progressDetector ?? new DefaultProgressDetector(config.progressWindowSize);
    const doomLoopDetector = this.dependencies.doomLoopDetector ?? new DefaultDoomLoopDetector(config.doomLoopFingerprintWindow);
    const wakeupManager = this.dependencies.wakeupManager ?? new DefaultWakeupManager(this.dependencies.eventBus);
    
    // Create run state
    const controller = new AbortController();
    const run: LoopRun = {
      runId,
      missionId,
      goal: options.goal,
      actor,
      origin,
      budget,
      config,
      harness,
      capabilityBroker: this.dependencies.capabilityBroker,
      eventBus: this.dependencies.eventBus,
      memory: this.dependencies.memory,
      memoryManager: this.dependencies.memoryManager,
      progressDetector,
      doomLoopDetector,
      wakeupManager,
      onMissionCompleted: this.dependencies.onMissionCompleted,
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
    };
    
    this.currentRun = run;
    
    // Start heartbeat if enabled
    if (config.enableEventWakeups) {
      run.wakeupManager.startHeartbeat(config.heartbeatIntervalMs);
    }
    
    // Register wake event handlers
    const unsubscribeWake = run.wakeupManager.on("TOOL_COMPLETION", async (event: LoopWakeEvent) => {
      run.lastWakeEvent = event;
    });
    
    // Emit loop started event
    await run.eventBus.emit("loop.started" as any, {
      runId,
      missionId,
      goal: options.goal,
      actor,
      budget: budget as unknown as JsonObject,
    }).catch(() => {});
    
    try {
      // Main loop
      run.state = "OBSERVING";
      
      while (true) {
        // Check for cancellation
        if (run.cancelled || run.signal?.aborted) {
          run.state = "CANCELLED";
          break;
        }
        
        // Check for pause
        while (run.paused && !run.cancelled && !run.signal?.aborted) {
          run.state = "WAITING_FOR_EXTERNAL_EVENT";
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (run.paused) continue;
        
        // Check budget
        const budgetStop = checkBudget(run);
        if (budgetStop) {
          run.state = "FAILED";
          break;
        }
        
        // Check timeout BEFORE doom loop detection
        const elapsed = Date.now() - new Date(run.startTime).getTime();
        if (elapsed >= run.budget.maxDurationMs) {
          run.state = "FAILED";
          run.phase = "FAIL";
          break;
        }
        
        // Run iteration
        const iteration = await this.runIteration(run);
        run.iterations.push(iteration);
        
        // Emit iteration event
        await run.eventBus.emit("loop.iteration" as any, {
          runId,
          iteration: iteration.index,
          phase: iteration.phase,
          verificationSuccess: iteration.verificationResult.success,
          progressScore: iteration.progressSnapshot?.progressScore ?? 0,
        }).catch(() => {});
        
        if (run.cancelled || run.signal?.aborted) { run.state = "CANCELLED"; run.phase = "CANCEL"; break; }
        if (!selectedPlanIsExecutable(iteration) || (iteration.executionResult.success && !iteration.verificationResult.success)) {
          run.state = "FAILED"; run.phase = "FAIL"; run.cancelReason = "NEEDS_HELP"; break;
        }
        const consumedTokens = run.iterations.flatMap((item) => item.toolCalls).reduce((sum, call) => sum + (call.metrics?.tokensUsed.total ?? 0), 0);
        const consumedCost = run.iterations.flatMap((item) => item.toolCalls).reduce((sum, call) => sum + (call.metrics?.costUsd ?? 0), 0);
        if (consumedTokens > run.budget.maxTokens || consumedCost > run.budget.maxCostUsd || Date.now() >= Date.parse(run.startTime) + run.budget.maxDurationMs) {
          run.state = "FAILED"; run.phase = "FAIL"; run.cancelReason = "BUDGET_EXCEEDED"; break;
        }
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
        if (iteration.executionResult.workflowState && !iteration.executionResult.success) {
          run.state = "FAILED";
          run.phase = "FAIL";
          break;
        }
        
        // Check doom loop
        if (config.enableDoomLoopDetection && iteration.doomLoopDetection?.detected) {
          run.doomLoopDetections.push(iteration.doomLoopDetection);
          
          // Check if we've detected doom loops repeatedly
          const recentDetections = run.doomLoopDetections.slice(-3);
          if (recentDetections.length >= 3) {
            run.state = "FAILED";
            run.phase = "FAIL";
            break;
          }
          
          // Otherwise replan
          run.phase = "REPLAN";
          continue;
        }
        
        // Check progress
        if (config.enableProgressDetection && iteration.progressSnapshot) {
          const noProgress = run.progressDetector.checkNoProgress(
            iteration.progressSnapshot,
            run.progressSnapshots
          );
          
          if (noProgress.detected) {
            run.state = "FAILED";
            run.phase = "FAIL";
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
        const budgetStop = checkBudget(run);
        stopReason = budgetStop ?? "ERROR";
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
          await run.eventBus.emit("loop.missionCompletedError" as any, {
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
      
      await run.eventBus.emit("loop.failed" as any, {
        runId,
        missionId,
        error: message,
      }).catch(() => {});
      
      return result;
    } finally {
      this.currentRun = undefined;
    }
  }

  private async runIteration(run: LoopRun): Promise<LoopIteration> {
    const index = run.iterations.length + 1;
    const startedAt = now();
    
    // PREPARE phase
    run.phase = "PREPARE";
    
    // REQUEST phase - observe and plan
    run.phase = "REQUEST";
    const observation = await this.observe(run);
    
    // OBSERVE phase - create plan
    run.phase = "OBSERVE";
    const context: LoopExecutionContext = {
      missionId: run.missionId, runId: run.runId, goal: run.goal, actor: run.actor, origin: run.origin,
      budget: run.budget, config: run.config, startTime: run.startTime, harness: run.harness,
      capabilityBroker: run.capabilityBroker, eventBus: run.eventBus, memory: run.memory,
      memoryManager: run.memoryManager, signal: run.signal,
      deadline: new Date(Date.parse(run.startTime) + run.budget.maxDurationMs).toISOString(),
      workspaceRoot: this.dependencies.workspaceRoot ?? "", dataDir: this.dependencies.dataDir ?? "",
      capabilities: [], trustClass: "SYSTEM",
    };
    const plan = this.dependencies.plan
      ? await this.dependencies.plan(run.goal, observation, context)
      : { planId: createId("plan"), strategy: "No planner strategy is registered.", nodes: [], requiredCapabilities: [] };
    run.phase = "ACT";
    const selectedAction: LoopAction | undefined = plan.nodes.length ? {
      nodeId: plan.planId, description: run.goal,
      requiredTools: [...new Set(plan.nodes.flatMap((node) => node.requiredTools))],
      toolInvocations: plan.nodes.flatMap((node) => node.toolInvocations),
    } : undefined;
    const executionResult: LoopExecutionResult = selectedAction?.toolInvocations.length && this.dependencies.executeGraph
      ? await this.dependencies.executeGraph(plan, context)
      : { success: false, toolCalls: [], capabilityDenied: false,
          error: !this.dependencies.plan ? "No planner strategy is registered." : !this.dependencies.executeGraph
            ? "No workflow executor is configured." : "No actionable tools in plan" };
    run.phase = "VERIFY";
    const verificationResult = await verifyResult(selectedAction, executionResult, context, this.dependencies.verifyExecution);

    // REFLECT/LEARN phase
    run.phase = "ASSESS_PROGRESS";
    const reflection = reflect(executionResult, verificationResult, index, run.budget.maxIterations);
    
    // Create progress snapshot
    const progressSnapshot = createProgressSnapshot(run, index, verificationResult, executionResult);
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

  private async observe(run: LoopRun): Promise<LoopObservation> {
    const memoryMatches: { content: string }[] = [];

    return {
      summary: `Goal: ${run.goal}\nMission: ${run.missionId}\nIteration: ${run.iterations.length + 1}\nMemory matches: ${memoryMatches.length}`,
      missionId: run.missionId,
      goal: run.goal,
      memoryMatches: memoryMatches.map((m) => m.content),
      activeSkillCount: 0, // TODO: integrate with skill registry
      activeAgents: 1,
      pendingTasks: 0,
      budgetConsumed: {
        iterations: run.iterations.length,
        maxIterations: run.budget.maxIterations,
      },
    };
  }

  private async waitForWakeEvent(run: LoopRun): Promise<void> {
    // Wait for a wake event or timeout
    const maxWait = 30_000; // 30 seconds
    const startWait = Date.now();
    
    while (!run.lastWakeEvent && !run.cancelled && !run.signal?.aborted) {
      if (Date.now() - startWait > maxWait) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    
    run.lastWakeEvent = undefined;
    run.state = "OBSERVING";
  }

  private createResult(run: LoopRun, stopReason: StopReason, error?: string): LoopResult {
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

  getState(): LoopState {
    return this.currentRun?.state ?? "IDLE";
  }
  
  getStatus(): LoopState {
    return this.getState();
  }

  getCurrentIteration(): LoopIteration | undefined {
    return this.currentRun?.iterations[this.currentRun.iterations.length - 1];
  }

  async pause(): Promise<void> {
    throw new Error("Pausing execution is unsupported; cancellation remains available for an active run.");
  }

  async resume(): Promise<void> {
    throw new Error("Resuming a paused or checkpointed run is unsupported.");
  }

  async cancel(reason?: string): Promise<void> {
    if (!this.currentRun) throw new Error("No active driver run to cancel.");
    if (this.currentRun) {
      this.currentRun.cancelled = true;
      this.currentRun.controller.abort(new Error(reason ?? "Loop cancelled."));
      this.currentRun.cancelReason = reason as StopReason | undefined;
    }
  }

  async injectEvent(event: LoopWakeEvent): Promise<void> {
    if (this.currentRun) {
      this.currentRun.wakeupManager.emit(event);
    }
  }

  onWakeEvent(handler: (event: LoopWakeEvent) => Promise<void>): () => void {
    if (this.currentRun) {
      // Register for all wake event types
      const unsubscribers = [
        this.currentRun.wakeupManager.on("TOOL_COMPLETION", handler),
        this.currentRun.wakeupManager.on("BACKGROUND_JOB_COMPLETION", handler),
        this.currentRun.wakeupManager.on("PROVIDER_RECOVERED", handler),
        this.currentRun.wakeupManager.on("APPROVAL_DECISION", handler),
        this.currentRun.wakeupManager.on("CHILD_REPORT", handler),
        this.currentRun.wakeupManager.on("FILE_CHANGE", handler),
        this.currentRun.wakeupManager.on("GIT_STATUS_CHANGE", handler),
        this.currentRun.wakeupManager.on("TEST_COMPLETION", handler),
        this.currentRun.wakeupManager.on("EXTERNAL_WATCHED_CONDITION", handler),
        this.currentRun.wakeupManager.on("TIMER_DEADLINE", handler),
        this.currentRun.wakeupManager.on("HARNESS_HEALTH_CHANGE", handler),
        this.currentRun.wakeupManager.on("BUDGET_WARNING", handler),
        this.currentRun.wakeupManager.on("PARENT_FOLLOWUP", handler),
      ];
      return () => {
        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }
      };
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

/**
 * Factory function to create a loop driver with default dependencies
 */
export function createLoopDriver(
  harness: Harness,
  capabilityBroker: CapabilityBroker,
  eventBus: EventBus,
  memory: MemoryStore,
  memoryManager?: MemoryManager,
  defaultBudget?: Partial<LoopBudget>,
  defaultConfig?: Partial<LoopConfig>
): LoopDriver {
  const dependencies = createDefaultLoopDependencies(
    harness,
    capabilityBroker,
    eventBus,
    memory,
    memoryManager
  );
  
  return new DefaultLoopDriver(dependencies, defaultBudget, defaultConfig);
}

export { DefaultProgressDetector, DefaultDoomLoopDetector, DefaultWakeupManager } from "./contract.js";
export * from "./contract.js";
function selectedPlanIsExecutable(iteration: LoopIteration): boolean { return Boolean(iteration.selectedAction?.toolInvocations.length); }
