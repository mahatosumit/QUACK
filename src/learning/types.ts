/**
 * Experience Store - First-class persistent storage for verified mission experiences
 * 
 * Separates four types of memory:
 * - EPISODIC: What happened (historical fact)
 * - SEMANTIC: What we know (derived verified facts)
 * - PROCEDURAL: How to perform work (reusable procedures)
 * - PERFORMANCE: What tends to work best (aggregated metrics)
 */

import { createId, now, type IsoTimestamp, type JsonObject, type JsonValue } from "../core/types.js";

export type ExperienceOutcome = "VERIFIED_SUCCESS" | "VERIFIED_FAILURE" | "PARTIAL" | "UNVERIFIED";
export type ExperienceClassification = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "LOCAL_ONLY";

export interface ExperienceRecord {
  readonly experienceId: string;
  readonly companyId: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly role: string;
  readonly taskType: string;
  readonly outcome: ExperienceOutcome;
  readonly harness: string;
  readonly provider: string;
  readonly model: string;
  readonly skills: readonly string[];
  readonly environment: {
    readonly os: string;
    readonly cpu: string;
    readonly ramGb: number;
    readonly gpu: string;
    readonly vramGb: number;
  };
  readonly toolsUsed: readonly string[];
  readonly attempts: number;
  readonly retries: number;
  readonly durationMs: number;
  readonly tokens: { readonly input: number; readonly output: number; readonly total: number };
  readonly costUsd: number;
  readonly errors: readonly string[];
  readonly artifacts: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly verification: { readonly passed: boolean; readonly verifier: string; readonly reason: string };
  readonly lessons: readonly string[];
  readonly classification: ExperienceClassification;
  readonly timestamp: IsoTimestamp;
}

export interface SemanticKnowledge {
  readonly knowledgeId: string;
  readonly fact: string;
  readonly sourceExperienceIds: readonly string[];
  readonly supportingEvidence: readonly string[];
  readonly confidence: number;
  readonly domain: string;
  readonly tags: readonly string[];
  readonly createdAt: IsoTimestamp;
  readonly lastConfirmedAt: IsoTimestamp;
  readonly version: number;
  readonly supersededBy?: string;
  readonly retired: boolean;
}

export interface ProceduralKnowledge {
  readonly procedureId: string;
  readonly name: string;
  readonly version: number;
  readonly steps: readonly ProcedureStep[];
  readonly applicableContexts: readonly string[];
  readonly sourceExperienceIds: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly confidence: number;
  readonly trustLevel: "BUILTIN_VERIFIED" | "LOCALLY_VERIFIED" | "IMPORTED_REVIEWED" | "IMPORTED_UNVERIFIED";
  readonly createdAt: IsoTimestamp;
  readonly lastConfirmedAt: IsoTimestamp;
  readonly supersededBy?: string;
  readonly retired: boolean;
}

export interface ProcedureStep {
  readonly stepId: string;
  readonly description: string;
  readonly tool?: string;
  readonly expectedOutcome: string;
  readonly verification?: string;
  readonly fallback?: string;
}

export interface PerformanceMetrics {
  readonly metricId: string;
  readonly dimension: "taskType" | "agentRole" | "skill" | "harness" | "provider" | "model" | "environment" | "workflow";
  readonly dimensionValue: string;
  readonly missions: number;
  readonly verifiedSuccess: number;
  readonly verifiedFailure: number;
  readonly verifierPassRate: number;
  readonly avgRetries: number;
  readonly avgDurationMs: number;
  readonly avgTokens: number;
  readonly avgCostUsd: number;
  readonly lastUpdated: IsoTimestamp;
}

export interface FailurePattern {
  readonly patternId: string;
  readonly signature: string;
  readonly fingerprints: readonly string[];
  readonly environments: readonly string[];
  readonly causes: readonly string[];
  readonly successfulMitigations: readonly string[];
  readonly failedMitigations: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly confidence: number;
  readonly occurrences: number;
  readonly firstSeen: IsoTimestamp;
  readonly lastSeen: IsoTimestamp;
}

export interface CandidateLesson {
  readonly lessonId: string;
  readonly claim: string;
  readonly type: "SEMANTIC" | "PROCEDURAL" | "FAILURE_PATTERN" | "ROUTING" | "SKILL" | "PLANNER" | "TEAM";
  readonly supportingExperienceIds: readonly string[];
  readonly contradictingExperienceIds: readonly string[];
  readonly supportCount: number;
  readonly contradictionCount: number;
  readonly confidence: "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  readonly scope: string;
  readonly applicableVersions: readonly string[];
  readonly createdAt: IsoTimestamp;
  readonly lastConfirmedAt: IsoTimestamp;
  readonly status: "CANDIDATE" | "VERIFIED" | "WEAKENED" | "CONTRADICTED" | "SUPERSEDED" | "RETIRED";
  readonly evidenceRefs: readonly string[];
}

export interface LearningCheckpoint {
  readonly checkpointId: string;
  readonly lastProcessedEventId: string;
  readonly lastProcessedExperienceId: string;
  readonly lastLearningTimestamp: IsoTimestamp;
  readonly learningVersion: string;
  readonly experiencesProcessed: number;
  readonly lessonsCreated: number;
  readonly lessonsVerified: number;
  readonly lessonsContradicted: number;
  readonly failuresIdentified: number;
}

export interface DailyLearningReport {
  readonly reportId: string;
  readonly date: IsoTimestamp;
  readonly newExperiencesProcessed: number;
  readonly verifiedSuccesses: number;
  readonly verifiedFailures: number;
  readonly partialUnverified: number;
  readonly newLessons: number;
  readonly confirmedLessons: number;
  readonly contradictions: number;
  readonly supersededLessons: number;
  readonly newFailurePatterns: number;
  readonly skillObservations: readonly SkillObservation[];
  readonly harnessObservations: readonly HarnessObservation[];
  readonly modelObservations: readonly ModelObservation[];
  readonly plannerObservations: readonly PlannerObservation[];
  readonly recommendationsRequiringApproval: readonly string[];
  readonly learningCheckpoint: LearningCheckpoint;
  readonly costUsd: number;
  readonly durationMs: number;
}

export interface SkillObservation {
  readonly skillId: string;
  readonly skillVersion: string;
  readonly selectionCount: number;
  readonly verifiedSuccesses: number;
  readonly verifiedFailures: number;
  readonly verifierPassRate: number;
  readonly avgRetries: number;
  readonly avgDurationMs: number;
  readonly avgCostUsd: number;
  readonly lesson?: string;
}

export interface HarnessObservation {
  readonly harness: string;
  readonly taskType: string;
  readonly missions: number;
  readonly verifiedSuccesses: number;
  readonly verifierPassRate: number;
  readonly avgRetries: number;
  readonly avgDurationMs: number;
  readonly avgCostUsd: number;
}

export interface ModelObservation {
  readonly provider: string;
  readonly model: string;
  readonly taskType: string;
  readonly missions: number;
  readonly verifiedSuccesses: number;
  readonly verifierPassRate: number;
  readonly avgRetries: number;
  readonly avgLatencyMs: number;
  readonly avgTokens: number;
  readonly avgCostUsd: number;
}

export interface PlannerObservation {
  readonly taskType: string;
  readonly recommendedTeamSize: number;
  readonly recommendedRoles: readonly string[];
  readonly missionsWithThisStructure: number;
  readonly verifierPassRate: number;
  readonly avgDurationMs: number;
  readonly avgTokens: number;
}

export interface ExperienceStoreConfig {
  readonly storagePath: string;
  readonly retentionDays: number;
  readonly maxRawTraces: number;
  readonly compressionEnabled: boolean;
}

export interface ExperienceQuery {
  readonly outcome?: ExperienceOutcome;
  readonly taskType?: string;
  readonly harness?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly projectId?: string;
  readonly agentId?: string;
  readonly dateFrom?: IsoTimestamp;
  readonly dateTo?: IsoTimestamp;
  readonly limit?: number;
  readonly classification?: ExperienceClassification;
}

export interface SimilarExperienceQuery {
  readonly taskType?: string;
  readonly goal?: string;
  readonly outcome?: ExperienceOutcome;
  readonly harness?: string;
  readonly provider?: string;
  readonly limit?: number;
  readonly minConfidence?: number;
}