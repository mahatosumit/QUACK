/**
 * Experience Broker - Query interface for organizational experience
 * 
 * Provides high-level queries for:
 * - Similar experiences
 * - Failure patterns
 * - Performance statistics
 * - Skill effectiveness
 * - Routing preferences
 */

import { type QuackResult, ok, fail } from "../core/types.js";
import { ExperienceStore } from "./experience-store.js";
import {
  ExperienceRecord,
  SemanticKnowledge,
  ProceduralKnowledge,
  PerformanceMetrics,
  FailurePattern,
  CandidateLesson,
  LearningCheckpoint,
  DailyLearningReport,
  ExperienceQuery,
  SimilarExperienceQuery,
  ExperienceOutcome,
  ExperienceClassification,
} from "./types.js";

export interface ExperienceBroker {
  // Episodic queries
  findSimilarExperiences(query: SimilarExperienceQuery): Promise<QuackResult<ExperienceRecord[]>>;
  getExperiencesByOutcome(outcome: ExperienceOutcome, limit?: number): Promise<QuackResult<ExperienceRecord[]>>;
  getExperiencesByTaskType(taskType: string, limit?: number): Promise<QuackResult<ExperienceRecord[]>>;
  getExperiencesByHarness(harness: string, limit?: number): Promise<QuackResult<ExperienceRecord[]>>;
  getExperiencesByProvider(provider: string, limit?: number): Promise<QuackResult<ExperienceRecord[]>>;
  getExperiencesByProject(projectId: string, limit?: number): Promise<QuackResult<ExperienceRecord[]>>;

  // Semantic knowledge
  querySemanticKnowledge(domain?: string, tags?: string[]): Promise<QuackResult<SemanticKnowledge[]>>;
  getSemanticKnowledgeByDomain(domain: string): Promise<QuackResult<SemanticKnowledge[]>>;

  // Procedural knowledge
  queryProceduralKnowledge(context?: string, trustLevel?: string): Promise<QuackResult<ProceduralKnowledge[]>>;
  getProceduralKnowledgeForTask(taskType: string): Promise<QuackResult<ProceduralKnowledge[]>>;

  // Performance metrics
  getPerformanceMetrics(dimension?: string, dimensionValue?: string): Promise<QuackResult<PerformanceMetrics[]>>;
  getHarnessPerformance(taskType?: string): Promise<QuackResult<PerformanceMetrics[]>>;
  getProviderPerformance(provider?: string, taskType?: string): Promise<QuackResult<PerformanceMetrics[]>>;
  getModelPerformance(model?: string, taskType?: string): Promise<QuackResult<PerformanceMetrics[]>>;
  getSkillPerformance(skillId?: string): Promise<QuackResult<PerformanceMetrics[]>>;

  // Failure patterns
  queryFailurePatterns(environment?: string, minConfidence?: number): Promise<QuackResult<FailurePattern[]>>;
  findMatchingFailurePattern(fingerprints: string[], environment?: string): Promise<QuackResult<FailurePattern | undefined>>;
  getFailurePatternsByEnvironment(environment: string): Promise<QuackResult<FailurePattern[]>>;

  // Candidate lessons
  queryCandidateLessons(status?: string, type?: string): Promise<QuackResult<CandidateLesson[]>>;
  getVerifiedLessons(type?: string): Promise<QuackResult<CandidateLesson[]>>;
  getCandidateLessonsByType(type: string): Promise<QuackResult<CandidateLesson[]>>;

  // Learning checkpoints
  getLatestCheckpoint(): Promise<QuackResult<LearningCheckpoint | undefined>>;
  getCheckpoints(limit?: number): Promise<QuackResult<LearningCheckpoint[]>>;

  // Daily learning reports
  getLatestDailyLearningReport(): Promise<QuackResult<DailyLearningReport | undefined>>;
  getDailyLearningReports(limit?: number): Promise<QuackResult<DailyLearningReport[]>>;

  // General queries
  searchExperiences(query: ExperienceQuery): Promise<QuackResult<ExperienceRecord[]>>;
  getExperienceStats(): Promise<QuackResult<{ 
    totalExperiences: number; 
    byOutcome: Record<ExperienceOutcome, number>;
    byTaskType: Record<string, number>;
    byHarness: Record<string, number>;
    byProvider: Record<string, number>;
    byModel: Record<string, number>;
    verificationRate: number;
  }>>;
}

export interface ExperienceBrokerConfig {
  readonly store: ExperienceStore;
}

export function createExperienceBroker(config: ExperienceBrokerConfig): ExperienceBroker {
  const { store } = config;

  return {
    // Episodic queries
    async findSimilarExperiences(query: SimilarExperienceQuery) {
      try {
        const results = await store.findSimilarExperiences(query);
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.find_similar_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    async getExperiencesByOutcome(outcome: ExperienceOutcome, limit = 50) {
      try {
        const results = await store.queryExperiences({ outcome, limit });
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.experiences_by_outcome_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    async getExperiencesByTaskType(taskType: string, limit = 50) {
      try {
        const results = await store.queryExperiences({ taskType, limit });
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.experiences_by_task_type_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    async getExperiencesByHarness(harness: string, limit = 50) {
      try {
        const results = await store.queryExperiences({ harness, limit });
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.experiences_by_harness_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    async getExperiencesByProvider(provider: string, limit = 50) {
      try {
        const results = await store.queryExperiences({ provider, limit });
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.experiences_by_provider_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    async getExperiencesByProject(projectId: string, limit = 50) {
      try {
        const results = await store.queryExperiences({ projectId, limit });
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.experiences_by_project_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    // Semantic knowledge
    async querySemanticKnowledge(domain?: string, tags?: string[]) {
      try {
        const results = await store.querySemanticKnowledge(domain, tags);
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.semantic_knowledge_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    async getSemanticKnowledgeByDomain(domain: string) {
      try {
        const results = await store.querySemanticKnowledge(domain);
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.semantic_by_domain_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    // Procedural knowledge
    async queryProceduralKnowledge(context?: string, trustLevel?: string) {
      try {
        const results = await store.queryProceduralKnowledge(context, trustLevel as ProceduralKnowledge["trustLevel"]);
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.procedural_knowledge_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    async getProceduralKnowledgeForTask(taskType: string) {
      try {
        const results = await store.queryProceduralKnowledge(taskType);
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.procedural_for_task_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    // Performance metrics
    async getPerformanceMetrics(dimension?: string, dimensionValue?: string) {
      try {
        const results = await store.getPerformanceMetrics(dimension, dimensionValue);
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.performance_metrics_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    async getHarnessPerformance(taskType?: string) {
      try {
        const results = await store.getPerformanceMetrics("harness", taskType);
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.harness_performance_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    async getProviderPerformance(provider?: string, taskType?: string) {
      try {
        const results = await store.getPerformanceMetrics("provider", taskType);
        return ok(results.filter(p => !provider || p.dimensionValue === provider));
      } catch (error) {
        return fail({
          code: "learning.provider_performance_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    async getModelPerformance(model?: string, taskType?: string) {
      try {
        const results = await store.getPerformanceMetrics("model", taskType);
        return ok(results.filter(p => !model || p.dimensionValue === model));
      } catch (error) {
        return fail({
          code: "learning.model_performance_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    async getSkillPerformance(skillId?: string) {
      try {
        const results = await store.getPerformanceMetrics("skill", skillId);
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.skill_performance_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    // Failure patterns
    async queryFailurePatterns(environment?: string, minConfidence?: number) {
      try {
        const results = await store.queryFailurePatterns(environment, minConfidence);
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.failure_patterns_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    async findMatchingFailurePattern(fingerprints: string[], environment?: string) {
      try {
        const result = await store.findMatchingFailurePattern(fingerprints, environment);
        return ok(result);
      } catch (error) {
        return fail({
          code: "learning.matching_failure_pattern_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    async getFailurePatternsByEnvironment(environment: string) {
      try {
        const results = await store.queryFailurePatterns(environment);
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.failure_patterns_by_env_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    // Candidate lessons
    async queryCandidateLessons(status?: string, type?: string) {
      try {
        const results = await store.queryCandidateLessons(status as CandidateLesson["status"], type as CandidateLesson["type"]);
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.candidate_lessons_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    async getVerifiedLessons(type?: string) {
      try {
        const results = await store.queryCandidateLessons("VERIFIED", type as CandidateLesson["type"]);
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.verified_lessons_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    async getCandidateLessonsByType(type: string) {
      try {
        const results = await store.queryCandidateLessons(undefined, type as CandidateLesson["type"]);
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.candidate_lessons_by_type_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    // Learning checkpoints
    async getLatestCheckpoint() {
      try {
        const result = await store.getLatestCheckpoint();
        return ok(result);
      } catch (error) {
        return fail({
          code: "learning.latest_checkpoint_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    async getCheckpoints(limit = 10) {
      try {
        const results = await store.queryCheckpoints(limit);
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.checkpoints_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    // Daily learning reports
    async getLatestDailyLearningReport() {
      try {
        const result = await store.getLatestDailyLearningReport();
        return ok(result);
      } catch (error) {
        return fail({
          code: "learning.latest_report_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    async getDailyLearningReports(limit = 30) {
      try {
        const results = await store.queryDailyLearningReports(limit);
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.daily_reports_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    // General queries
    async searchExperiences(query: ExperienceQuery) {
      try {
        const results = await store.queryExperiences(query);
        return ok(results);
      } catch (error) {
        return fail({
          code: "learning.search_experiences_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },

    async getExperienceStats() {
      try {
        const experiences = await store.queryExperiences({ limit: 10000 });
        
        const byOutcome: Record<ExperienceOutcome, number> = {
          VERIFIED_SUCCESS: 0,
          VERIFIED_FAILURE: 0,
          PARTIAL: 0,
          UNVERIFIED: 0,
        };
        
        const byTaskType: Record<string, number> = {};
        const byHarness: Record<string, number> = {};
        const byProvider: Record<string, number> = {};
        const byModel: Record<string, number> = {};
        
        let verifiedCount = 0;
        
        for (const exp of experiences) {
          byOutcome[exp.outcome]++;
          byTaskType[exp.taskType] = (byTaskType[exp.taskType] || 0) + 1;
          byHarness[exp.harness] = (byHarness[exp.harness] || 0) + 1;
          byProvider[exp.provider] = (byProvider[exp.provider] || 0) + 1;
          byModel[exp.model] = (byModel[exp.model] || 0) + 1;
          
          if (exp.outcome === "VERIFIED_SUCCESS" || exp.outcome === "VERIFIED_FAILURE") {
            verifiedCount++;
          }
        }
        
        return ok({
          totalExperiences: experiences.length,
          byOutcome,
          byTaskType,
          byHarness,
          byProvider,
          byModel,
          verificationRate: experiences.length > 0 ? (verifiedCount / experiences.length) * 100 : 0,
        });
      } catch (error) {
        return fail({
          code: "learning.experience_stats_failed",
          message: error instanceof Error ? error.message : String(error),
          category: "runtime",
          recoverable: true,
        });
      }
    },
  };
}

export { ExperienceStore } from "./experience-store.js";
export type { 
  ExperienceRecord, 
  SemanticKnowledge, 
  ProceduralKnowledge, 
  PerformanceMetrics, 
  FailurePattern, 
  CandidateLesson, 
  LearningCheckpoint, 
  DailyLearningReport,
  ExperienceQuery,
  SimilarExperienceQuery,
  ExperienceOutcome,
  ExperienceClassification,
} from "./types.js";
export { createExperienceStore } from "./experience-store.js";