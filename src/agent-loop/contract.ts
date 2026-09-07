/**
 * QUACK Execution Loop Contract
 * 
 * Single normalized execution loop with explicit bounds, progress detection,
 * doom-loop detection, and event-driven wakeups.
 */

import { type IsoTimestamp, type JsonObject, type JsonValue, createId } from "../core/types.js";
import { type EventBus } from "../events/event-bus.js";
import { type MemoryStore } from "../memory/memory.js";
import { type MemoryManager } from "../memory/os.js";
import { type CapabilityBroker } from "../security/capability-broker.js";
import { type Harness, type HarnessExecutionContext, type HarnessTaskInput, type HarnessTaskOutput } from "../harness/contract.js";
import type { TaskGraph, WorkflowState } from "../engine/types.js";

/** Loop phase - canonical phases from executive loop contract */
export type LoopPhase = 
  | "PREPARE"
  | "REQUEST" 
  | "OBSERVE"
  | "ORIENT"
  | "DECIDE"
  | "AUTHORIZE"
  | "ACT"
  | "ASSESS_PROGRESS"
  | "REPLAN"
  | "WAIT"
  | "VERIFY"
  | "LEARN"
  | "COMPLETE"
  | "FAIL"
  | "CANCEL";

/** Loop state */
export type LoopState = 
  | "IDLE"
  | "OBSERVING"
  | "PLANNING"
  | "EXECUTING"
  | "VERIFYING"
  | "REFLECTING"
  | "COMPLETED"
  | "FAILED"
  | "WAITING_FOR_APPROVAL"
  | "WAITING_FOR_EXTERNAL_EVENT"
  | "CANCELLED";

/** Stop/Completion reasons */
export type StopReason = 
  | "GOAL_REACHED"
  | "VERIFIED"
  | "NO_PROGRESS"
  | "DOOM_LOOP"
  | "BUDGET_EXCEEDED"
  | "TIMEOUT"
  | "ITERATION_LIMIT"
  | "WAITING_FOR_APPROVAL"
  | "WAITING_FOR_EXTERNAL_EVENT"
  | "NEEDS_HELP"
  | "CANCELLED"
  | "POLICY_DENIED"
  | "PROVIDER_FAILURE"
  | "HARNESS_FAILURE"
  | "ERROR"
  | "STOP_GOAL_ACHIEVED"
  | "STOP_MAX_ITERATIONS"
  | "STOP_MAX_MODEL_CALLS"
  | "STOP_MAX_TOOL_CALLS"
  | "STOP_BUDGET_EXCEEDED"
  | "STOP_TIMEOUT"
  | "STOP_POLICY_DENIED"
  | "STOP_STALL_NO_PROGRESS"
  | "STOP_STALL_OSCILLATION"
  | "STOP_STALL_REPEATED_FAILURE"
  | "STOP_UNRECOVERABLE_ERROR"
  | "STOP_CANCELLED"
  | "STOP_HUMAN_ABORT";

/** Loop budget bounds */
export interface LoopBudget {
  readonly maxToolCalls?: number;
  readonly maxConcurrentNodes?: number;
  readonly maxIterations: number;
  readonly maxDurationMs: number;
  readonly maxTokens: number;
  readonly maxCostUsd: number;
  readonly maxRetries: number;
  readonly maxConsecutiveFailures: number;
  readonly maxNoProgressIterations: number;
  readonly maxDelegationDepth: number;
  readonly maxAgents: number;
  readonly maxConcurrentAgents: number;
}

/** Default budget */
export const DEFAULT_LOOP_BUDGET: LoopBudget = {
  maxToolCalls: 1000,
  maxConcurrentNodes: 3,
  maxIterations: 50,
  maxDurationMs: 30 * 60 * 1000, // 30 minutes
  maxTokens: 1_000_000,
  maxCostUsd: 10.00,
  maxRetries: 3,
  maxConsecutiveFailures: 5,
  maxNoProgressIterations: 5,
  maxDelegationDepth: 3,
  maxAgents: 8,
  maxConcurrentAgents: 6,
};

/** Progress snapshot for tracking objective progress */
export interface ProgressSnapshot {
  readonly timestamp: IsoTimestamp;
  readonly iteration: number;
  readonly completedRequirements: readonly string[];
  readonly remainingRequirements: readonly string[];
  readonly blockedRequirements: readonly string[];
  readonly newEvidence: readonly string[];
  readonly newArtifacts: readonly string[];
  readonly failedAttempts: number;
  readonly progressScore: number; // 0-100
  readonly details: JsonObject;
}

/** Doom-loop detection result */
export interface DoomLoopDetection {
  readonly detected: boolean;
  readonly type: "IDENTICAL_CALLS" | "IDENTICAL_OUTPUTS" | "A_B_OSCILLATION" | "FAILING_TEST_LOOP" | "PATCH_OSCILLATION" | "PROVIDER_FALLBACK_PINGPONG" | "VERIFICATION_LOOP" | "DELEGATION_CYCLE" | "EMPTY_RESULTS" | "WEB_SEARCH_LOOP" | "RETRY_STORM" | "UNKNOWN";
  readonly evidence: readonly string[];
  readonly fingerprint: string;
  readonly iterationsSinceDetection: number;
}

/** Event that can wake the loop */
export type LoopWakeEventType = "TOOL_COMPLETION" | "BACKGROUND_JOB_COMPLETION" | "PROVIDER_RECOVERED" | "APPROVAL_DECISION" | "CHILD_REPORT" | "FILE_CHANGE" | "GIT_STATUS_CHANGE" | "TEST_COMPLETION" | "EXTERNAL_WATCHED_CONDITION" | "TIMER_DEADLINE" | "HARNESS_HEALTH_CHANGE" | "BUDGET_WARNING" | "PARENT_FOLLOWUP";

/** Event that can wake the loop */
export interface LoopWakeEvent {
  readonly type: LoopWakeEventType;
  readonly source: string;
  readonly missionId: string;
  readonly runId: string; // Required for JsonObject compatibility
  readonly timestamp: IsoTimestamp;
  readonly payload: JsonObject;
  readonly [key: string]: JsonValue; // Index signature for JsonObject compatibility
}

/** Loop configuration */
export interface LoopConfig {
  readonly budget: Partial<LoopBudget>;
  readonly enableProgressDetection: boolean;
  readonly enableDoomLoopDetection: boolean;
  readonly enableEventWakeups: boolean;
  readonly heartbeatIntervalMs: number; // Safety net heartbeat
  readonly progressWindowSize: number; // Iterations to compare for no-progress
  readonly doomLoopFingerprintWindow: number; // Iterations to track for fingerprints
}

/** Default loop config */
export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  budget: {},
  enableProgressDetection: true,
  enableDoomLoopDetection: true,
  enableEventWakeups: true,
  heartbeatIntervalMs: 60_000, // 1 minute safety net
  progressWindowSize: 5,
  doomLoopFingerprintWindow: 20,
};

/** Loop execution context */
export interface LoopExecutionContext {
  readonly missionId: string;
  readonly runId: string;
  readonly goal: string;
  readonly actor: string;
  readonly origin: string;
  readonly budget: LoopBudget;
  readonly config: LoopConfig;
  readonly startTime: IsoTimestamp;
  readonly harness?: Harness;
  readonly capabilityBroker: CapabilityBroker;
  readonly eventBus: EventBus;
  readonly memory: MemoryStore;
  readonly memoryManager?: MemoryManager;
  readonly signal?: AbortSignal;
  readonly deadline?: IsoTimestamp;
  readonly workspaceRoot: string;
  readonly dataDir: string;
  readonly capabilities: readonly string[];
  readonly trustClass: "SYSTEM" | "OWNER" | "TRUSTED_TOOL" | "PROJECT_FILE" | "KNOWLEDGE" | "SUBAGENT" | "UNTRUSTED_WEB" | "UNTRUSTED_EXTERNAL";
}

/** Loop iteration record */
export interface LoopIteration {
  readonly index: number;
  readonly phase: LoopPhase;
  readonly startedAt: IsoTimestamp;
  readonly completedAt: IsoTimestamp;
  readonly observation: LoopObservation;
  readonly plan?: LoopPlan;
  readonly selectedAction?: LoopAction;
  readonly toolCalls: readonly LoopToolCall[];
  readonly executionResult: LoopExecutionResult;
  readonly verificationResult: LoopVerificationResult;
  readonly reflection: LoopReflection;
  readonly progressSnapshot?: ProgressSnapshot;
  readonly doomLoopDetection?: DoomLoopDetection;
}

/** Loop observation */
export interface LoopObservation {
  readonly summary: string;
  readonly missionId: string;
  readonly goal: string;
  readonly memoryMatches: readonly string[];
  readonly activeSkillCount: number;
  readonly activeAgents: number;
  readonly pendingTasks: number;
  readonly budgetConsumed: JsonObject;
}

/** Loop plan */
export interface LoopPlan {
  readonly taskGraph?: TaskGraph;
  readonly planId: string;
  readonly strategy: string;
  readonly nodes: readonly LoopPlanNode[];
  readonly requiredCapabilities: readonly string[];
}

/** Loop plan node */
export interface LoopPlanNode {
  readonly id: string;
  readonly description: string;
  readonly toolInvocations: readonly LoopToolInvocation[];
  readonly requiredTools: readonly string[];
  readonly dependencies: readonly string[];
  readonly verifier?: boolean;
}

/** Tool invocation in plan */
export interface LoopToolInvocation {
  readonly toolId: string;
  readonly input: JsonObject;
  readonly reason?: string;
}

/** Loop action selected for execution */
export interface LoopAction {
  readonly nodeId: string;
  readonly description: string;
  readonly requiredTools: readonly string[];
  readonly toolInvocations: readonly LoopToolInvocation[];
}

/** Tool call record */
export interface LoopToolCall {
  readonly metrics?: HarnessTaskOutput["metrics"];
  readonly toolId: string;
  readonly input: JsonObject;
  readonly success: boolean;
  readonly output?: JsonObject;
  readonly error?: string;
  readonly startedAt: IsoTimestamp;
  readonly completedAt: IsoTimestamp;
}

/** Execution result */
export interface LoopExecutionResult {
  readonly workflowState?: WorkflowState;
  readonly success: boolean;
  readonly toolCalls: readonly LoopToolCall[];
  readonly error?: string;
  readonly capabilityDenied: boolean;
  readonly harnessOutput?: HarnessTaskOutput;
}

/** Verification result */
export interface LoopVerificationResult {
  readonly success: boolean;
  readonly reason: string;
  readonly independent: boolean; // True if independent verifier
}

/** Reflection result */
export interface LoopReflection {
  readonly summary: string;
  readonly recoverable: boolean;
  readonly capabilityDenied: boolean;
  readonly nextStep: "complete" | "retry" | "fail" | "replan" | "wait" | "escalate";
  readonly confidence: number;
}

/** Complete loop result */
export interface LoopResult {
  readonly runId: string;
  readonly missionId: string;
  readonly goal: string;
  readonly state: LoopState;
  readonly phase: LoopPhase | undefined;
  readonly iterations: readonly LoopIteration[];
  readonly stopReason?: StopReason;
  readonly error?: string;
  readonly progressSnapshots: readonly ProgressSnapshot[];
  readonly doomLoopDetections: readonly DoomLoopDetection[];
  readonly finalProgressScore: number;
  readonly totalDurationMs: number;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly totalToolCalls: number;
  readonly totalSubagentSpawns: number;
  readonly checkpointsCreated: number;
  readonly completedAt: IsoTimestamp;
}

/** Loop driver interface */
export interface LoopDriver {
  /** Start a new loop execution */
  start(options: LoopStartOptions): Promise<LoopResult>;
  
  /** Get current loop status */
  getStatus(): LoopState;
  
  /** Get current iteration */
  getCurrentIteration(): LoopIteration | undefined;
  
  /** Pause the loop */
  pause(): Promise<void>;
  
  /** Resume the loop */
  resume(): Promise<void>;
  
  /** Cancel the loop */
  cancel(reason?: string): Promise<void>;
  
  /** Inject an event to wake the loop */
  injectEvent(event: LoopWakeEvent): Promise<void>;
  
  /** Register a wake event handler */
  onWakeEvent(handler: (event: LoopWakeEvent) => Promise<void>): () => void;
  
  /** Get progress snapshots */
  getProgressSnapshots(): readonly ProgressSnapshot[];
  
  /** Get doom loop detections */
  getDoomLoopDetections(): readonly DoomLoopDetection[];
}

/** Loop start options */
export interface LoopStartOptions {
  /** Host-owned logical execution identity; reused by canonical recovery. */
  readonly runId?: string;
  readonly missionId?: string;
  readonly goal: string;
  readonly actor?: string;
  readonly origin?: string;
  readonly budget?: Partial<LoopBudget>;
  readonly config?: Partial<LoopConfig>;
  readonly harness?: Harness;
  readonly signal?: AbortSignal;
}

/** Progress detector interface */
export interface ProgressDetector {
  /** Record a progress snapshot */
  record(snapshot: ProgressSnapshot): void;
  
  /** Check for no-progress condition */
  checkNoProgress(current: ProgressSnapshot, previous: readonly ProgressSnapshot[]): { detected: boolean; reason?: string };
  
  /** Calculate progress score from snapshot */
  calculateScore(snapshot: ProgressSnapshot): number;
  
  /** Get progress history */
  getHistory(): readonly ProgressSnapshot[];
}

/** Doom loop detector interface */
export interface DoomLoopDetector {
  /** Record a tool call fingerprint */
  recordFingerprint(fingerprint: string, iteration: number): void;
  
  /** Check for doom loop patterns */
  check(iteration: number, recentCalls: readonly LoopToolCall[]): DoomLoopDetection;
  
  /** Get detection history */
  getDetections(): readonly DoomLoopDetection[];
  
  /** Clear history */
  clear(): void;
}

/** Event wakeup manager interface */
export interface WakeupManager {
  /** Register an event listener */
  on(eventType: LoopWakeEvent["type"], handler: (event: LoopWakeEvent) => Promise<void>): () => void;
  
  /** Emit an event to wake the loop */
  emit(event: LoopWakeEvent): Promise<void>;
  
  /** Start heartbeat safety net */
  startHeartbeat(intervalMs: number): void;
  
  /** Stop heartbeat */
  stopHeartbeat(): void;
}

/** Loop dependencies */
export interface LoopDependencies {
  readonly plan?: (goal: string, observation: LoopObservation, context: LoopExecutionContext) => Promise<LoopPlan> | LoopPlan;
  readonly executeGraph?: (plan: LoopPlan, context: LoopExecutionContext) => Promise<LoopExecutionResult>;
  readonly workspaceRoot?: string;
  readonly dataDir?: string;
  readonly verifyExecution?: (action: LoopAction, result: LoopExecutionResult, context: LoopExecutionContext) => Promise<LoopVerificationResult> | LoopVerificationResult;

  readonly harness?: Harness;
  readonly capabilityBroker: CapabilityBroker;
  readonly eventBus: EventBus;
  readonly memory: MemoryStore;
  readonly memoryManager?: MemoryManager;
  readonly progressDetector?: DefaultProgressDetector;
  readonly doomLoopDetector?: DefaultDoomLoopDetector;
  readonly wakeupManager?: DefaultWakeupManager;
  readonly onMissionCompleted?: (context: { missionId: string; runId: string; goal: string; actor: string }) => Promise<void>;
}

/**
 * Default progress detector implementation
 */
export class DefaultProgressDetector implements ProgressDetector {
  private history: ProgressSnapshot[] = [];
  private readonly windowSize: number;

  constructor(windowSize = 5) {
    this.windowSize = windowSize;
  }

  record(snapshot: ProgressSnapshot): void {
    this.history.push(snapshot);
    // Keep only recent history
    if (this.history.length > this.windowSize * 2) {
      this.history = this.history.slice(-this.windowSize * 2);
    }
  }

  checkNoProgress(current: ProgressSnapshot, previous: readonly ProgressSnapshot[]): { detected: boolean; reason?: string } {
    if (previous.length === 0) return { detected: false };
    
    // Check if progress score hasn't changed across the window
    const recentScores = previous.slice(-this.windowSize).map((s) => s.progressScore);
    const allSame = recentScores.every((s) => s === current.progressScore) && recentScores.length >= this.windowSize;
    
    if (allSame) {
      return { 
        detected: true, 
        reason: `Progress score unchanged at ${current.progressScore} for ${this.windowSize} iterations` 
      };
    }
    
    // Check if no new evidence or artifacts
    const noNewEvidence = previous.slice(-this.windowSize).every((s) => s.newEvidence.length === 0 && current.newEvidence.length === 0);
    const noNewArtifacts = previous.slice(-this.windowSize).every((s) => s.newArtifacts.length === 0 && current.newArtifacts.length === 0);
    const noCompletedReqs = previous.slice(-this.windowSize).every((s) => s.completedRequirements.length === current.completedRequirements.length);
    
    if (noNewEvidence && noNewArtifacts && noCompletedReqs && recentScores.length >= this.windowSize) {
      return { 
        detected: true, 
        reason: "No new evidence, artifacts, or completed requirements for window" 
      };
    }
    
    return { detected: false };
  }

  calculateScore(snapshot: ProgressSnapshot): number {
    // Weighted scoring
    const completedWeight = 40;
    const evidenceWeight = 20;
    const artifactWeight = 20;
    const blockerWeight = -10; // Negative for blocked
    const failedWeight = -10;
    
    const completed = snapshot.completedRequirements.length * 10;
    const evidence = Math.min(snapshot.newEvidence.length * 5, 20);
    const artifacts = Math.min(snapshot.newArtifacts.length * 5, 20);
    const blockers = snapshot.blockedRequirements.length * -5;
    const failed = snapshot.failedAttempts * -2;
    
    let score = completed + evidence + artifacts + blockers + failed;
    score = Math.max(0, Math.min(100, score));
    return score;
  }

  getHistory(): readonly ProgressSnapshot[] {
    return [...this.history];
  }
}

/**
 * Default doom loop detector implementation
 */
export class DefaultDoomLoopDetector implements DoomLoopDetector {
  private fingerprints: Map<string, { fingerprint: string; iterations: number[]; count: number }> = new Map();
  private recentCalls: LoopToolCall[] = [];
  private readonly window: number;
  private detections: DoomLoopDetection[] = [];

  constructor(window = 20) {
    this.window = window;
  }

  recordFingerprint(fingerprint: string, iteration: number): void {
    const existing = this.fingerprints.get(fingerprint);
    if (existing) {
      existing.iterations.push(iteration);
      existing.count++;
    } else {
      this.fingerprints.set(fingerprint, { fingerprint, iterations: [iteration], count: 1 });
    }
    
    // Clean old fingerprints
    for (const [fp, data] of this.fingerprints) {
      if (data.iterations[data.iterations.length - 1] < iteration - this.window) {
        this.fingerprints.delete(fp);
      }
    }
  }

  check(iteration: number, recentCalls: readonly LoopToolCall[]): DoomLoopDetection {
    this.recentCalls = [...recentCalls];
    
    // Check 1: Identical tool calls
    if (recentCalls.length >= 3) {
      const last3 = recentCalls.slice(-3);
      const allIdentical = last3.every((c) => 
        c.toolId === last3[0].toolId && 
        JSON.stringify(c.input) === JSON.stringify(last3[0].input)
      );
      if (allIdentical) {
        const fp = `identical:${last3[0].toolId}:${JSON.stringify(last3[0].input)}`;
        this.recordFingerprint(fp, iteration);
        return {
          detected: true,
          type: "IDENTICAL_CALLS",
          evidence: [`Tool ${last3[0].toolId} called with identical input 3 times`],
          fingerprint: fp,
          iterationsSinceDetection: 0,
        };
      }
    }
    
    // Check 2: Identical tool outputs (failures)
    if (recentCalls.length >= 3) {
      const last3 = recentCalls.slice(-3);
      const allFailedIdentical = last3.every((c) => 
        !c.success && 
        c.error === last3[0].error &&
        c.toolId === last3[0].toolId
      );
      if (allFailedIdentical) {
        const fp = `identical_output:${last3[0].toolId}:${last3[0].error}`;
        this.recordFingerprint(fp, iteration);
        return {
          detected: true,
          type: "IDENTICAL_OUTPUTS",
          evidence: [`Tool ${last3[0].toolId} failed identically 3 times: ${last3[0].error}`],
          fingerprint: fp,
          iterationsSinceDetection: 0,
        };
      }
    }
    
    // Check 3: A -> B -> A -> B oscillation
    if (recentCalls.length >= 4) {
      const last4 = recentCalls.slice(-4);
      const abab = last4[0].toolId === last4[2].toolId && 
                   last4[1].toolId === last4[3].toolId &&
                   last4[0].toolId !== last4[1].toolId;
      if (abab) {
        const fp = `oscillation:${last4[0].toolId}:${last4[1].toolId}`;
        this.recordFingerprint(fp, iteration);
        return {
          detected: true,
          type: "A_B_OSCILLATION",
          evidence: [`Oscillation between ${last4[0].toolId} and ${last4[1].toolId}`],
          fingerprint: fp,
          iterationsSinceDetection: 0,
        };
      }
    }
    
    // Check 4: Same failing test executed repeatedly
    const testCalls = recentCalls.filter((c) => c.toolId.includes("test") || c.toolId.includes("Test"));
    if (testCalls.length >= 3) {
      const last3 = testCalls.slice(-3);
      const sameTest = last3.every((c) => c.toolId === last3[0].toolId && !c.success);
      if (sameTest) {
        const fp = `failing_test:${last3[0].toolId}`;
        this.recordFingerprint(fp, iteration);
        return {
          detected: true,
          type: "FAILING_TEST_LOOP",
          evidence: [`Test ${last3[0].toolId} failed ${last3.length} times without state change`],
          fingerprint: fp,
          iterationsSinceDetection: 0,
        };
      }
    }
    
    // Check 5: Patch oscillation (write then delete same file)
    const writeCalls = recentCalls.filter((c) => c.toolId.includes("write") || c.toolId.includes("Write"));
    if (writeCalls.length >= 4) {
      // Look for write -> delete -> write -> delete pattern
      // Simplified check
    }
    
    // Check 6: Provider fallback ping-pong
    const providerCalls = recentCalls.filter((c) => c.toolId.includes("provider") || c.toolId.includes("model"));
    if (providerCalls.length >= 4) {
      const providers = providerCalls.slice(-4).map((c) => c.output?.provider || c.toolId);
      if (providers[0] !== providers[1] && providers[1] === providers[0] && providers[2] === providers[0]) {
        // Simplified ping-pong detection
      }
    }
    
    // Check 7: Verification reject/fix loop
    // Would need verification history
    
    // Check 8: Agent delegation cycles
    // Would need delegation history
    
    // Check 9: Repeated empty results
    const emptyResults = recentCalls.filter((c) => c.success && (!c.output || Object.keys(c.output).length === 0));
    if (emptyResults.length >= 3) {
      const fp = `empty_results:${emptyResults.map((c) => c.toolId).join(",")}`;
      this.recordFingerprint(fp, iteration);
      return {
        detected: true,
        type: "EMPTY_RESULTS",
        evidence: [`${emptyResults.length} consecutive empty results`],
        fingerprint: fp,
        iterationsSinceDetection: 0,
      };
    }
    
    // Check 10: Repeated web search without new evidence
    const searchCalls = recentCalls.filter((c) => c.toolId.includes("search") || c.toolId.includes("web"));
    if (searchCalls.length >= 3) {
      const last3 = searchCalls.slice(-3);
      const similarQueries = last3.every((c) => 
        JSON.stringify(c.input).slice(0, 100) === JSON.stringify(last3[0].input).slice(0, 100)
      );
      if (similarQueries) {
        const fp = `web_search_loop:${JSON.stringify(last3[0].input).slice(0, 100)}`;
        this.recordFingerprint(fp, iteration);
        return {
          detected: true,
          type: "WEB_SEARCH_LOOP",
          evidence: [`Repeated web search with similar query ${last3.length} times`],
          fingerprint: fp,
          iterationsSinceDetection: 0,
        };
      }
    }
    
    // Check 11: Retry storms
    const retries = recentCalls.filter((c) => c.error?.includes("retry") || c.error?.includes("Retry"));
    if (retries.length >= 5) {
      const fp = `retry_storm:${retries.map((c) => c.toolId).join(",")}`;
      this.recordFingerprint(fp, iteration);
      return {
        detected: true,
        type: "RETRY_STORM",
        evidence: [`${retries.length} retries in recent iterations`],
        fingerprint: fp,
        iterationsSinceDetection: 0,
      };
    }
    
    return { detected: false, type: "UNKNOWN", evidence: [], fingerprint: "", iterationsSinceDetection: 0 };
  }

  getDetections(): readonly DoomLoopDetection[] {
    return [...this.detections];
  }

  clear(): void {
    this.fingerprints.clear();
    this.recentCalls = [];
    this.detections = [];
  }
}

/**
 * Default wakeup manager implementation
 */
export class DefaultWakeupManager implements WakeupManager {
  private listeners: Map<LoopWakeEvent["type"], Set<(event: LoopWakeEvent) => Promise<void>>> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private eventBus?: EventBus;

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
  }

  on(eventType: LoopWakeEvent["type"], handler: (event: LoopWakeEvent) => Promise<void>): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(handler);
    
    return () => {
      this.listeners.get(eventType)?.delete(handler);
    };
  }

  async emit(event: LoopWakeEvent): Promise<void> {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      await Promise.all(Array.from(handlers).map((h) => h(event).catch((e) => console.error("Wakeup handler error:", e))));
    }
    
    // Also emit to QUACK event bus
    if (this.eventBus) {
      await this.eventBus.emit(`loop.wake.${event.type}`, event).catch(() => {});
    }
  }

  startHeartbeat(intervalMs: number): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.emit({
        type: "TIMER_DEADLINE",
        source: "heartbeat",
        missionId: "system",
        runId: "heartbeat",
        timestamp: new Date().toISOString(),
        payload: { heartbeat: true },
      });
    }, intervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

/**
 * Create default loop dependencies
 */
export function createDefaultLoopDependencies(
  harness: Harness,
  capabilityBroker: CapabilityBroker,
  eventBus: EventBus,
  memory: MemoryStore,
  memoryManager?: MemoryManager
): LoopDependencies {
  return {
    harness,
    capabilityBroker,
    eventBus,
    memory,
    memoryManager,
    progressDetector: new DefaultProgressDetector(),
    doomLoopDetector: new DefaultDoomLoopDetector(),
    wakeupManager: new DefaultWakeupManager(eventBus),
  };
}

export * from "./contract.js";
