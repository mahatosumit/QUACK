/**
 * Skill Effectiveness Evaluation and Evolution
 * 
 * Tracks skill performance, generates lessons, and manages skill evolution
 * through verified evidence and owner approval.
 */

import { createId, now, type IsoTimestamp, ok, fail, type QuackResult } from "../core/types.js";
import { ExperienceStore } from "./experience-store.js";
import { ExperienceBroker } from "./experience-broker.js";
import { ExperienceRecord, SkillObservation, CandidateLesson, ProceduralKnowledge } from "./types.js";

export interface SkillEffectivenessConfig {
  readonly experienceStore: ExperienceStore;
  readonly experienceBroker: ExperienceBroker;
  readonly minSampleSize: number;
  readonly minVerifierPassRate: number;
}

export interface SkillEvaluationResult {
  readonly skillId: string;
  readonly skillVersion: string;
  readonly selectionCount: number;
  readonly verifiedSuccesses: number;
  readonly verifiedFailures: number;
  readonly verifierPassRate: number;
  readonly avgRetries: number;
  readonly avgDurationMs: number;
  readonly avgTokens: number;
  readonly avgCostUsd: number;
  readonly trend: "IMPROVING" | "STABLE" | "DECLINING";
  readonly lessons: string[];
  readonly recommendedAction: "CONTINUE" | "REVISE" | "DEPRECATE";
}

export interface SkillEvolutionProposal {
  readonly proposalId: string;
  readonly skillId: string;
  readonly currentVersion: string;
  readonly proposedVersion: string;
  readonly changes: SkillChange[];
  readonly supportingLessonIds: string[];
  readonly evidenceRefs: string[];
  readonly estimatedImpact: "LOW" | "MEDIUM" | "HIGH";
  readonly riskLevel: "LOW" | "MEDIUM" | "HIGH";
  readonly createdAt: string;
  readonly status: "DRAFT" | "PENDING_TESTS" | "PENDING_VERIFIER" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "IMPLEMENTED";
}

export interface SkillChange {
  readonly type: "ADD_STEP" | "REMOVE_STEP" | "MODIFY_STEP" | "ADD_TOOL" | "REMOVE_TOOL" | "MODIFY_CAPABILITY" | "MODIFY_WORKFLOW";
  readonly description: string;
  readonly rationale: string;
}

export class SkillEffectivenessEvaluator {
  private readonly config: SkillEffectivenessConfig;
  private readonly store: ExperienceStore;
  private readonly broker: ExperienceBroker;

  constructor(config: SkillEffectivenessConfig) {
    this.config = config;
    this.store = config.experienceStore;
    this.broker = config.experienceBroker;
  }

  async evaluateSkill(skillId: string): Promise<QuackResult<SkillEvaluationResult>> {
    try {
      // Get experiences using this skill
      const experiencesResult = await this.broker.searchExperiences({ limit: 10000 });
      if (!experiencesResult.ok) return fail(experiencesResult.error);
      
      // Filter experiences that used this skill
      const skillExperiences = experiencesResult.data.filter(exp => exp.skills.includes(skillId));
      
      if (skillExperiences.length === 0) {
        return ok({
          skillId,
          skillVersion: "1.0.0",
          selectionCount: 0,
          verifiedSuccesses: 0,
          verifiedFailures: 0,
          verifierPassRate: 0,
          avgRetries: 0,
          avgDurationMs: 0,
          avgTokens: 0,
          avgCostUsd: 0,
          trend: "STABLE",
          lessons: [],
          recommendedAction: "CONTINUE",
        });
      }

      // Aggregate metrics from experiences
      const totalSelections = skillExperiences.length;
      const totalSuccesses = skillExperiences.filter(e => e.outcome === "VERIFIED_SUCCESS").length;
      const totalFailures = skillExperiences.filter(e => e.outcome === "VERIFIED_FAILURE").length;
      const avgPassRate = totalSelections > 0 ? (totalSuccesses / totalSelections) * 100 : 0;
      const avgRetries = skillExperiences.reduce((sum, e) => sum + e.retries, 0) / totalSelections;
      const avgDuration = skillExperiences.reduce((sum, e) => sum + e.durationMs, 0) / totalSelections;
      const avgTokens = skillExperiences.reduce((sum, e) => sum + e.tokens.total, 0) / totalSelections;
      const avgCost = skillExperiences.reduce((sum, e) => sum + e.costUsd, 0) / totalSelections;

      // Determine trend by comparing recent vs older experiences
      const sorted = [...skillExperiences].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      const recent = sorted.slice(0, Math.min(10, sorted.length));
      const older = sorted.slice(10);
      const recentPassRate = recent.length > 0 ? (recent.filter(e => e.outcome === "VERIFIED_SUCCESS").length / recent.length) * 100 : 0;
      const olderPassRate = older.length > 0 ? (older.filter(e => e.outcome === "VERIFIED_SUCCESS").length / older.length) * 100 : 0;
      
      let trend: "IMPROVING" | "STABLE" | "DECLINING" = "STABLE";
      if (recentPassRate > olderPassRate + 5) trend = "IMPROVING";
      else if (recentPassRate < olderPassRate - 5) trend = "DECLINING";

      // Generate lessons from evaluation
      const lessons: string[] = [];
      if (avgPassRate < this.config.minVerifierPassRate) {
        lessons.push(`Verifier pass rate (${avgPassRate.toFixed(1)}%) below threshold (${this.config.minVerifierPassRate}%)`);
      }
      if (avgRetries > 3) {
        lessons.push(`Average retries (${avgRetries.toFixed(1)}) is high - consider improving error handling`);
      }
      if (trend === "DECLINING") {
        lessons.push(`Performance declining - recent pass rate ${recentPassRate.toFixed(1)}% vs older ${olderPassRate.toFixed(1)}%`);
      }

      // Determine recommended action
      let recommendedAction: "CONTINUE" | "REVISE" | "DEPRECATE" = "CONTINUE";
      if (avgPassRate < this.config.minVerifierPassRate - 10 || trend === "DECLINING") {
        recommendedAction = "REVISE";
      }
      if (totalSelections >= this.config.minSampleSize && avgPassRate < 30) {
        recommendedAction = "DEPRECATE";
      }

      return ok({
        skillId,
        skillVersion: "1.0.0", // Would come from registry
        selectionCount: totalSelections,
        verifiedSuccesses: totalSuccesses,
        verifiedFailures: totalFailures,
        verifierPassRate: avgPassRate,
        avgRetries,
        avgDurationMs: avgDuration,
        avgTokens,
        avgCostUsd: avgCost,
        trend,
        lessons,
        recommendedAction,
      });
    } catch (error) {
      return fail({
        code: "skill.evaluate_failed",
        message: error instanceof Error ? error.message : String(error),
        category: "runtime",
        recoverable: true,
      });
    }
  }

  async evaluateAllSkills(): Promise<QuackResult<SkillEvaluationResult[]>> {
    try {
      // Get all unique skill IDs from experiences
      const experiencesResult = await this.broker.searchExperiences({ limit: 10000 });
      if (!experiencesResult.ok) return fail(experiencesResult.error);
      
      const skillIds = new Set<string>();
      for (const exp of experiencesResult.data) {
        for (const skill of exp.skills) {
          skillIds.add(skill);
        }
      }
      
      const results: SkillEvaluationResult[] = [];
      for (const skillId of skillIds) {
        const result = await this.evaluateSkill(skillId);
        if (result.ok) {
          results.push(result.data);
        }
      }
      
      return ok(results);
    } catch (error) {
      return fail({
        code: "skill.evaluate_all_failed",
        message: error instanceof Error ? error.message : String(error),
        category: "runtime",
        recoverable: true,
      });
    }
  }

  async generateSkillLessons(): Promise<QuackResult<string[]>> {
    try {
      const evaluations = await this.evaluateAllSkills();
      if (!evaluations.ok) return fail(evaluations.error);
      
      const lessons: string[] = [];
      for (const evalResult of evaluations.data) {
        lessons.push(...evalResult.lessons);
      }
      
      return ok(lessons);
    } catch (error) {
      return fail({
        code: "skill.generate_lessons_failed",
        message: error instanceof Error ? error.message : String(error),
        category: "runtime",
        recoverable: true,
      });
    }
  }
}

export class SkillEvolutionManager {
  private readonly config: SkillEffectivenessConfig;
  private readonly store: ExperienceStore;
  private readonly broker: ExperienceBroker;
  private readonly proposals = new Map<string, SkillEvolutionProposal>();

  constructor(config: SkillEffectivenessConfig) {
    this.config = config;
    this.store = config.experienceStore;
    this.broker = config.experienceBroker;
  }

  async proposeRevision(skillId: string, changes: SkillChange[], supportingLessonIds: string[]): Promise<QuackResult<SkillEvolutionProposal>> {
    try {
      // Get current skill version from registry (placeholder)
      const currentVersion = "1.0.0";
      const proposedVersion = this.incrementVersion(currentVersion, changes);
      
      const proposal: SkillEvolutionProposal = {
        proposalId: `prop-${Date.now()}`,
        skillId,
        currentVersion,
        proposedVersion,
        changes,
        supportingLessonIds,
        evidenceRefs: [], // Would gather from lessons
        estimatedImpact: this.estimateImpact(changes),
        riskLevel: this.assessRisk(changes),
        createdAt: new Date().toISOString(),
        status: "DRAFT",
      };
      
      this.proposals.set(proposal.proposalId, proposal);
      
      return ok(proposal);
    } catch (error) {
      return fail({
        code: "skill.propose_revision_failed",
        message: error instanceof Error ? error.message : String(error),
        category: "runtime",
        recoverable: true,
      });
    }
  }

  async submitForTesting(proposalId: string): Promise<QuackResult<SkillEvolutionProposal>> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return fail({
      code: "skill.proposal_not_found",
      message: `Proposal ${proposalId} not found`,
      category: "validation",
      recoverable: false,
    });
    
    const updatedProposal = { ...proposal, status: "PENDING_TESTS" as const };
    this.proposals.set(proposalId, updatedProposal);
    // In real implementation, would run skill tests
    const updatedProposal2 = { ...updatedProposal, status: "PENDING_VERIFIER" as const };
    this.proposals.set(proposalId, updatedProposal2);
    
    return ok(updatedProposal2);
  }

  async submitForVerification(proposalId: string): Promise<QuackResult<SkillEvolutionProposal>> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return fail({
      code: "skill.proposal_not_found",
      message: `Proposal ${proposalId} not found`,
      category: "validation",
      recoverable: false,
    });
    
    // In real implementation, would run independent verifier
    const updatedProposal = { ...proposal, status: "PENDING_APPROVAL" as const };
    this.proposals.set(proposalId, updatedProposal);
    
    return ok(updatedProposal);
  }

  async submitForApproval(proposalId: string): Promise<QuackResult<SkillEvolutionProposal>> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return fail({
      code: "skill.proposal_not_found",
      message: `Proposal ${proposalId} not found`,
      category: "validation",
      recoverable: false,
    });
    
    // Requires owner approval
    const updatedProposal = { ...proposal, status: "PENDING_APPROVAL" as const };
    this.proposals.set(proposalId, updatedProposal);
    
    return ok(updatedProposal);
  }

  async approve(proposalId: string): Promise<QuackResult<SkillEvolutionProposal>> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return fail({
      code: "skill.proposal_not_found",
      message: `Proposal ${proposalId} not found`,
      category: "validation",
      recoverable: false,
    });
    
    if (proposal.status !== "PENDING_APPROVAL") {
      return fail({
        code: "skill.invalid_proposal_status",
        message: `Proposal must be in PENDING_APPROVAL status`,
        category: "validation",
        recoverable: false,
      });
    }
    
    const updatedProposal = { ...proposal, status: "APPROVED" as const };
    this.proposals.set(proposalId, updatedProposal);
    
    return ok(updatedProposal);
  }

  async implement(proposalId: string): Promise<QuackResult<SkillEvolutionProposal>> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return fail({
      code: "skill.proposal_not_found",
      message: `Proposal ${proposalId} not found`,
      category: "validation",
      recoverable: false,
    });
    
    if (proposal.status !== "APPROVED") {
      return fail({
        code: "skill.invalid_proposal_status",
        message: `Proposal must be APPROVED before implementation`,
        category: "validation",
        recoverable: false,
      });
    }
    
    // In real implementation, would update skill registry
    // For now, just mark as implemented
    const updatedProposal = { ...proposal, status: "IMPLEMENTED" as const };
    this.proposals.set(proposalId, updatedProposal);
    
    // Create procedural knowledge from the changes
    await this.store.addProceduralKnowledge({
      name: `Skill ${proposal.skillId} v${proposal.proposedVersion}`,
      version: parseInt(proposal.proposedVersion.split(".")[0]) || 1,
      steps: proposal.changes.map(c => ({
        stepId: `step-${Date.now()}`,
        description: `${c.type}: ${c.description}`,
        expectedOutcome: c.rationale,
        verification: undefined,
        fallback: undefined,
      })),
      applicableContexts: [proposal.skillId],
      sourceExperienceIds: proposal.supportingLessonIds,
      evidenceRefs: proposal.evidenceRefs,
      confidence: 0.8,
      trustLevel: "LOCALLY_VERIFIED",
      retired: false,
    });
    
    return ok(updatedProposal);
  }

  getProposal(proposalId: string): SkillEvolutionProposal | undefined {
    return this.proposals.get(proposalId);
  }

  listProposals(status?: SkillEvolutionProposal["status"]): SkillEvolutionProposal[] {
    const proposals = [...this.proposals.values()];
    if (status) {
      return proposals.filter(p => p.status === status);
    }
    return proposals;
  }

  private incrementVersion(current: string, changes: SkillChange[]): string {
    const parts = current.split(".").map(Number);
    // Major change if structural, minor if functional, patch if bug fix
    const hasMajor = changes.some(c => c.type === "ADD_STEP" || c.type === "REMOVE_STEP" || c.type === "MODIFY_CAPABILITY");
    if (hasMajor) {
      parts[0] += 1;
      parts[1] = 0;
      parts[2] = 0;
    } else {
      parts[2] += 1;
    }
    return parts.join(".");
  }

  private estimateImpact(changes: SkillChange[]): "LOW" | "MEDIUM" | "HIGH" {
    if (changes.some(c => c.type === "REMOVE_STEP" || c.type === "MODIFY_CAPABILITY")) return "HIGH";
    if (changes.some(c => c.type === "ADD_STEP" || c.type === "MODIFY_STEP")) return "MEDIUM";
    return "LOW";
  }

  private assessRisk(changes: SkillChange[]): "LOW" | "MEDIUM" | "HIGH" {
    if (changes.some(c => c.type === "REMOVE_STEP" || c.type === "REMOVE_TOOL" || c.type === "MODIFY_CAPABILITY")) return "HIGH";
    if (changes.some(c => c.type === "MODIFY_STEP" || c.type === "MODIFY_WORKFLOW")) return "MEDIUM";
    return "LOW";
  }
}

export function createSkillEffectivenessEvaluator(config: SkillEffectivenessConfig): SkillEffectivenessEvaluator {
  return new SkillEffectivenessEvaluator(config);
}

export function createSkillEvolutionManager(config: SkillEffectivenessConfig): SkillEvolutionManager {
  return new SkillEvolutionManager(config);
}