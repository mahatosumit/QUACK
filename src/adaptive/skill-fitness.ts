import { createId, now, type IsoTimestamp, type JsonObject } from "../core/types.js";
import { type EvidenceBackedExperience, type SkillAttribution } from "../cos/types.js";
import { type Permission } from "../security/permissions.js";
import { type SkillRecord } from "../skills/types.js";
import { SkillRegistry } from "../skills/registry.js";
import { type ToolRegistry } from "../tools/tool.js";
import { type AdaptiveLayer, type ImprovementProposal } from "./types.js";

export type SkillFitnessEvidenceStrength = "controlled_experiment" | "production_outcome" | "passive_correlation";
export type SkillReviewDecision = "HEALTHY" | "REVIEW_CANDIDATE" | "RETIREMENT_CANDIDATE" | "INSUFFICIENT_EVIDENCE";

export interface SkillFitnessContext {
  readonly objectiveId: string;
  readonly contextKey: string;
  readonly contextTags: readonly string[];
  readonly requiredTools: readonly string[];
  readonly strategyId?: string;
  readonly workflowId?: string;
}

export interface SkillFitness {
  readonly skillId: string;
  readonly skillVersion: string;
  readonly contextKey: string;
  readonly uses: number;
  readonly improved: number;
  readonly regressed: number;
  readonly unchanged: number;
  readonly inconclusive: number;
  readonly insufficientEvidence: number;
  readonly confidence: number;
  readonly lastEvaluated: IsoTimestamp;
  readonly evidenceRefs: readonly string[];
  readonly strengths: Record<SkillFitnessEvidenceStrength, number>;
  readonly stale: boolean;
}

export interface SkillFitnessUpdateResult {
  readonly updated: readonly SkillFitness[];
  readonly skippedExperienceIds: readonly string[];
}

export interface SkillSelectionCandidate {
  readonly skillId: string;
  readonly version: string;
  readonly versionKey: string;
  readonly source: SkillRecord["source"];
  readonly isDefault: boolean;
  readonly compatible: boolean;
  readonly safe: boolean;
  readonly lifecycle: SkillRecord["status"];
  readonly metadataScore: number;
  readonly fitnessScore: number;
  readonly confidence: number;
  readonly reasons: readonly string[];
  readonly fitness?: SkillFitness;
}

export interface SkillSelectionDecision {
  readonly id: string;
  readonly context: SkillFitnessContext;
  readonly selected: readonly SkillAttribution[];
  readonly alternatives: readonly SkillSelectionCandidate[];
  readonly reason: string;
  readonly confidence: number;
  readonly createdAt: IsoTimestamp;
}

export interface SkillReviewRecord {
  readonly id: string;
  readonly skillId: string;
  readonly skillVersion: string;
  readonly contextKey: string;
  readonly decision: SkillReviewDecision;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
  readonly replacementSkillId?: string;
  readonly createdAt: IsoTimestamp;
}

export interface FitnessReviewPolicy {
  readonly minUses?: number;
  readonly regressionThreshold?: number;
  readonly lowConfidenceUseThreshold?: number;
}

export class SkillFitnessIndex {
  private readonly fitness = new Map<string, SkillFitness>();
  private readonly reviewedExperienceIds = new Set<string>();
  private readonly reviews = new Map<string, SkillReviewRecord>();

  async rebuildFromExperiences(experiences: readonly EvidenceBackedExperience[]): Promise<SkillFitnessUpdateResult> {
    this.fitness.clear();
    this.reviewedExperienceIds.clear();
    return this.updateFromExperiences(experiences);
  }

  async updateFromExperiences(experiences: readonly EvidenceBackedExperience[]): Promise<SkillFitnessUpdateResult> {
    const skipped: string[] = [];
    const updatedKeys = new Set<string>();

    for (const experience of experiences) {
      if (this.reviewedExperienceIds.has(experience.id)) continue;
      const skills = experience.execution.selectedSkills;
      if (skills.length === 0) {
        skipped.push(experience.id);
        this.reviewedExperienceIds.add(experience.id);
        continue;
      }

      for (const skill of skills) {
        const context = contextFromExperience(experience);
        const key = fitnessKey(skill.skillId, skill.version ?? "unknown", context.contextKey);
        const previous = this.fitness.get(key);
        const next = incrementFitness(previous, skill, experience, context);
        this.fitness.set(key, next);
        updatedKeys.add(key);
      }
      this.reviewedExperienceIds.add(experience.id);
    }

    return {
      updated: [...updatedKeys].map((key) => this.fitness.get(key)!).filter(Boolean),
      skippedExperienceIds: skipped,
    };
  }

  updateFromExperience(experience: EvidenceBackedExperience): SkillFitnessUpdateResult {
    const skills = experience.execution.selectedSkills;
    if (skills.length === 0) {
      this.reviewedExperienceIds.add(experience.id);
      return { updated: [], skippedExperienceIds: [experience.id] };
    }

    const updated: SkillFitness[] = [];
    for (const skill of skills) {
      const context = contextFromExperience(experience);
      const key = fitnessKey(skill.skillId, skill.version ?? "unknown", context.contextKey);
      const next = incrementFitness(this.fitness.get(key), skill, experience, context);
      this.fitness.set(key, next);
      updated.push(next);
    }
    this.reviewedExperienceIds.add(experience.id);
    return { updated, skippedExperienceIds: [] };
  }

  get(skillId: string, skillVersion: string, contextKey: string): SkillFitness | undefined {
    const fitness = this.fitness.get(fitnessKey(skillId, skillVersion, contextKey));
    return fitness ? clone(fitness) : undefined;
  }

  list(): SkillFitness[] {
    return [...this.fitness.values()].map(clone);
  }

  review(policy: FitnessReviewPolicy = {}): SkillReviewRecord[] {
    const minUses = policy.minUses ?? 3;
    const regressionThreshold = policy.regressionThreshold ?? 0.5;
    const lowConfidenceUseThreshold = policy.lowConfidenceUseThreshold ?? 5;
    const records: SkillReviewRecord[] = [];

    for (const fitness of this.fitness.values()) {
      let decision: SkillReviewDecision = "HEALTHY";
      let reason = "Skill fitness is within review policy.";
      if (fitness.uses < minUses) {
        decision = "INSUFFICIENT_EVIDENCE";
        reason = "Not enough attributed uses for a review decision.";
      } else if (fitness.regressed / fitness.uses >= regressionThreshold) {
        decision = "REVIEW_CANDIDATE";
        reason = "Repeated contextual regressions meet the review threshold.";
      } else if (fitness.uses >= lowConfidenceUseThreshold && fitness.confidence < 0.35) {
        decision = "REVIEW_CANDIDATE";
        reason = "Usage is sufficient but contextual confidence remains low.";
      }

      const record: SkillReviewRecord = {
        id: createId("sreview"),
        skillId: fitness.skillId,
        skillVersion: fitness.skillVersion,
        contextKey: fitness.contextKey,
        decision,
        reason,
        evidenceRefs: [...fitness.evidenceRefs],
        createdAt: now(),
      };
      this.reviews.set(record.id, record);
      records.push(record);
    }

    return records;
  }

  recordRetirementCandidate(
    fitness: SkillFitness,
    reason: string,
    replacementSkillId?: string,
  ): SkillReviewRecord {
    const record: SkillReviewRecord = {
      id: createId("sreview"),
      skillId: fitness.skillId,
      skillVersion: fitness.skillVersion,
      contextKey: fitness.contextKey,
      decision: "RETIREMENT_CANDIDATE",
      reason,
      replacementSkillId,
      evidenceRefs: [...fitness.evidenceRefs],
      createdAt: now(),
    };
    this.reviews.set(record.id, record);
    return record;
  }

  listReviews(): SkillReviewRecord[] {
    return [...this.reviews.values()].map(clone);
  }
}

export class ContextualSkillSelector {
  constructor(
    private readonly deps: {
      readonly skills: SkillRegistry;
      readonly tools: ToolRegistry;
      readonly fitness: SkillFitnessIndex;
      readonly allowedPermissions: readonly Permission[];
      readonly maxSelected?: number;
      readonly shortlistSize?: number;
    },
  ) {}

  select(context: { readonly goal: string; readonly objectiveId?: string; readonly requiredTools?: readonly string[] }): SkillSelectionDecision {
    const selectionContext = createSkillFitnessContext(context.goal, {
      objectiveId: context.objectiveId,
      requiredTools: context.requiredTools,
    });
    const candidates = this.deps.skills.getAll()
      .map((record) => this.assess(record, selectionContext, context.goal))
      .filter((candidate) => candidate.compatible && candidate.safe)
      .sort(compareCandidates)
      .slice(0, this.deps.shortlistSize ?? 5);
    const selected = candidates
      .slice(0, this.deps.maxSelected ?? 1)
      .map((candidate) => ({
        skillId: candidate.skillId,
        version: candidate.version,
        source: candidate.source,
      }));

    return {
      id: createId("sselect"),
      context: selectionContext,
      selected,
      alternatives: candidates,
      reason: selected.length > 0
        ? `Selected ${selected.map((skill) => `${skill.skillId}@${skill.version ?? "unknown"}`).join(", ")} from compatible active skills.`
        : "No compatible active skill satisfied metadata, lifecycle, and safety filters.",
      confidence: candidates[0]?.confidence ?? 0,
      createdAt: now(),
    };
  }

  private assess(record: SkillRecord, context: SkillFitnessContext, goal: string): SkillSelectionCandidate {
    const metadataScore = metadataCompatibility(record, context, goal);
    const active = record.status === "active";
    const compatible = metadataScore > 0 && context.requiredTools.every((tool) => record.manifest.requiresTools.includes(tool));
    const safety = safetyCheck(record, this.deps.skills, this.deps.tools, this.deps.allowedPermissions);
    const fitness = this.deps.fitness.get(record.id, record.manifest.version, context.contextKey)
      ?? this.deps.fitness.get(record.id, record.manifest.version, objectiveOnlyContextKey(context.objectiveId));
    const fitnessScore = fitness ? scoreFitness(fitness) : 0;
    const reasons = [
      `${metadataScore} metadata token(s) matched`,
      fitness ? `fitness uses=${fitness.uses} confidence=${fitness.confidence.toFixed(2)}` : "no contextual fitness yet",
      active ? "active lifecycle" : `excluded lifecycle:${record.status}`,
      safety.safe ? "permissions/tools safe" : safety.reason,
    ];

    return {
      skillId: record.id,
      version: record.manifest.version,
      versionKey: record.versionKey,
      source: record.source,
      isDefault: record.isDefault,
      compatible,
      safe: active && safety.safe,
      lifecycle: record.status,
      metadataScore,
      fitnessScore,
      confidence: fitness?.confidence ?? 0,
      reasons,
      fitness,
    };
  }
}

export class SkillFitnessReviewLoop {
  private lastRunAt?: IsoTimestamp;
  private readonly proposedReviewKeys = new Set<string>();

  constructor(
    private readonly deps: {
      readonly experiences: { list(): Promise<EvidenceBackedExperience[]> };
      readonly fitness: SkillFitnessIndex;
      readonly skills: SkillRegistry;
      readonly adaptiveLayer: AdaptiveLayer;
    },
  ) {}

  async runReview(policy: FitnessReviewPolicy = {}): Promise<{ readonly updated: number; readonly proposals: readonly ImprovementProposal[]; readonly lastRunAt: IsoTimestamp }> {
    const experiences = await this.deps.experiences.list();
    const updated = await this.deps.fitness.updateFromExperiences(experiences);
    const reviews = this.deps.fitness.review(policy).filter((review) => review.decision === "REVIEW_CANDIDATE");
    const proposals: ImprovementProposal[] = [];

    for (const review of reviews) {
      const reviewKey = `${review.skillId}@${review.skillVersion}|${review.contextKey}`;
      if (this.proposedReviewKeys.has(reviewKey)) continue;
      const proposal: ImprovementProposal = {
        id: createId("ip"),
        type: "skill",
        target: review.skillId,
        description: `Review ${review.skillId}@${review.skillVersion} for context ${review.contextKey}.`,
        expectedImprovement: "Reduce repeated contextual regressions through revision, replacement, or retirement.",
        evidence: [...review.evidenceRefs],
        status: "proposed",
        score: Math.min(1, review.evidenceRefs.length / 5),
        createdAt: now(),
        appliedAt: null,
      };
      this.deps.adaptiveLayer.improvementScheduler.proposeImprovement(proposal);
      proposals.push(proposal);
      this.deps.skills.updateStatus(review.skillId, "review", review.skillVersion);
      this.proposedReviewKeys.add(reviewKey);
    }

    this.lastRunAt = now();
    return { updated: updated.updated.length, proposals, lastRunAt: this.lastRunAt };
  }
}

export function createSkillFitnessContext(
  goal: string,
  options: { readonly objectiveId?: string; readonly requiredTools?: readonly string[]; readonly strategyId?: string; readonly workflowId?: string } = {},
): SkillFitnessContext {
  const contextTags = tokenize(goal).slice(0, 6);
  return {
    objectiveId: options.objectiveId ?? "core.no-regression",
    contextKey: `${objectiveOnlyContextKey(options.objectiveId ?? "core.no-regression")}|tags:${contextTags.slice(0, 3).join("+")}`,
    contextTags,
    requiredTools: options.requiredTools ?? [],
    strategyId: options.strategyId,
    workflowId: options.workflowId,
  };
}

export function contextFromExperience(experience: EvidenceBackedExperience): SkillFitnessContext {
  const objectiveId = experience.objective.id;
  const tags = experience.execution.contextTags ?? [];
  return {
    objectiveId,
    contextKey: experience.execution.contextKey ?? objectiveOnlyContextKey(objectiveId),
    contextTags: tags,
    requiredTools: [],
    strategyId: experience.execution.strategyId,
    workflowId: experience.execution.workflowId,
  };
}

function incrementFitness(
  previous: SkillFitness | undefined,
  skill: SkillAttribution,
  experience: EvidenceBackedExperience,
  context: SkillFitnessContext,
): SkillFitness {
  const status = experience.evaluation.status;
  const strength = strengthOf(experience);
  const base: SkillFitness = previous ?? {
    skillId: skill.skillId,
    skillVersion: skill.version ?? "unknown",
    contextKey: context.contextKey,
    uses: 0,
    improved: 0,
    regressed: 0,
    unchanged: 0,
    inconclusive: 0,
    insufficientEvidence: 0,
    confidence: 0,
    lastEvaluated: experience.createdAt,
    evidenceRefs: [],
    strengths: { controlled_experiment: 0, production_outcome: 0, passive_correlation: 0 },
    stale: false,
  };
  const next = {
    ...base,
    uses: base.uses + 1,
    improved: base.improved + (status === "IMPROVED" ? 1 : 0),
    regressed: base.regressed + (status === "REGRESSED" ? 1 : 0),
    unchanged: base.unchanged + (status === "UNCHANGED" ? 1 : 0),
    inconclusive: base.inconclusive + (status === "INCONCLUSIVE" ? 1 : 0),
    insufficientEvidence: base.insufficientEvidence + (status === "INSUFFICIENT_EVIDENCE" ? 1 : 0),
    lastEvaluated: experience.createdAt,
    evidenceRefs: unique([...base.evidenceRefs, ...experience.evidence.map((evidence) => evidence.id)]),
    strengths: {
      ...base.strengths,
      [strength]: base.strengths[strength] + 1,
    },
    stale: isStale(experience.createdAt),
  };
  return {
    ...next,
    confidence: confidenceFor(next),
  };
}

function strengthOf(experience: EvidenceBackedExperience): SkillFitnessEvidenceStrength {
  const role = experience.execution.variant?.role;
  if (role === "candidate" || role === "control") return "controlled_experiment";
  if (experience.runId.startsWith("task_")) return "production_outcome";
  return "passive_correlation";
}

function confidenceFor(fitness: Omit<SkillFitness, "confidence">): number {
  const sampleConfidence = Math.min(1, fitness.uses / 5);
  const outcomeSignal = Math.abs(fitness.improved - fitness.regressed) / Math.max(1, fitness.uses);
  const strengthBoost = fitness.strengths.controlled_experiment > 0 ? 0.25 : fitness.strengths.production_outcome > 0 ? 0.1 : 0;
  const contradictionPenalty = fitness.improved > 0 && fitness.regressed > 0 ? 0.25 : 0;
  return Math.max(0, Math.min(1, sampleConfidence * (0.5 + outcomeSignal / 2) + strengthBoost - contradictionPenalty));
}

function scoreFitness(fitness: SkillFitness): number {
  const outcome = (fitness.improved - fitness.regressed) / Math.max(1, fitness.uses);
  const strength = fitness.strengths.controlled_experiment > 0 ? 0.4 : fitness.strengths.production_outcome > 0 ? 0.2 : 0;
  return outcome + fitness.confidence + strength;
}

function metadataCompatibility(record: SkillRecord, context: SkillFitnessContext, goal: string): number {
  const text = `${record.manifest.name} ${record.manifest.description} ${record.manifest.tags.join(" ")}`.toLowerCase();
  const tokens = unique([...tokenize(goal), ...context.contextTags]);
  return tokens.filter((token) => text.includes(token)).length;
}

function safetyCheck(record: SkillRecord, skills: SkillRegistry, tools: ToolRegistry, allowedPermissions: readonly Permission[]): { readonly safe: true; readonly reason: string } | { readonly safe: false; readonly reason: string } {
  const allowed = new Set(allowedPermissions);
  for (const permission of record.manifest.requiresPermissions) {
    if (isProhibitedPermission(permission)) return { safe: false, reason: `prohibited permission:${permission}` };
    if (allowed.size > 0 && !allowed.has(permission)) return { safe: false, reason: `permission not allowed:${permission}` };
  }
  for (const toolId of record.manifest.requiresTools) {
    if (!tools.get(toolId).ok) return { safe: false, reason: `tool not registered:${toolId}` };
  }
  for (const dependencyId of record.manifest.dependencies ?? []) {
    const dependency = skills.getRecord(dependencyId);
    if (!dependency) return { safe: false, reason: `dependency not registered:${dependencyId}` };
    if (dependency.status !== "active") return { safe: false, reason: `dependency not active:${dependencyId}` };
  }
  return { safe: true, reason: "safe" };
}

function compareCandidates(a: SkillSelectionCandidate, b: SkillSelectionCandidate): number {
  const scoreDelta = (b.fitnessScore + b.metadataScore) - (a.fitnessScore + a.metadataScore);
  if (scoreDelta !== 0) return scoreDelta;
  const confidenceDelta = b.confidence - a.confidence;
  if (confidenceDelta !== 0) return confidenceDelta;
  if (a.fitnessScore === 0 && b.fitnessScore === 0 && a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  return `${a.skillId}@${a.version}`.localeCompare(`${b.skillId}@${b.version}`);
}

function objectiveOnlyContextKey(objectiveId: string | undefined): string {
  return `objective:${objectiveId ?? "core.no-regression"}`;
}

function fitnessKey(skillId: string, version: string, contextKey: string): string {
  return `${skillId}@${version}|${contextKey}`;
}

function isStale(timestamp: string): boolean {
  const ageMs = Date.now() - new Date(timestamp).getTime();
  return Number.isFinite(ageMs) && ageMs > 180 * 24 * 60 * 60 * 1000;
}

function isProhibitedPermission(permission: Permission): boolean {
  return permission === "filesystem.write.external" ||
    permission === "secrets.read" ||
    permission === "secrets.write" ||
    permission === "plugin.install";
}

function tokenize(text: string): string[] {
  return unique(text.toLowerCase().split(/[^a-z0-9.-]+/).filter((part) => part.length > 2));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function selectionDecisionToJson(decision: SkillSelectionDecision): JsonObject {
  return clone(decision) as unknown as JsonObject;
}
