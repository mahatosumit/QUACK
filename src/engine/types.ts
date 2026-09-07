import { type ToolInvocation } from "../tools/tool.js";
import { type JsonObject as CoreJsonObject, type JsonValue } from "../core/types.js";
export type JsonObject = CoreJsonObject;

// ------------------------------------------------------------------
// Task Graph Types (DAG)
// ------------------------------------------------------------------

export type TaskNodeStatus =
  | "pending" | "ready" | "running" | "completed" | "failed"
  | "skipped" | "cancelled" | "paused" | "retrying";

export type TaskNodePriority = "critical" | "high" | "medium" | "low";

export interface TaskNodeResult {
  readonly success: boolean;
  readonly output?: JsonObject;
  readonly error?: string;
  readonly toolCalls: readonly string[];
  readonly durationMs: number;
}

export interface TaskNodeMetrics {
  readonly executionTimeMs: number;
  readonly retryCount: number;
  readonly toolCalls: number;
  readonly tokenUsage?: JsonObject;
  readonly cost?: number;
}

export interface TaskNode {
  readonly id: string;
  readonly description: string;
  readonly dependencies: readonly string[];
  readonly resources?: readonly string[];
  readonly priority: TaskNodePriority;
  readonly estimatedCost: number;
  readonly estimatedDurationMs: number;
  readonly requiredTools: readonly string[];
  readonly toolInvocations?: readonly ToolInvocation[];
  readonly requiredProviderCapabilities?: readonly string[];
  readonly timeoutMs: number;
  readonly retryPolicy: RetryPolicy;
  readonly conditionalSkip?: { field: string; equals: string };
  readonly status: TaskNodeStatus;
  readonly retryCount: number;
  readonly result?: TaskNodeResult;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface TaskGraph {
  readonly id: string;
  readonly description: string;
  readonly nodes: readonly TaskNode[];
  readonly edges: readonly { from: string; to: string }[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata: JsonObject;
}

// ------------------------------------------------------------------
// Planner Types
// ------------------------------------------------------------------

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskEstimate {
  readonly level: RiskLevel;
  readonly factors: readonly string[];
  readonly mitigation: readonly string[];
}

export interface CostEstimate {
  readonly estimatedTokens: number;
  readonly estimatedCostUsd: number;
  readonly estimatedDurationMs: number;
  readonly confidence: number;
}

export interface Plan {
  readonly id: string;
  readonly goal: string;
  readonly strategy: string;
  readonly taskGraph: TaskGraph;
  readonly riskEstimate: RiskEstimate;
  readonly costEstimate: CostEstimate;
  readonly requiresPermissions: readonly string[];
  readonly contextSummary: string;
  readonly createdAt: string;
}

// ------------------------------------------------------------------
// Workflow Engine Types
// ------------------------------------------------------------------

export type WorkflowStatus =
  | "created" | "running" | "paused" | "completed"
  | "failed" | "cancelled" | "partially_completed";

export type WorkflowLifecycleEvent =
  | "workflow.created"
  | "workflow.started"
  | "workflow.paused"
  | "workflow.resumed"
  | "workflow.completed"
  | "workflow.failed"
  | "workflow.cancelled"
  | "node.queued"
  | "node.ready"
  | "node.started"
  | "node.completed"
  | "node.failed"
  | "node.skipped"
  | "node.retrying"
  | "node.paused"
  | "reflect.started"
  | "reflect.completed"
  | "recovery.started"
  | "recovery.completed"
  | "checkpoint.created"
  | "journal.written";

export interface WorkflowState {
  readonly workflowId: string;
  readonly planId: string;
  readonly sessionId: string;
  status: WorkflowStatus;
  readonly taskGraph: TaskGraph;
  readonly nodeStates: Record<string, TaskNodeStatus>;
  readonly nodeResults: Record<string, TaskNodeResult>;
  readonly readyQueue: readonly string[];
  readonly runningNodes: readonly string[];
  readonly completedNodes: readonly string[];
  readonly failedNodes: readonly string[];
  readonly skippedNodes: readonly string[];
  readonly startTime?: string;
  readonly endTime?: string;
  readonly progress: number;
  errors: string[];
}

// ------------------------------------------------------------------
// Scheduler Types
// ------------------------------------------------------------------

export interface SchedulerConfig {
  readonly maxParallelNodes: number;
  readonly defaultTimeoutMs: number;
  readonly queuePollIntervalMs: number;
}

export interface SchedulerStats {
  readonly queued: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly avgWaitTimeMs: number;
  readonly avgExecutionTimeMs: number;
  readonly throughput: number;
}

// ------------------------------------------------------------------
// Reflection Types
// ------------------------------------------------------------------

export type ReflectionVerdict = "success" | "failure" | "partial" | "needs_retry" | "needs_escalation";

export interface ReflectionResult {
  readonly nodeId: string;
  readonly verdict: ReflectionVerdict;
  readonly objectiveAchieved: boolean;
  readonly validationPassed: boolean;
  readonly requiresRetry: boolean;
  readonly requiresEscalation: boolean;
  readonly requiresMoreContext: boolean;
  readonly observations: readonly string[];
  readonly lessons: readonly string[];
  readonly recommendations: readonly string[];
  readonly alternativeStrategy?: string;
  readonly memoryUpdates: readonly string[];
  readonly confidence: number;
  readonly durationMs: number;
}

// ------------------------------------------------------------------
// Recovery Types
// ------------------------------------------------------------------

export type RecoveryAction =
  | "retry"
  | "retry_different_tool"
  | "retry_different_provider"
  | "rollback"
  | "skip"
  | "escalate"
  | "abort";

export type BackoffStrategy = "fixed" | "linear" | "exponential" | "jitter";

export interface RetryPolicy {
  readonly maxRetries: number;
  readonly backoff: BackoffStrategy;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export interface RecoveryPlan {
  readonly action: RecoveryAction;
  readonly reason: string;
  readonly retryCount: number;
  readonly backoffDelayMs: number;
  readonly alternateToolId?: string;
  readonly alternateProviderId?: string;
  readonly rollbackNodeIds: readonly string[];
  readonly escalationMessage?: string;
}

export interface RecoveryResult {
  readonly success: boolean;
  readonly action: RecoveryAction;
  readonly attempts: number;
  readonly totalDurationMs: number;
  readonly finalError?: string;
}

// ------------------------------------------------------------------
// Checkpoint Types
// ------------------------------------------------------------------

export interface Checkpoint {
  readonly recovery?: import("./execution-recovery.js").ExecutionRecovery;
  readonly id: string;
  readonly workflowId: string;
  readonly sessionId: string;
  readonly planId: string;
  readonly timestamp: string;
  readonly workflowState: WorkflowState;
  readonly nodeResults: Record<string, TaskNodeResult>;
  readonly journalSinceLastCheckpoint: readonly JournalEntry[];
  readonly memorySnapshot?: JsonObject;
  readonly metadata: JsonObject;
}

export interface CheckpointStore {
  save(checkpoint: Checkpoint): Promise<void>;
  load(id: string): Promise<Checkpoint | undefined>;
  list(workflowId: string): Promise<Checkpoint[]>;
  delete(id: string): Promise<boolean>;
  prune(workflowId: string, keep: number): Promise<number>;
}

// ------------------------------------------------------------------
// Execution Journal Types
// ------------------------------------------------------------------

export type JournalEntryType =
  | "plan.created"
  | "graph.built"
  | "workflow.started"
  | "workflow.completed"
  | "node.started"
  | "node.completed"
  | "node.failed"
  | "node.skipped"
  | "tool.invoked"
  | "tool.completed"
  | "provider.selected"
  | "provider.invoked"
  | "provider.completed"
  | "file.modified"
  | "validation.passed"
  | "validation.failed"
  | "test.passed"
  | "test.failed"
  | "reflection.completed"
  | "recovery.started"
  | "recovery.completed"
  | "checkpoint.created"
  | "session.paused"
  | "session.resumed";

export interface JournalEntry {
  readonly id: string;
  readonly workflowId: string;
  readonly sessionId: string;
  readonly type: JournalEntryType;
  readonly timestamp: string;
  readonly nodeId?: string;
  readonly data: JsonObject;
  readonly durationMs?: number;
  readonly error?: string;
}

export interface JournalStore {
  append(entry: JournalEntry): Promise<void>;
  query(options: { workflowId?: string; sessionId?: string; type?: JournalEntryType; limit?: number; offset?: number }): Promise<JournalEntry[]>;
  replay(workflowId: string): Promise<JournalEntry[]>;
  stats(workflowId: string): Promise<{ total: number; byType: Record<string, number>; duration: number; errorCount: number }>;
}

// ------------------------------------------------------------------
// Cost & Provider Optimizer Types
// ------------------------------------------------------------------

export interface ProviderCapabilityProfile {
  readonly providerId: string;
  readonly modelId: string;
  readonly costPer1kInputTokens: number;
  readonly costPer1kOutputTokens: number;
  readonly contextWindow: number;
  readonly supportsTools: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly reasoningScore: number;
  readonly latencyP50Ms: number;
  readonly latencyP99Ms: number;
  readonly isLocal: boolean;
}

export type RoutingPolicy = "cost_first" | "fastest_first" | "capability_first" | "local_first" | "balanced";

export interface RoutingDecision {
  readonly providerId: string;
  readonly modelId: string;
  readonly estimatedCost: number;
  readonly estimatedLatencyMs: number;
  readonly reason: string;
}

// ------------------------------------------------------------------
// Session Types
// ------------------------------------------------------------------

export type SessionStatus = "idle" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface SessionRuntimeConfig {
  readonly storageDir?: string;
  readonly maxActiveSessions: number;
  readonly snapshotRetentionCount: number;
  readonly autoSnapshotIntervalMs: number;
}

export interface SessionState {
  readonly sessionId: string;
  status: SessionStatus;
  planId: string;
  readonly workflowIds: readonly string[];
  currentWorkflowId?: string;
  readonly createdAt: string;
  updatedAt: string;
  readonly metadata: Record<string, string>;
}

export interface SessionSnapshot {
  readonly sessionId: string;
  readonly timestamp: string;
  status: SessionStatus;
  planId: string;
  readonly workflowIds: readonly string[];
  currentWorkflowId?: string;
}

// ------------------------------------------------------------------
// Engine Facade Config
// ------------------------------------------------------------------

export interface EngineConfig {
  readonly workspaceRoot: string;
  readonly dataDir: string;
  readonly scheduler: SchedulerConfig;
  readonly defaultRetryPolicy: RetryPolicy;
  readonly defaultTimeoutMs: number;
  readonly maxCheckpointsPerWorkflow: number;
  readonly routingPolicy: RoutingPolicy;
}
