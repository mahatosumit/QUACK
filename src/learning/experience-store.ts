/**
 * Experience Store Implementation
 * 
 * Persistent storage for verified mission experiences with:
 * - EPISODIC memory (historical facts)
 * - SEMANTIC knowledge (derived facts)
 * - PROCEDURAL knowledge (reusable procedures)
 * - PERFORMANCE metrics (aggregated statistics)
 * - FAILURE patterns
 * - CANDIDATE lessons
 */

import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createId, now, type IsoTimestamp, type JsonObject, type JsonValue, ok, fail, type QuackResult } from "../core/types.js";
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
  ExperienceStoreConfig,
  ExperienceOutcome,
  ExperienceClassification,
} from "./types.js";

interface ExperienceStoreData {
  experiences: ExperienceRecord[];
  semanticKnowledge: SemanticKnowledge[];
  proceduralKnowledge: ProceduralKnowledge[];
  performanceMetrics: PerformanceMetrics[];
  failurePatterns: FailurePattern[];
  candidateLessons: CandidateLesson[];
  learningCheckpoints: LearningCheckpoint[];
  dailyLearningReports: DailyLearningReport[];
}

export class ExperienceStore {
  private readonly storagePath: string;
  private readonly retentionDays: number;
  private readonly maxRawTraces: number;
  private readonly compressionEnabled: boolean;
  private data: ExperienceStoreData;
  private loaded = false;

  constructor(config: ExperienceStoreConfig) {
    this.storagePath = config.storagePath;
    this.retentionDays = config.retentionDays;
    this.maxRawTraces = config.maxRawTraces;
    this.compressionEnabled = config.compressionEnabled;
    this.data = this.createEmptyData();
  }

  private createEmptyData(): ExperienceStoreData {
    return {
      experiences: [],
      semanticKnowledge: [],
      proceduralKnowledge: [],
      performanceMetrics: [],
      failurePatterns: [],
      candidateLessons: [],
      learningCheckpoints: [],
      dailyLearningReports: [],
    };
  }

  async initialize(): Promise<void> {
    if (this.loaded) return;
    
    await mkdir(this.storagePath, { recursive: true });
    const dataPath = join(this.storagePath, "experience-store.json");
    
    try {
      const fileContent = await readFile(dataPath, "utf-8");
      this.data = JSON.parse(fileContent);
    } catch (error) {
      // File doesn't exist or is corrupt, start fresh
      this.data = this.createEmptyData();
    }
    
    this.loaded = true;
  }

  private async save(): Promise<void> {
    const dataPath = join(this.storagePath, "experience-store.json");
    await mkdir(this.storagePath, { recursive: true });
    await writeFile(dataPath, JSON.stringify(this.data, null, 2));
  }

  // ============ EPISODIC MEMORY ============
  
  async recordExperience(experience: Omit<ExperienceRecord, "experienceId" | "timestamp">): Promise<string> {
    const record: ExperienceRecord = {
      ...experience,
      experienceId: createId("exp"),
      timestamp: now(),
    };
    
    this.data.experiences.push(record);
    await this.save();
    return record.experienceId;
  }

  async getExperience(experienceId: string): Promise<ExperienceRecord | undefined> {
    return this.data.experiences.find(e => e.experienceId === experienceId);
  }

  async queryExperiences(query: ExperienceQuery): Promise<ExperienceRecord[]> {
    let results = [...this.data.experiences];
    
    if (query.outcome) {
      results = results.filter(e => e.outcome === query.outcome);
    }
    if (query.taskType) {
      results = results.filter(e => e.taskType === query.taskType);
    }
    if (query.harness) {
      results = results.filter(e => e.harness === query.harness);
    }
    if (query.provider) {
      results = results.filter(e => e.provider === query.provider);
    }
    if (query.model) {
      results = results.filter(e => e.model === query.model);
    }
    if (query.projectId) {
      results = results.filter(e => e.projectId === query.projectId);
    }
    if (query.agentId) {
      results = results.filter(e => e.agentId === query.agentId);
    }
    if (query.dateFrom) {
      results = results.filter(e => e.timestamp >= query.dateFrom!);
    }
    if (query.dateTo) {
      results = results.filter(e => e.timestamp <= query.dateTo!);
    }
    if (query.classification) {
      results = results.filter(e => e.classification === query.classification);
    }
    
    // Sort by timestamp descending (newest first)
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    
    if (query.limit) {
      results = results.slice(0, query.limit);
    }
    
    return results;
  }

  async findSimilarExperiences(query: SimilarExperienceQuery): Promise<ExperienceRecord[]> {
    let results = [...this.data.experiences];
    
    if (query.taskType) {
      results = results.filter(e => e.taskType === query.taskType);
    }
    if (query.outcome) {
      results = results.filter(e => e.outcome === query.outcome);
    }
    if (query.harness) {
      results = results.filter(e => e.harness === query.harness);
    }
    if (query.provider) {
      results = results.filter(e => e.provider === query.provider);
    }
    
    // If goal provided, we could do semantic similarity here
    // For now, just filter by task type and outcome
    
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    
    if (query.limit) {
      results = results.slice(0, query.limit);
    }
    
    return results;
  }

  // ============ SEMANTIC KNOWLEDGE ============
  
  async addSemanticKnowledge(knowledge: Omit<SemanticKnowledge, "knowledgeId" | "createdAt" | "lastConfirmedAt" | "version">): Promise<string> {
    const record: SemanticKnowledge = {
      ...knowledge,
      knowledgeId: createId("know"),
      createdAt: now(),
      lastConfirmedAt: now(),
      version: 1,
    };
    
    this.data.semanticKnowledge.push(record);
    await this.save();
    return record.knowledgeId;
  }

  async getSemanticKnowledge(knowledgeId: string): Promise<SemanticKnowledge | undefined> {
    return this.data.semanticKnowledge.find(k => k.knowledgeId === knowledgeId);
  }

  async updateSemanticKnowledge(knowledgeId: string, updates: Partial<SemanticKnowledge>): Promise<void> {
    const index = this.data.semanticKnowledge.findIndex(k => k.knowledgeId === knowledgeId);
    if (index >= 0) {
      this.data.semanticKnowledge[index] = {
        ...this.data.semanticKnowledge[index],
        ...updates,
        knowledgeId: this.data.semanticKnowledge[index].knowledgeId, // Preserve ID
        version: this.data.semanticKnowledge[index].version + 1,
        lastConfirmedAt: now(),
      };
      await this.save();
    }
  }

  async retireSemanticKnowledge(knowledgeId: string, supersededBy?: string): Promise<void> {
    await this.updateSemanticKnowledge(knowledgeId, { retired: true, supersededBy });
  }

  async querySemanticKnowledge(domain?: string, tags?: string[]): Promise<SemanticKnowledge[]> {
    let results = this.data.semanticKnowledge.filter(k => !k.retired);
    
    if (domain) {
      results = results.filter(k => k.domain === domain);
    }
    if (tags && tags.length > 0) {
      results = results.filter(k => tags.some(tag => k.tags.includes(tag)));
    }
    
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  // ============ PROCEDURAL KNOWLEDGE ============
  
  async addProceduralKnowledge(procedure: Omit<ProceduralKnowledge, "procedureId" | "createdAt" | "lastConfirmedAt">): Promise<string> {
    const record: ProceduralKnowledge = {
      ...procedure,
      procedureId: createId("proc"),
      createdAt: now(),
      lastConfirmedAt: now(),
    };
    
    this.data.proceduralKnowledge.push(record);
    await this.save();
    return record.procedureId;
  }

  async getProceduralKnowledge(procedureId: string): Promise<ProceduralKnowledge | undefined> {
    return this.data.proceduralKnowledge.find(p => p.procedureId === procedureId);
  }

  async queryProceduralKnowledge(context?: string, trustLevel?: ProceduralKnowledge["trustLevel"]): Promise<ProceduralKnowledge[]> {
    let results = this.data.proceduralKnowledge.filter(p => !p.retired);
    
    if (context) {
      results = results.filter(p => p.applicableContexts.some(c => c.includes(context)));
    }
    if (trustLevel) {
      results = results.filter(p => p.trustLevel === trustLevel);
    }
    
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  async supersedeProceduralKnowledge(procedureId: string, supersededBy: string): Promise<void> {
    const index = this.data.proceduralKnowledge.findIndex(p => p.procedureId === procedureId);
    if (index >= 0) {
      this.data.proceduralKnowledge[index] = {
        ...this.data.proceduralKnowledge[index],
        supersededBy,
        retired: true,
      };
      await this.save();
    }
  }

  // ============ PERFORMANCE METRICS ============
  
  async recordPerformanceMetric(metric: Omit<PerformanceMetrics, "metricId" | "lastUpdated">): Promise<string> {
    const record: PerformanceMetrics = {
      ...metric,
      metricId: createId("perf"),
      lastUpdated: now(),
    };
    
    // Check if existing metric for same dimension/value
    const existingIndex = this.data.performanceMetrics.findIndex(
      m => m.dimension === metric.dimension && m.dimensionValue === metric.dimensionValue
    );
    
    if (existingIndex >= 0) {
      // Merge with existing
      const existing = this.data.performanceMetrics[existingIndex];
      this.data.performanceMetrics[existingIndex] = {
        ...record,
        missions: existing.missions + metric.missions,
        verifiedSuccess: existing.verifiedSuccess + metric.verifiedSuccess,
        verifiedFailure: existing.verifiedFailure + metric.verifiedFailure,
        verifierPassRate: (
          (existing.verifiedSuccess + metric.verifiedSuccess) / 
          (existing.missions + metric.missions)
        ) * 100,
        avgRetries: (
          (existing.avgRetries * existing.missions + metric.avgRetries * metric.missions) / 
          (existing.missions + metric.missions)
        ),
        avgDurationMs: (
          (existing.avgDurationMs * existing.missions + metric.avgDurationMs * metric.missions) / 
          (existing.missions + metric.missions)
        ),
        avgTokens: (
          (existing.avgTokens * existing.missions + metric.avgTokens * metric.missions) / 
          (existing.missions + metric.missions)
        ),
        avgCostUsd: (
          (existing.avgCostUsd * existing.missions + metric.avgCostUsd * metric.missions) / 
          (existing.missions + metric.missions)
        ),
        lastUpdated: now(),
      };
    } else {
      this.data.performanceMetrics.push(record);
    }
    
    await this.save();
    return record.metricId;
  }

  async getPerformanceMetrics(dimension?: string, dimensionValue?: string): Promise<PerformanceMetrics[]> {
    let results = [...this.data.performanceMetrics];
    
    if (dimension) {
      results = results.filter(m => m.dimension === dimension);
    }
    if (dimensionValue) {
      results = results.filter(m => m.dimensionValue === dimensionValue);
    }
    
    return results.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
  }

  // ============ FAILURE PATTERNS ============
  
  async addFailurePattern(pattern: Omit<FailurePattern, "patternId" | "firstSeen" | "lastSeen" | "occurrences">): Promise<string> {
    const record: FailurePattern = {
      ...pattern,
      patternId: createId("fp"),
      firstSeen: now(),
      lastSeen: now(),
      occurrences: 1,
    };
    
    this.data.failurePatterns.push(record);
    await this.save();
    return record.patternId;
  }

  async getFailurePattern(patternId: string): Promise<FailurePattern | undefined> {
    return this.data.failurePatterns.find(p => p.patternId === patternId);
  }

  async updateFailurePattern(patternId: string, updates: Partial<FailurePattern>): Promise<void> {
    const index = this.data.failurePatterns.findIndex(p => p.patternId === patternId);
    if (index >= 0) {
      this.data.failurePatterns[index] = {
        ...this.data.failurePatterns[index],
        ...updates,
        patternId: this.data.failurePatterns[index].patternId,
        lastSeen: now(),
        occurrences: this.data.failurePatterns[index].occurrences + 1,
      };
      await this.save();
    }
  }

  async queryFailurePatterns(environment?: string, minConfidence?: number): Promise<FailurePattern[]> {
    let results = [...this.data.failurePatterns];
    
    if (environment) {
      results = results.filter(p => p.environments.includes(environment));
    }
    if (minConfidence !== undefined) {
      results = results.filter(p => p.confidence >= minConfidence);
    }
    
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  async findMatchingFailurePattern(fingerprints: string[], environment?: string): Promise<FailurePattern | undefined> {
    let patterns = this.data.failurePatterns.filter(p => p.confidence >= 0.7);
    
    if (environment) {
      patterns = patterns.filter(p => p.environments.includes(environment));
    }
    
    for (const pattern of patterns) {
      const matches = pattern.fingerprints.filter(fp => fingerprints.includes(fp)).length;
      if (matches >= 2) { // At least 2 fingerprint matches
        return pattern;
      }
    }
    
    return undefined;
  }

  // ============ CANDIDATE LESSONS ============
  
  async addCandidateLesson(lesson: Omit<CandidateLesson, "lessonId" | "createdAt" | "lastConfirmedAt">): Promise<string> {
    const record: CandidateLesson = {
      ...lesson,
      lessonId: createId("lesson"),
      createdAt: now(),
      lastConfirmedAt: now(),
    };
    
    this.data.candidateLessons.push(record);
    await this.save();
    return record.lessonId;
  }

  async getCandidateLesson(lessonId: string): Promise<CandidateLesson | undefined> {
    return this.data.candidateLessons.find(l => l.lessonId === lessonId);
  }

  async updateCandidateLesson(lessonId: string, updates: Partial<CandidateLesson>): Promise<void> {
    const index = this.data.candidateLessons.findIndex(l => l.lessonId === lessonId);
    if (index >= 0) {
      this.data.candidateLessons[index] = {
        ...this.data.candidateLessons[index],
        ...updates,
        lessonId: this.data.candidateLessons[index].lessonId,
        lastConfirmedAt: now(),
      };
      await this.save();
    }
  }

  async queryCandidateLessons(status?: CandidateLesson["status"], type?: CandidateLesson["type"]): Promise<CandidateLesson[]> {
    let results = [...this.data.candidateLessons];
    
    if (status) {
      results = results.filter(l => l.status === status);
    }
    if (type) {
      results = results.filter(l => l.type === type);
    }
    
    return results.sort((a, b) => {
      const confidenceOrder = { "VERY_HIGH": 5, "HIGH": 4, "MEDIUM": 3, "LOW": 2, "VERY_LOW": 1 };
      return confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
    });
  }

  // ============ LEARNING CHECKPOINTS ============
  
  async createLearningCheckpoint(checkpoint: Omit<LearningCheckpoint, "checkpointId">): Promise<string> {
    const record: LearningCheckpoint = {
      ...checkpoint,
      checkpointId: createId("ckpt"),
    };
    
    this.data.learningCheckpoints.push(record);
    await this.save();
    return record.checkpointId;
  }

  async getLatestCheckpoint(): Promise<LearningCheckpoint | undefined> {
    const checkpoints = [...this.data.learningCheckpoints];
    checkpoints.sort((a, b) => b.lastLearningTimestamp.localeCompare(a.lastLearningTimestamp));
    return checkpoints[0];
  }

  async queryCheckpoints(limit = 10): Promise<LearningCheckpoint[]> {
    const checkpoints = [...this.data.learningCheckpoints];
    checkpoints.sort((a, b) => b.lastLearningTimestamp.localeCompare(a.lastLearningTimestamp));
    return checkpoints.slice(0, limit);
  }

  // ============ DAILY LEARNING REPORTS ============
  
  async addDailyLearningReport(report: Omit<DailyLearningReport, "reportId">): Promise<string> {
    const record: DailyLearningReport = {
      ...report,
      reportId: createId("report"),
    };
    
    this.data.dailyLearningReports.push(record);
    await this.save();
    return record.reportId;
  }

  async getDailyLearningReport(reportId: string): Promise<DailyLearningReport | undefined> {
    return this.data.dailyLearningReports.find(r => r.reportId === reportId);
  }

  async getLatestDailyLearningReport(): Promise<DailyLearningReport | undefined> {
    const reports = [...this.data.dailyLearningReports];
    reports.sort((a, b) => b.date.localeCompare(a.date));
    return reports[0];
  }

  async queryDailyLearningReports(limit = 30): Promise<DailyLearningReport[]> {
    const reports = [...this.data.dailyLearningReports];
    reports.sort((a, b) => b.date.localeCompare(a.date));
    return reports.slice(0, limit);
  }

  // ============ MAINTENANCE ============
  
  async pruneOldData(): Promise<{ experiencesPruned: number; patternsPruned: number; lessonsPruned: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
    const cutoffTimestamp = cutoffDate.toISOString();
    
    let experiencesPruned = 0;
    let patternsPruned = 0;
    let lessonsPruned = 0;
    
    // Prune old experiences (keep only VERIFIED ones)
    const originalExpCount = this.data.experiences.length;
    this.data.experiences = this.data.experiences.filter(e => 
      e.timestamp >= cutoffTimestamp || 
      e.outcome === "VERIFIED_SUCCESS" || 
      e.outcome === "VERIFIED_FAILURE"
    );
    experiencesPruned = originalExpCount - this.data.experiences.length;
    
    // Prune old failure patterns (keep recent or high confidence)
    const originalPatternCount = this.data.failurePatterns.length;
    this.data.failurePatterns = this.data.failurePatterns.filter(p => 
      p.lastSeen >= cutoffTimestamp || p.confidence >= 0.8
    );
    patternsPruned = originalPatternCount - this.data.failurePatterns.length;
    
    // Prune old candidate lessons (keep only CANDIDATE/VERIFIED or recent)
    const originalLessonCount = this.data.candidateLessons.length;
    this.data.candidateLessons = this.data.candidateLessons.filter(l => 
      l.lastConfirmedAt >= cutoffTimestamp || 
      l.status === "VERIFIED" ||
      l.status === "CANDIDATE"
    );
    lessonsPruned = originalLessonCount - this.data.candidateLessons.length;
    
    await this.save();
    
    return { experiencesPruned, patternsPruned, lessonsPruned };
  }

  async getStats(): Promise<{
    experiences: number;
    semanticKnowledge: number;
    proceduralKnowledge: number;
    performanceMetrics: number;
    failurePatterns: number;
    candidateLessons: number;
    checkpoints: number;
    reports: number;
  }> {
    return {
      experiences: this.data.experiences.length,
      semanticKnowledge: this.data.semanticKnowledge.filter(k => !k.retired).length,
      proceduralKnowledge: this.data.proceduralKnowledge.filter(p => !p.retired).length,
      performanceMetrics: this.data.performanceMetrics.length,
      failurePatterns: this.data.failurePatterns.length,
      candidateLessons: this.data.candidateLessons.length,
      checkpoints: this.data.learningCheckpoints.length,
      reports: this.data.dailyLearningReports.length,
    };
  }
}

export async function createExperienceStore(config: ExperienceStoreConfig): Promise<ExperienceStore> {
  const store = new ExperienceStore(config);
  await store.initialize();
  return store;
}