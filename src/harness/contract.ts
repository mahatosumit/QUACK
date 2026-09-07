/**
 * QUACK Harness Contract v2
 * 
 * A Harness is the runtime driving an agent. Examples:
 * - QUACK Native
 * - Codex
 * - OpenCode
 * - Claude Code
 * - Hermes
 * - PraisonAI
 * - DeepSeek Harness
 * - future ACP agent
 * - future CLI agent
 * - future HTTP agent
 * 
 * A Harness is NOT a model provider.
 * 
 * Normalized interface that all harness implementations must satisfy.
 */

import { type JsonObject, type JsonValue, type IsoTimestamp } from "../core/types.js";
import { type CapabilityDecision } from "../security/capability-broker.js";

/** Harness capability levels */
export type CapabilitySupport = 
  | "NATIVE"      // Fully supported with all features
  | "EMULATED"    // Supported via emulation/adaptation layer
  | "DEGRADED"    // Partially supported with known limitations
  | "UNSUPPORTED"; // Not supported at all

/** Harness capability categories */
export interface HarnessCapabilities {
  /** Tool execution support */
  readonly tools: CapabilitySupport;
  /** MCP server support */
  readonly mcp: CapabilitySupport;
  /** Subagent/delegation support */
  readonly subagents: CapabilitySupport;
  /** Continuable subagents (durable identity + cold resume) */
  readonly continuableSubagents: CapabilitySupport;
  /** Streaming responses */
  readonly streaming: CapabilitySupport;
  /** Structured output (JSON schema enforcement) */
  readonly structuredOutput: CapabilitySupport;
  /** Checkpoint/resume support */
  readonly checkpoint: CapabilitySupport;
  readonly resume: CapabilitySupport;
  /** Interrupt/cancel support */
  readonly interrupt: CapabilitySupport;
  /** Workspace isolation */
  readonly workspace: CapabilitySupport;
  /** Isolated environment (sandbox/container) */
  readonly isolatedEnvironment: CapabilitySupport;
  /** Background job support */
  readonly backgroundJobs: CapabilitySupport;
  /** Human approval gates */
  readonly humanApproval: CapabilitySupport;
}

/** Harness health status */
export type HarnessHealth = "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "UNKNOWN";

/** Harness metadata */
export interface HarnessMetadata {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly vendor: string;
  readonly homepage?: string;
  readonly repository?: string;
  readonly license: string;
  readonly capabilities: HarnessCapabilities;
  /** Minimum QUACK version required */
  readonly minQuackVersion: string;
  /** Supported platforms */
  readonly platforms: readonly ("win32" | "linux" | "darwin")[];
  /** Required environment variables */
  readonly requiredEnvVars: readonly string[];
  /** Optional environment variables */
  readonly optionalEnvVars: readonly string[];
}

/** Harness certification levels */
export type HarnessCertification = 
  | "H0_DETECTED"       // Harness detected but not tested
  | "H1_BASIC"          // Can execute one task
  | "H2_TOOLS"          // Tools and structured results verified
  | "H3_CONTROL"        // Cancel/timeout/error handling verified
  | "H4_DURABLE"        // Checkpoint/resume/recovery verified
  | "H5_SUBAGENTS"      // Delegation + lineage verified
  | "H6_PRODUCTION_CERTIFIED"; // All required private-production contract gates passed

/** Harness runtime status */
export interface HarnessStatus {
  readonly id: string;
  readonly health: HarnessHealth;
  readonly certification: HarnessCertification;
  readonly lastHealthCheck: IsoTimestamp;
  readonly lastSuccessfulMission?: IsoTimestamp;
  readonly lastError?: string;
  readonly activeExecutions: number;
  readonly uptimeMs: number;
}

/** Harness configuration */
export interface HarnessConfig {
  readonly harnessId: string;
  readonly workingDirectory?: string;
  readonly environment?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly maxTokens?: number;
  readonly maxCostUsd?: number;
  readonly customOptions?: JsonObject;
}

/** Execution context for harness operations */
export interface HarnessExecutionContext {
  readonly missionId: string;
  readonly runId: string;
  readonly iterationId: string;
  readonly actor: string;
  readonly signal?: AbortSignal;
  readonly deadline?: IsoTimestamp;
  readonly workspaceRoot: string;
  readonly dataDir: string;
  readonly capabilities: readonly string[];
  readonly trustClass: "SYSTEM" | "OWNER" | "TRUSTED_TOOL" | "PROJECT_FILE" | "KNOWLEDGE" | "SUBAGENT" | "UNTRUSTED_WEB" | "UNTRUSTED_EXTERNAL";
}

/** Task input for harness execution */
export interface HarnessTaskInput {
  readonly goal: string;
  /** Exact invocations supplied by the execution plan; capability names are not tool arguments. */
  readonly toolInvocations?: readonly {
    readonly toolId: string;
    readonly input: JsonObject;
    readonly reason?: string;
  }[];
  readonly context?: JsonObject;
  readonly requiredCapabilities?: readonly string[];
  readonly constraints?: JsonObject;
  readonly metadata?: JsonObject;
}

/** Task output from harness execution */
export interface HarnessTaskOutput {
  readonly success: boolean;
  readonly result?: JsonObject;
  readonly error?: string;
  readonly evidence: readonly HarnessEvidence[];
  readonly metrics: HarnessExecutionMetrics;
  readonly artifacts: readonly HarnessArtifact[];
}

/** Evidence produced during execution */
export interface HarnessEvidence {
  readonly id: string;
  readonly type: "tool_result" | "file_content" | "web_content" | "subagent_report" | "verification" | "observation";
  readonly source: string;
  readonly trustClass: "SYSTEM" | "OWNER" | "TRUSTED_TOOL" | "PROJECT_FILE" | "KNOWLEDGE" | "SUBAGENT" | "UNTRUSTED_WEB" | "UNTRUSTED_EXTERNAL";
  readonly timestamp: IsoTimestamp;
  readonly missionId: string;
  readonly agentId: string;
  readonly content: JsonObject;
  readonly references: readonly string[];
}

/** Artifact produced during execution */
export interface HarnessArtifact {
  readonly id: string;
  readonly type: "file" | "code" | "document" | "test" | "report" | "log" | "binary";
  readonly path: string;
  readonly contentType: string;
  readonly size: number;
  readonly checksum: string;
  readonly createdAt: IsoTimestamp;
  readonly metadata?: JsonObject;
}

/** Execution metrics */
export interface HarnessExecutionMetrics {
  readonly durationMs: number;
  readonly tokensUsed: { input: number; output: number; total: number };
  readonly costUsd: number;
  readonly toolCalls: number;
  readonly subagentSpawns: number;
  readonly retries: number;
  readonly checkpointCount: number;
  readonly modelCalls: number;
}

/** Checkpoint data */
export interface HarnessCheckpoint {
  readonly id: string;
  readonly missionId: string;
  readonly runId: string;
  readonly createdAt: IsoTimestamp;
  readonly state: JsonObject;
  readonly taskStates: JsonObject;
  readonly agentDescriptors: JsonObject;
  readonly dependencies: JsonObject;
  readonly budgetsConsumed: JsonObject;
  readonly artifactRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly knowledgeRefs: readonly string[];
  readonly providerDecisions: JsonObject;
  readonly workflowPosition: JsonObject;
}

/** Subagent spawn options */
export interface SubagentSpawnOptions {
  readonly taskId: string;
  readonly goal: string;
  readonly role: string;
  readonly capabilities: readonly string[];
  readonly allowedTools: readonly string[];
  readonly deniedTools: readonly string[];
  readonly persona?: string;
  readonly depth: number;
  readonly maxDepth: number;
  readonly parentId: string;
  readonly missionId: string;
  readonly continuation?: "ONE_SHOT" | "CONTINUABLE";
  readonly structuredOutputSchema?: JsonObject;
  readonly workspaceRoot?: string;
  readonly isolatedEnvironment?: boolean;
}

/** Subagent report */
export interface SubagentReport {
  readonly childId: string;
  readonly parentId: string;
  readonly taskId: string;
  readonly status: "COMPLETED" | "FAILED" | "CANCELLED" | "BLOCKED";
  readonly summary: string;
  readonly findings: readonly JsonObject[];
  readonly artifacts: readonly HarnessArtifact[];
  readonly evidence: readonly HarnessEvidence[];
  readonly confidence: number;
  readonly blockers: readonly string[];
  readonly deliveryMode: "QUIET" | "WAKE_PARENT";
  readonly completedAt: IsoTimestamp;
}

/** Background job interface */
export interface BackgroundJob {
  readonly id: string;
  readonly missionId: string;
  readonly agentId: string;
  readonly type: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  readonly environment: Record<string, string>;
  readonly resourceLimits: {
    readonly maxMemoryMb?: number;
    readonly maxCpuPercent?: number;
    readonly maxDurationMs?: number;
    readonly maxOutputMb?: number;
  };
}

export interface BackgroundJobStatus {
  readonly id: string;
  readonly state: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly startedAt?: IsoTimestamp;
  readonly completedAt?: IsoTimestamp;
  readonly error?: string;
}

/** Main Harness Interface */
export interface Harness {
  /** Get harness metadata */
  metadata(): HarnessMetadata;
  
  /** Check harness health */
  health(): Promise<HarnessHealth>;
  
  /** Get detailed status */
  status(): Promise<HarnessStatus>;
  
  /** Get current capabilities */
  capabilities(): HarnessCapabilities;
  
  /** Get certification level */
  certification(): HarnessCertification;
  
  /** Start the harness */
  start(config: HarnessConfig): Promise<void>;
  
  /** Send a task to the harness */
  send(input: HarnessTaskInput, context: HarnessExecutionContext): Promise<HarnessTaskOutput>;
  
  /** Stream a task (for streaming-capable harnesses) */
  stream(input: HarnessTaskInput, context: HarnessExecutionContext): AsyncIterable<HarnessTaskOutput>;
  
  /** Create a checkpoint */
  checkpoint(missionId: string, runId: string): Promise<HarnessCheckpoint>;
  
  /** Resume from checkpoint */
  resume(checkpoint: HarnessCheckpoint): Promise<void>;
  
  /** Pause execution */
  pause(missionId: string): Promise<void>;
  
  /** Cancel execution */
  cancel(missionId: string, runId?: string): Promise<void>;
  
  /** Interrupt current operation */
  interrupt(missionId: string, runId: string): Promise<void>;
  
  /** Get execution status */
  getStatus(missionId: string, runId?: string): Promise<HarnessTaskOutput | undefined>;
  
  /** Spawn a subagent */
  spawnSubagent(options: SubagentSpawnOptions): Promise<SubagentReport>;
  
  /** Start a background job */
  startBackgroundJob(job: BackgroundJob): Promise<string>;
  
  /** Get background job status */
  getBackgroundJobStatus(jobId: string): Promise<BackgroundJobStatus>;
  
  /** Cancel background job */
  cancelBackgroundJob(jobId: string): Promise<void>;
  
  /** Wait for background job completion */
  waitBackgroundJob(jobId: string): Promise<BackgroundJobStatus>;
  
  /** Stream background job output */
  streamBackgroundJobOutput(jobId: string): AsyncIterable<{ stdout: string; stderr: string }>;
  
  /** Shutdown the harness */
  shutdown(): Promise<void>;
  
  /** Dispose/cleanup (mandatory) */
  dispose(): Promise<void>;
}

/** Harness Provider Registry Entry */
export interface HarnessProviderEntry {
  readonly id: string;
  readonly factory: HarnessFactory;
  readonly metadata: HarnessMetadata;
  readonly healthCheck: () => Promise<HarnessHealth>;
  readonly certification: HarnessCertification;
  readonly priority: number;
  readonly tags: readonly string[];
}

/** Harness factory function */
export type HarnessFactory = (config: HarnessConfig) => Promise<Harness>;

/** Harness selection criteria */
export interface HarnessSelectionCriteria {
  readonly taskType?: string;
  readonly requiredTools?: readonly string[];
  readonly requiredCapabilities?: readonly (keyof HarnessCapabilities)[];
  readonly subagentCapability?: boolean;
  readonly workspaceNeeds?: "isolated" | "shared" | "none";
  readonly checkpointResumeNeeds?: boolean;
  readonly securityLevel?: "high" | "medium" | "low";
  readonly healthRequirement?: HarnessHealth;
  readonly historicalPerformance?: { harnessId: string; score: number }[];
  readonly ownerPreference?: string;
  readonly costLimit?: number;
  readonly availabilityRequirement?: boolean;
}

/** Harness selection result */
export interface HarnessSelectionResult {
  readonly harnessId: string;
  readonly reason: string;
  readonly alternatives: readonly { harnessId: string; reason: string }[];
}

/** Harness Registry Interface */
export interface HarnessRegistry {
  /** Register a harness provider */
  register(entry: HarnessProviderEntry): void;
  
  /** Unregister a harness provider */
  unregister(harnessId: string): boolean;
  
  /** Get a harness by ID */
  get(harnessId: string): HarnessProviderEntry | undefined;
  
  /** List all registered harnesses */
  list(): readonly HarnessProviderEntry[];
  
  /** Select best harness for criteria */
  select(criteria: HarnessSelectionCriteria): HarnessSelectionResult;
  
  /** Get harness health */
  getHealth(harnessId: string): Promise<HarnessHealth>;
  
  /** Run health checks on all harnesses */
  checkAllHealth(): Promise<Map<string, HarnessHealth>>;
  
  /** Run certification tests */
  certify(harnessId: string, level: HarnessCertification): Promise<boolean>;
  
  /** Get certification level */
  getCertification(harnessId: string): HarnessCertification;
}

export * from "./types.js";
