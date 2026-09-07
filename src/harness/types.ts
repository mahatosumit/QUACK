import { type JsonObject, type JsonValue } from "../core/types.js";

export interface MissionTraceInput {
  readonly missionId?: string;
  readonly goal: string;
  readonly actor?: string;
  readonly metadata?: JsonObject;
}

export interface MissionTraceEvent {
  readonly type: string;
  readonly timestamp: string;
  readonly actor: string;
  readonly taskId?: string;
  readonly payload: JsonObject;
}

export interface MissionTracePlan {
  readonly planId: string;
  readonly goal: string;
  readonly strategy: string;
  readonly requiredPermissions: readonly string[];
  readonly nodeCount: number;
  readonly toolInvocations: readonly {
    readonly nodeId: string;
    readonly toolId: string;
    readonly input: JsonObject;
    readonly reason?: string;
  }[];
}

export interface MissionTraceSkillSelection {
  readonly skillId: string;
  readonly version?: string;
  readonly reason?: string;
  readonly confidence?: number;
}

export interface MissionTraceCapability {
  readonly eventType: string;
  readonly requestId?: string;
  readonly missionId?: string;
  readonly capability: string;
  readonly resource: JsonObject | null;
  readonly decision?: "allowed" | "denied" | "checked" | "requested";
  readonly timestamp: string;
  readonly reason?: string;
}

export interface MissionTraceToolExecution {
  readonly iteration?: number;
  readonly toolId: string;
  readonly input: JsonObject;
  readonly success: boolean;
  readonly output?: JsonObject;
  readonly error?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface MissionTraceVerification {
  readonly iteration: number;
  readonly success: boolean;
  readonly reason: string;
}

export interface MissionTraceIteration {
  readonly index: number;
  readonly observation: string;
  readonly selectedAction?: {
    readonly nodeId: string;
    readonly description: string;
    readonly requiredTools: readonly string[];
  };
  readonly toolCalls: readonly MissionTraceToolExecution[];
  readonly executionSucceeded: boolean;
  readonly verification: MissionTraceVerification;
  readonly reflectionSummary: string;
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface MissionTraceOutcome {
  readonly success: boolean;
  readonly state: string;
  readonly error?: string;
  readonly latencyMs: number;
}

export interface MissionTrace {
  readonly id: string;
  readonly missionInput: MissionTraceInput;
  readonly plansGenerated: readonly MissionTracePlan[];
  readonly skillsSelected: readonly MissionTraceSkillSelection[];
  readonly capabilitiesRequested: readonly MissionTraceCapability[];
  readonly toolsExecuted: readonly MissionTraceToolExecution[];
  readonly verificationResults: readonly MissionTraceVerification[];
  readonly iterations: readonly MissionTraceIteration[];
  readonly finalOutcome: MissionTraceOutcome;
  readonly events: readonly MissionTraceEvent[];
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface HarnessMetrics {
  readonly taskSuccessRate: number;
  readonly toolFailureRate: number;
  readonly capabilityViolations: number;
  readonly recoveryAttempts: number;
  readonly executionLatencyMs: number;
  readonly iterationCount: number;
  readonly toolCallCount: number;
  readonly capabilityCheckCount: number;
}

export interface MissionEvaluationFailure {
  readonly code: string;
  readonly message: string;
  readonly severity: "low" | "medium" | "high";
  readonly context?: JsonObject;
}

export interface MissionEvaluationResult {
  readonly success: boolean;
  readonly score: number;
  readonly failures: readonly MissionEvaluationFailure[];
  readonly improvements: readonly string[];
  readonly metrics: HarnessMetrics;
}

export interface ReplaySignature {
  readonly goal: string;
  readonly planStrategies: readonly string[];
  readonly selectedActions: readonly string[];
  readonly tools: readonly string[];
  readonly verification: readonly boolean[];
  readonly outcome: string;
}

export interface ReplayMismatch {
  readonly field: keyof ReplaySignature;
  readonly expected: JsonValue;
  readonly actual: JsonValue;
}

export interface ReplayResult {
  readonly success: boolean;
  readonly matched: boolean;
  readonly expected: ReplaySignature;
  readonly actual: ReplaySignature;
  readonly mismatches: readonly ReplayMismatch[];
}

export interface BenchmarkScenario {
  readonly id: string;
  readonly name: string;
  readonly missionInput: MissionTraceInput;
  readonly expectedTools: readonly string[];
  readonly expectedCapabilities: readonly string[];
  readonly expectedOutcome: "success" | "failure";
  readonly tags: readonly string[];
}
