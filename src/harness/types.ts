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
  /** P8.6: metadata-only governed-instruction dispatch records (absent when the mission used no QIE dispatch). */
  readonly instruction?: readonly import("../instruction/records.js").GovernedInstructionRecord[];
  /**
   * P9.21: metadata-only semantic-memory evaluation evidence (absent when
   * the mission used no semantic memory). Trace-attached like P8.6 records;
   * never memory content.
   */
  readonly semanticMemory?: import("../memory/semantic/evaluation.js").MemoryEvaluationEvidence;
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
  /** P5: denied capability requests that were later recovered from (degraded, not abandoned). */
  readonly recoveredDenials: number;
  /** P5: evidence records captured per successful tool call (evidence quality input). */
  readonly evidenceCoverage: number;
  /** P8.6: total governed-instruction dispatch attempts (metadata-only records). */
  readonly instructionDispatchCount: number;
  /** P8.6: dispatch attempts that passed defense + adaptation and were sent to the governed runtime. */
  readonly instructionDispatchedCount: number;
  /** P8.6: dispatch attempts fail-closed at the defense/adaptation boundary. */
  readonly instructionRejectedCount: number;
  /** P8.6: metadata-only injection flags across all dispatch attempts (defense-in-depth signal). */
  readonly instructionInjectionFlagCount: number;
  /** P9.21: semantic-memory records observed for the mission (0 when none). */
  readonly semanticMemoryRecordCount: number;
  /** P9.21: semantic-memory retrieval observations (0 when none). */
  readonly semanticMemoryRetrievalCount: number;
  /** P9.21: semantic-memory deletions observed (0 when none). */
  readonly semanticMemoryDeletionCount: number;
}

/** P5: per-dimension agent evaluation scores (0–100, higher is better). */
export interface EvaluationDimensions {
  readonly capabilityDiscipline: number;
  readonly recovery: number;
  readonly planning: number;
  readonly evidenceQuality: number;
  /** P8.6: instruction quality dimensions; absent when the mission used no QIE dispatch. */
  readonly instruction?: import("../instruction/evaluator.js").InstructionQualityDimensions;
  /** P9.21: semantic-memory quality dimensions; absent when the mission used no semantic memory. */
  readonly memory?: import("../memory/semantic/evaluation.js").MemoryQualityDimensions;
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
  /** P5: per-dimension agent evaluation scores (present in every result). */
  readonly dimensions: EvaluationDimensions;
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
  /** P5: scenario family classification for eval reporting. */
  readonly family?: "reasoning" | "tool-selection" | "capability" | "adversarial" | "recovery" | "multi-step" | "evidence";
  /**
   * P5: adversarial expectations — an adversarial scenario passes when the
   * runtime FAILS CLOSED (does not act on the hostile payload). Omitted on
   * ordinary scenarios.
   */
  readonly adversarial?: {
    readonly injection?: string;
    readonly secretLeak?: string;
    readonly deniedCapabilityExpected?: boolean;
    readonly networkDeniedExpected?: boolean;
    readonly forgedIdentityExpected?: boolean;
  };
}
