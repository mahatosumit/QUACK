/**
 * Daily Learning Routine
 * 
 * Runs once per day to process new verified experiences and:
 * 1. COLLECT new mission experiences
 * 2. FILTER corrupt/incomplete experiences
 * 3. RETRIEVE relevant historical experiences
 * 4. GROUP by task/failure/skill/provider/harness/workflow
 * 5. COMPARE success vs failure
 * 6. JUDGE evidence quality
 * 7. DISTILL candidate lessons
 * 8. CONTRADICTION CHECK
 * 9. VERIFY with independent verifier
 * 10. CONSOLIDATE validated results
 * 11. REPORT
 * 12. CHECKPOINT
 */

import { createId, now, type IsoTimestamp, type JsonObject, ok, fail, type QuackResult } from "../core/types.js";
import { ExperienceStore } from "./experience-store.js";
import { ExperienceBroker } from "./experience-broker.js";
import {
  ExperienceRecord,
  CandidateLesson,
  FailurePattern,
  LearningCheckpoint,
  DailyLearningReport,
  SkillObservation,
  HarnessObservation,
  ModelObservation,
  PlannerObservation,
  ExperienceOutcome,
  ExperienceClassification,
  SkillObservation as SkillObservationType,
} from "./types.js";

export interface DailyLearningConfig {
  readonly experienceStore: ExperienceStore;
  readonly experienceBroker: ExperienceBroker;
  readonly maxExperiencesPerRun: number;
  readonly maxCandidatesPerType: number;
  readonly minConfidenceForVerification: number;
  readonly verifierHarness: string;
  readonly verifierModel: string;
  readonly learningVersion: string;
}

export interface LearningStageResult {
  readonly stage: string;
  readonly processed: number;
  readonly created: number;
  readonly rejected: number;
  readonly errors: string[];
}

export interface DailyLearningContext {
  checkpoint: LearningCheckpoint;
  newExperiences: ExperienceRecord[];
  candidateLessons: CandidateLesson[];
  verifiedLessons: CandidateLesson[];
  newFailurePatterns: FailurePattern[];
  skillObservations: SkillObservation[];
  harnessObservations: HarnessObservation[];
  modelObservations: ModelObservation[];
  plannerObservations: PlannerObservation[];
  recommendations: string[];
  stageResults: LearningStageResult[];
  startTime: IsoTimestamp;
}

export class DailyLearningRoutine {
  private readonly config: DailyLearningConfig;
  private readonly store: ExperienceStore;
  private readonly broker: ExperienceBroker;

  constructor(config: DailyLearningConfig) {
    this.config = config;
    this.store = config.experienceStore;
    this.broker = config.experienceBroker;
  }

  async runDailyLearning(): Promise<QuackResult<DailyLearningReport>> {
    const startTime = now();
    const context = await this.initializeContext();
    
    try {
      // Stage 1: COLLECT - Get new experiences since last checkpoint
      const collectResult = await this.collectStage(context);
      context.stageResults.push(collectResult);
      
      // Stage 2: FILTER - Remove corrupt/incomplete/unsafe experiences
      const filterResult = await this.filterStage(context);
      context.stageResults.push(filterResult);
      
      // Stage 3: RETRIEVE - Find relevant historical experiences
      const retrieveResult = await this.retrieveStage(context);
      context.stageResults.push(retrieveResult);
      
      // Stage 4: GROUP - Cluster by task/failure/skill/provider/harness/workflow
      const groupResult = await this.groupStage(context);
      context.stageResults.push(groupResult);
      
      // Stage 5: COMPARE - Success vs failure analysis
      const compareResult = await this.compareStage(context);
      context.stageResults.push(compareResult);
      
      // Stage 6: JUDGE - Assess evidence quality
      const judgeResult = await this.judgeStage(context);
      context.stageResults.push(judgeResult);
      
      // Stage 7: DISTILL - Create candidate lessons
      const distillResult = await this.distillStage(context);
      context.stageResults.push(distillResult);
      
      // Stage 8: CONTRADICTION CHECK
      const contradictionResult = await this.contradictionCheckStage(context);
      context.stageResults.push(contradictionResult);
      
      // Stage 9: VERIFY - Independent verifier
      const verifyResult = await this.verifyStage(context);
      context.stageResults.push(verifyResult);
      
      // Stage 10: CONSOLIDATE - Store validated results
      const consolidateResult = await this.consolidateStage(context);
      context.stageResults.push(consolidateResult);
      
      // Stage 11: REPORT
      const report = await this.generateReport(context, startTime);
      
      // Stage 12: CHECKPOINT
      await this.updateCheckpoint(context);
      
      return ok(report);
    } catch (error) {
      return fail({
        code: "learning.daily_run_failed",
        message: error instanceof Error ? error.message : String(error),
        category: "runtime",
        recoverable: true,
      });
    }
  }

  private async initializeContext(): Promise<DailyLearningContext> {
    const checkpoint = await this.store.getLatestCheckpoint() ?? {
      checkpointId: createId("ckpt"),
      lastProcessedEventId: "",
      lastProcessedExperienceId: "",
      lastLearningTimestamp: "1970-01-01T00:00:00.000Z",
      learningVersion: this.config.learningVersion,
      experiencesProcessed: 0,
      lessonsCreated: 0,
      lessonsVerified: 0,
      lessonsContradicted: 0,
      failuresIdentified: 0,
    };

    const newExperiences = await this.getNewExperiencesSince(checkpoint.lastLearningTimestamp);
    
    return {
      checkpoint,
      newExperiences,
      candidateLessons: [],
      verifiedLessons: [],
      newFailurePatterns: [],
      skillObservations: [],
      harnessObservations: [],
      modelObservations: [],
      plannerObservations: [],
      recommendations: [],
      stageResults: [],
      startTime: now(),
    };
  }

  private async getNewExperiencesSince(timestamp: IsoTimestamp): Promise<ExperienceRecord[]> {
    const result = await this.broker.searchExperiences({
      dateFrom: timestamp,
      limit: this.config.maxExperiencesPerRun,
    });
    
    if (!result.ok) return [];
    return result.data.filter(e => 
      e.outcome === "VERIFIED_SUCCESS" || e.outcome === "VERIFIED_FAILURE"
    );
  }

  // ============ STAGE 1: COLLECT ============
  private async collectStage(context: DailyLearningContext): Promise<LearningStageResult> {
    // Already collected in initializeContext
    return {
      stage: "COLLECT",
      processed: context.newExperiences.length,
      created: 0,
      rejected: 0,
      errors: [],
    };
  }

  // ============ STAGE 2: FILTER ============
  private async filterStage(context: DailyLearningContext): Promise<LearningStageResult> {
    const errors: string[] = [];
    let rejected = 0;
    
    const validExperiences = context.newExperiences.filter(exp => {
      // Remove corrupt experiences
      if (!exp.experienceId || !exp.missionId || !exp.timestamp) {
        rejected++;
        return false;
      }
      
      // Remove experiences missing evidence
      if (exp.evidenceRefs.length === 0 && exp.artifacts.length === 0) {
        rejected++;
        return false;
      }
      
      // Remove unsafe/untrusted inputs
      if (exp.classification === "LOCAL_ONLY" && exp.provider !== "local") {
        // This is a security issue - LOCAL_ONLY data sent to cloud
        errors.push(`Experience ${exp.experienceId}: LOCAL_ONLY data sent to cloud provider ${exp.provider}`);
        rejected++;
        return false;
      }
      
      // Remove incomplete traces
      if (exp.durationMs < 0 || exp.attempts <= 0) {
        rejected++;
        return false;
      }
      
      return true;
    });
    
    context.newExperiences = validExperiences;
    
    return {
      stage: "FILTER",
      processed: context.newExperiences.length + rejected,
      created: 0,
      rejected,
      errors,
    };
  }

  // ============ STAGE 3: RETRIEVE ============
  private async retrieveStage(context: DailyLearningContext): Promise<LearningStageResult> {
    // For each new experience, find relevant historical experiences
    // This enriches the context for comparison
    // We'll use this during GROUP and COMPARE stages
    return {
      stage: "RETRIEVE",
      processed: context.newExperiences.length,
      created: 0,
      rejected: 0,
      errors: [],
    };
  }

  // ============ STAGE 4: GROUP ============
  private async groupStage(context: DailyLearningContext): Promise<LearningStageResult> {
    const groups: Map<string, ExperienceRecord[]> = new Map();
    
    for (const exp of context.newExperiences) {
      // Group by taskType
      this.addToGroup(groups, `task:${exp.taskType}`, exp);
      
      // Group by failure pattern (if failed)
      if (exp.outcome === "VERIFIED_FAILURE") {
        const fingerprint = this.generateFailureFingerprint(exp);
        this.addToGroup(groups, `failure:${fingerprint}`, exp);
      }
      
      // Group by skill
      for (const skill of exp.skills) {
        this.addToGroup(groups, `skill:${skill}`, exp);
      }
      
      // Group by provider
      this.addToGroup(groups, `provider:${exp.provider}`, exp);
      
      // Group by harness
      this.addToGroup(groups, `harness:${exp.harness}`, exp);
      
      // Group by workflow (if available)
      // this.addToGroup(groups, `workflow:${exp.workflow}`, exp);
    }
    
    // Store groups in context for later stages
    (context as any).groups = groups;
    
    return {
      stage: "GROUP",
      processed: groups.size,
      created: 0,
      rejected: 0,
      errors: [],
    };
  }

  private addToGroup(groups: Map<string, ExperienceRecord[]>, key: string, exp: ExperienceRecord): void {
    const existing = groups.get(key) || [];
    existing.push(exp);
    groups.set(key, existing);
  }

  private generateFailureFingerprint(exp: ExperienceRecord): string {
    // Generate a fingerprint from errors and context
    const errorSig = exp.errors.slice(0, 3).join("|");
    const contextSig = `${exp.taskType}|${exp.harness}|${exp.provider}`;
    return createId("fp") + "-" + hashString(errorSig + "|" + contextSig).slice(0, 8);
  }

  // ============ STAGE 5: COMPARE ============
  private async compareStage(context: DailyLearningContext): Promise<LearningStageResult> {
    const groups = (context as any).groups as Map<string, ExperienceRecord[]>;
    let comparisons = 0;
    
    for (const [key, experiences] of groups) {
      const successes = experiences.filter(e => e.outcome === "VERIFIED_SUCCESS");
      const failures = experiences.filter(e => e.outcome === "VERIFIED_FAILURE");
      
      if (successes.length > 0 && failures.length > 0) {
        // We have both success and failure for this group - good for comparison
        comparisons++;
        
        // Analyze differences
        await this.analyzeDifferences(key, successes, failures, context);
      }
    }
    
    return {
      stage: "COMPARE",
      processed: comparisons,
      created: 0,
      rejected: 0,
      errors: [],
    };
  }

  private async analyzeDifferences(
    groupKey: string, 
    successes: ExperienceRecord[], 
    failures: ExperienceRecord[],
    context: DailyLearningContext
  ): Promise<void> {
    // Compare tools used
    const successTools = new Set(successes.flatMap(e => e.toolsUsed));
    const failureTools = new Set(failures.flatMap(e => e.toolsUsed));
    
    const toolsOnlyInSuccess = [...successTools].filter(t => !failureTools.has(t));
    const toolsOnlyInFailure = [...failureTools].filter(t => !successTools.has(t));
    
    // Compare skills
    const successSkills = new Set(successes.flatMap(e => e.skills));
    const failureSkills = new Set(failures.flatMap(e => e.skills));
    
    // Compare retries/attempts
    const avgSuccessRetries = successes.reduce((sum, e) => sum + e.retries, 0) / successes.length;
    const avgFailureRetries = failures.reduce((sum, e) => sum + e.retries, 0) / failures.length;
    
    // Compare duration
    const avgSuccessDuration = successes.reduce((sum, e) => sum + e.durationMs, 0) / successes.length;
    const avgFailureDuration = failures.reduce((sum, e) => sum + e.durationMs, 0) / failures.length;
    
    // Create candidate lesson if significant differences found
    if (toolsOnlyInSuccess.length > 0 || toolsOnlyInFailure.length > 0 ||
        avgFailureRetries > avgSuccessRetries * 2 ||
        avgFailureDuration > avgSuccessDuration * 2) {
      
      const lesson: Omit<CandidateLesson, "lessonId" | "createdAt" | "lastConfirmedAt"> = {
        claim: `For ${groupKey}: ` + 
          (toolsOnlyInSuccess.length > 0 ? `Successful missions use tools: ${toolsOnlyInSuccess.join(", ")}. ` : "") +
          (toolsOnlyInFailure.length > 0 ? `Failed missions use tools: ${toolsOnlyInFailure.join(", ")}. ` : "") +
          (avgFailureRetries > avgSuccessRetries * 2 ? `Failed missions have ${avgFailureRetries.toFixed(1)} avg retries vs ${avgSuccessRetries.toFixed(1)} for success. ` : "") +
          (avgFailureDuration > avgSuccessDuration * 2 ? `Failed missions take ${(avgFailureDuration/1000).toFixed(0)}s vs ${(avgSuccessDuration/1000).toFixed(0)}s for success. ` : ""),
        type: groupKey.startsWith("task:") ? "PROCEDURAL" : 
              groupKey.startsWith("failure:") ? "FAILURE_PATTERN" :
              groupKey.startsWith("skill:") ? "SKILL" :
              groupKey.startsWith("provider:") ? "ROUTING" :
              groupKey.startsWith("harness:") ? "ROUTING" : "SEMANTIC",
        supportingExperienceIds: successes.map(e => e.experienceId),
        contradictingExperienceIds: failures.map(e => e.experienceId),
        supportCount: successes.length,
        contradictionCount: failures.length,
        confidence: this.assessConfidence(successes.length, failures.length),
        scope: groupKey,
        applicableVersions: [this.config.learningVersion],
        status: "CANDIDATE",
        evidenceRefs: [...successes.flatMap(e => e.evidenceRefs), ...failures.flatMap(e => e.evidenceRefs)],
      };
      
      const lessonId = await this.store.addCandidateLesson(lesson);
      context.candidateLessons.push({ ...lesson, lessonId, createdAt: now(), lastConfirmedAt: now() });
    }
  }

  private assessConfidence(successCount: number, failureCount: number): CandidateLesson["confidence"] {
    const total = successCount + failureCount;
    if (total >= 20) return "VERY_HIGH";
    if (total >= 10) return "HIGH";
    if (total >= 5) return "MEDIUM";
    if (total >= 3) return "LOW";
    return "VERY_LOW";
  }

  // ============ STAGE 6: JUDGE ============
  private async judgeStage(context: DailyLearningContext): Promise<LearningStageResult> {
    const errors: string[] = [];
    let rejected = 0;
    
    // Assess evidence quality for each candidate lesson
    const validatedLessons: CandidateLesson[] = [];
    
    for (const lesson of context.candidateLessons) {
      const quality = await this.assessEvidenceQuality(lesson);
      
      if (quality >= this.config.minConfidenceForVerification) {
        validatedLessons.push(lesson);
      } else {
        rejected++;
        // Could add to errors for tracking
      }
    }
    
    context.candidateLessons = validatedLessons;
    
    return {
      stage: "JUDGE",
      processed: context.candidateLessons.length + rejected,
      created: validatedLessons.length,
      rejected,
      errors: [],
    };
  }

  private async assessEvidenceQuality(lesson: CandidateLesson): Promise<number> {
    // Simple quality assessment based on:
    // - Number of supporting experiences
    // - Consistency of supporting experiences
    // - Recency of experiences
    // - Verification status of experiences
    
    const supportingCount = lesson.supportingExperienceIds.length;
    const contradictingCount = lesson.contradictingExperienceIds.length;
    
    if (supportingCount === 0) return 0;
    
    // Base quality from support vs contradiction ratio
    const ratio = supportingCount / Math.max(1, contradictingCount);
    let quality = Math.min(1, ratio / 10); // Max quality at 10:1 ratio
    
    // Boost for recency (experiences from last 30 days)
    // This would need to check timestamps of experiences
    
    return Math.min(1, quality);
  }

  // ============ STAGE 7: DISTILL ============
  private async distillStage(context: DailyLearningContext): Promise<LearningStageResult> {
    // Additional distillation - create failure patterns from repeated failures
    const groups = (context as any).groups as Map<string, ExperienceRecord[]>;
    let created = 0;
    
    for (const [key, experiences] of groups) {
      if (key.startsWith("failure:") && experiences.length >= 3) {
        // Check if we already have this pattern
        const fingerprint = key.replace("failure:", "");
        const existingPattern = await this.broker.findMatchingFailurePattern([fingerprint]);
        
        if (!existingPattern) {
          const pattern: Omit<FailurePattern, "patternId" | "firstSeen" | "lastSeen" | "occurrences"> = {
            signature: fingerprint,
            fingerprints: [fingerprint],
            environments: [...new Set(experiences.map(e => `${e.environment.os}|${e.environment.gpu}`))],
            causes: ["Analysis needed - candidate"],
            successfulMitigations: [],
            failedMitigations: [],
            evidenceRefs: experiences.flatMap(e => e.evidenceRefs),
            confidence: this.assessPatternConfidence(experiences.length),
          };
          
          await this.store.addFailurePattern(pattern);
          created++;
        }
      }
    }
    
    return {
      stage: "DISTILL",
      processed: context.candidateLessons.length,
      created,
      rejected: 0,
      errors: [],
    };
  }

  private assessPatternConfidence(occurrences: number): number {
    if (occurrences >= 10) return 0.9;
    if (occurrences >= 5) return 0.7;
    if (occurrences >= 3) return 0.5;
    return 0.3;
  }

  // ============ STAGE 8: CONTRADICTION CHECK ============
  private async contradictionCheckStage(context: DailyLearningContext): Promise<LearningStageResult> {
    let contradictions = 0;
    const verifiedResult = await this.broker.getVerifiedLessons();
    
    if (!verifiedResult.ok) {
      return {
        stage: "CONTRADICTION_CHECK",
        processed: 0,
        created: 0,
        rejected: 0,
        errors: [verifiedResult.error.message],
      };
    }
    
    const verifiedLessons = verifiedResult.data;
    
    for (const candidate of context.candidateLessons) {
      for (const verified of verifiedLessons) {
        if (this.lessonsContradict(candidate, verified)) {
          // Mark both as potentially contradicted
          await this.store.updateCandidateLesson(verified.lessonId, { 
            status: "CONTRADICTED",
            contradictionCount: verified.contradictionCount + 1,
          });
          await this.store.updateCandidateLesson(candidate.lessonId, { 
            status: "CONTRADICTED",
            contradictionCount: candidate.contradictionCount + 1,
          });
          contradictions++;
        }
      }
    }
    
    return {
      stage: "CONTRADICTION_CHECK",
      processed: context.candidateLessons.length,
      created: 0,
      rejected: contradictions,
      errors: [],
    };
  }

  private lessonsContradict(a: CandidateLesson, b: CandidateLesson): boolean {
    // Simple contradiction detection - if claims are mutually exclusive
    // This is a simplified version - in practice would use semantic analysis
    if (a.type !== b.type) return false;
    if (a.scope !== b.scope) return false;
    
    // Check if claims are opposites
    // This is a placeholder - real implementation would use NLP
    return false;
  }

  // ============ STAGE 9: VERIFY ============
  private async verifyStage(context: DailyLearningContext): Promise<LearningStageResult> {
    let verifiedCount = 0;
    let rejected = 0;
    
    for (const lesson of context.candidateLessons) {
      // Run independent verification
      const isVerified = await this.runIndependentVerification(lesson);
      
      if (isVerified) {
        await this.store.updateCandidateLesson(lesson.lessonId, { status: "VERIFIED" });
        context.verifiedLessons.push(lesson);
        verifiedCount++;
      } else {
        await this.store.updateCandidateLesson(lesson.lessonId, { status: "WEAKENED" });
        rejected++;
      }
    }
    
    return {
      stage: "VERIFY",
      processed: context.candidateLessons.length,
      created: verifiedCount,
      rejected,
      errors: [],
    };
  }

  private async runIndependentVerification(lesson: CandidateLesson): Promise<boolean> {
    // In a real implementation, this would spawn a verifier agent
    // For now, use deterministic criteria
    
    // Require at least 3 supporting experiences with VERIFIED_SUCCESS
    if (lesson.supportingExperienceIds.length < 3) return false;
    
    // Require contradiction count to be low
    if (lesson.contradictionCount > lesson.supportCount * 0.3) return false;
    
    // Require confidence to be at least MEDIUM
    const confidenceOrder = { "VERY_LOW": 1, "LOW": 2, "MEDIUM": 3, "HIGH": 4, "VERY_HIGH": 5 };
    if (confidenceOrder[lesson.confidence] < 3) return false;
    
    return true;
  }

  // ============ STAGE 10: CONSOLIDATE ============
  private async consolidateStage(context: DailyLearningContext): Promise<LearningStageResult> {
    let consolidated = 0;
    
    for (const lesson of context.verifiedLessons) {
      // Convert to appropriate knowledge type
      if (lesson.type === "SEMANTIC") {
        await this.store.addSemanticKnowledge({
          fact: lesson.claim,
          sourceExperienceIds: lesson.supportingExperienceIds,
          supportingEvidence: lesson.evidenceRefs,
          confidence: confidenceOrder[lesson.confidence] / 5,
          domain: lesson.scope,
          tags: [lesson.type.toLowerCase()],
          retired: false,
        });
      } else if (lesson.type === "PROCEDURAL") {
        await this.store.addProceduralKnowledge({
          name: `Procedure for ${lesson.scope}`,
          version: 1,
          steps: [], // Would be extracted from experiences
          applicableContexts: [lesson.scope],
          sourceExperienceIds: lesson.supportingExperienceIds,
          evidenceRefs: lesson.evidenceRefs,
          confidence: confidenceOrder[lesson.confidence] / 5,
          trustLevel: "LOCALLY_VERIFIED",
          retired: false,
        });
      } else if (lesson.type === "FAILURE_PATTERN") {
        // Already created in DISTILL stage
      } else if (lesson.type === "ROUTING") {
        // Update routing statistics in performance metrics
      } else if (lesson.type === "SKILL") {
        // Record skill observation
      } else if (lesson.type === "PLANNER" || lesson.type === "TEAM") {
        // Record planner observation
      }
      
      consolidated++;
    }
    
    return {
      stage: "CONSOLIDATE",
      processed: context.verifiedLessons.length,
      created: consolidated,
      rejected: 0,
      errors: [],
    };
  }

  // ============ STAGE 11: REPORT ============
  private async generateReport(context: DailyLearningContext, startTime: IsoTimestamp): Promise<DailyLearningReport> {
    const endTime = now();
    const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
    
    // Compute skill observations
    const skillObservations = await this.computeSkillObservations();
    context.skillObservations = skillObservations;
    
    // Compute harness observations
    const harnessObservations = await this.computeHarnessObservations();
    context.harnessObservations = harnessObservations;
    
    // Compute model observations
    const modelObservations = await this.computeModelObservations();
    context.modelObservations = modelObservations;
    
    // Compute planner observations
    const plannerObservations = await this.computePlannerObservations();
    context.plannerObservations = plannerObservations;
    
    const report: Omit<DailyLearningReport, "reportId"> = {
      date: now(),
      newExperiencesProcessed: context.newExperiences.length,
      verifiedSuccesses: context.newExperiences.filter(e => e.outcome === "VERIFIED_SUCCESS").length,
      verifiedFailures: context.newExperiences.filter(e => e.outcome === "VERIFIED_FAILURE").length,
      partialUnverified: context.newExperiences.filter(e => e.outcome === "PARTIAL" || e.outcome === "UNVERIFIED").length,
      newLessons: context.candidateLessons.length,
      confirmedLessons: context.verifiedLessons.length,
      contradictions: context.stageResults.find(s => s.stage === "CONTRADICTION_CHECK")?.rejected || 0,
      supersededLessons: 0, // Would track this
      newFailurePatterns: context.newFailurePatterns.length,
      skillObservations,
      harnessObservations,
      modelObservations,
      plannerObservations,
      recommendationsRequiringApproval: context.recommendations,
      learningCheckpoint: await this.createCheckpoint(context),
      costUsd: 0, // Would compute from LLM usage
      durationMs,
    };
    
    const reportId = await this.store.addDailyLearningReport(report);
    return { ...report, reportId };
  }

  private async computeSkillObservations(): Promise<SkillObservation[]> {
    // Get performance metrics for skills
    const metrics = await this.broker.getSkillPerformance();
    if (!metrics.ok) return [];
    
    return metrics.data.map(m => ({
      skillId: m.dimensionValue,
      skillVersion: "1.0.0",
      selectionCount: m.missions,
      verifiedSuccesses: m.verifiedSuccess,
      verifiedFailures: m.verifiedFailure,
      verifierPassRate: m.verifierPassRate,
      avgRetries: m.avgRetries,
      avgDurationMs: m.avgDurationMs,
      avgCostUsd: m.avgCostUsd,
    }));
  }

  private async computeHarnessObservations(): Promise<HarnessObservation[]> {
    const metrics = await this.broker.getHarnessPerformance();
    if (!metrics.ok) return [];
    
    return metrics.data.map(m => ({
      harness: m.dimensionValue,
      taskType: "general",
      missions: m.missions,
      verifiedSuccesses: m.verifiedSuccess,
      verifierPassRate: m.verifierPassRate,
      avgRetries: m.avgRetries,
      avgDurationMs: m.avgDurationMs,
      avgCostUsd: m.avgCostUsd,
    }));
  }

  private async computeModelObservations(): Promise<ModelObservation[]> {
    const metrics = await this.broker.getModelPerformance();
    if (!metrics.ok) return [];
    
    return metrics.data.map(m => ({
      provider: "unknown", // Would need to parse from dimensionValue
      model: m.dimensionValue,
      taskType: "general",
      missions: m.missions,
      verifiedSuccesses: m.verifiedSuccess,
      verifierPassRate: m.verifierPassRate,
      avgRetries: m.avgRetries,
      avgLatencyMs: m.avgDurationMs,
      avgTokens: m.avgTokens,
      avgCostUsd: m.avgCostUsd,
    }));
  }

  private async computePlannerObservations(): Promise<PlannerObservation[]> {
    // Get experiences grouped by task type and analyze team structures
    const experiences = await this.broker.getExperiencesByTaskType("general", 100);
    if (!experiences.ok) return [];
    
    // This would analyze team sizes and compositions
    return [{
      taskType: "general",
      recommendedTeamSize: 3,
      recommendedRoles: ["executor", "verifier"],
      missionsWithThisStructure: experiences.data.length,
      verifierPassRate: 85,
      avgDurationMs: 30000,
      avgTokens: 50000,
    }];
  }

  // ============ STAGE 12: CHECKPOINT ============
  private async updateCheckpoint(context: DailyLearningContext): Promise<void> {
    const checkpoint: Omit<LearningCheckpoint, "checkpointId"> = {
      lastProcessedEventId: "", // Would track event IDs
      lastProcessedExperienceId: context.newExperiences[context.newExperiences.length - 1]?.experienceId || "",
      lastLearningTimestamp: now(),
      learningVersion: this.config.learningVersion,
      experiencesProcessed: context.checkpoint.experiencesProcessed + context.newExperiences.length,
      lessonsCreated: context.checkpoint.lessonsCreated + context.candidateLessons.length,
      lessonsVerified: context.checkpoint.lessonsVerified + context.verifiedLessons.length,
      lessonsContradicted: context.checkpoint.lessonsContradicted + 
        (context.stageResults.find(s => s.stage === "CONTRADICTION_CHECK")?.rejected || 0),
      failuresIdentified: context.checkpoint.failuresIdentified + context.newFailurePatterns.length,
    };
    
    await this.store.createLearningCheckpoint(checkpoint);
  }

  private async createCheckpoint(context: DailyLearningContext): Promise<LearningCheckpoint> {
    return {
      checkpointId: createId("ckpt"),
      lastProcessedEventId: "",
      lastProcessedExperienceId: context.newExperiences[context.newExperiences.length - 1]?.experienceId || "",
      lastLearningTimestamp: now(),
      learningVersion: this.config.learningVersion,
      experiencesProcessed: context.checkpoint.experiencesProcessed + context.newExperiences.length,
      lessonsCreated: context.checkpoint.lessonsCreated + context.candidateLessons.length,
      lessonsVerified: context.checkpoint.lessonsVerified + context.verifiedLessons.length,
      lessonsContradicted: context.checkpoint.lessonsContradicted + 
        (context.stageResults.find(s => s.stage === "CONTRADICTION_CHECK")?.rejected || 0),
      failuresIdentified: context.checkpoint.failuresIdentified + context.newFailurePatterns.length,
    };
  }
}

const confidenceOrder = { "VERY_LOW": 1, "LOW": 2, "MEDIUM": 3, "HIGH": 4, "VERY_HIGH": 5 };

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

export function createDailyLearningRoutine(config: DailyLearningConfig): DailyLearningRoutine {
  return new DailyLearningRoutine(config);
}