import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createId, now, type IsoTimestamp } from "../core/types.js";
import { isMissingFile, atomicWriteFile } from "../core/utils.js";
import { type EventBus } from "../events/event-bus.js";
import { type EvidenceBackedExperience, type EvidenceExperienceStore, type ObjectiveSpecification } from "../cos/index.js";
import { ObjectiveRegistry } from "../cos/objectives.js";
import { type SkillRecord } from "../skills/types.js";
import { SkillRegistry } from "../skills/registry.js";
import { type ToolRegistry } from "../tools/tool.js";
import { type AdaptiveLayer, type ImprovementProposal } from "./types.js";
import {
  EvidenceDrivenSkillEvolution,
  type CandidateSkill,
  type CapabilityGap,
  type EvidenceBackedHypothesis,
  type EvidenceBackedSkillProposal,
  type SkillEvolutionExperiment,
  type SkillExperimentDecision,
} from "./evidence-driven-skill-evolution.js";
import { SkillFitnessIndex, type FitnessReviewPolicy, type SkillFitness } from "./skill-fitness.js";

export type ImprovementReviewKind =
  | "degraded_skill"
  | "capability_gap"
  | "candidate_revision"
  | "retirement_candidate"
  | "insufficient_evidence"
  | "experiment_request"
  | "quarantine_candidate";

export type ImprovementReviewStatus = "queued" | "running" | "completed" | "deferred" | "rejected" | "cancelled";
export type ImprovementDecision = SkillExperimentDecision | "KEEP" | "RETIRE" | "QUARANTINE";
export type ImprovementRisk = "SAFE_AUTOMATIC" | "REQUIRES_APPROVAL" | "PROHIBITED_AUTONOMOUSLY";

/**
 * An explicitly authored hand-off from an improvement review to the controlled
 * self-modification gate.  Ordinary review items intentionally omit this: a
 * skill or capability observation is not itself permission to propose code.
 */
export interface ActionableCodeProposalCandidate {
  readonly sourceEvidenceRefs: readonly string[];
  readonly hypothesis: string;
  readonly targetScope: readonly string[];
  readonly expectedFiles: readonly string[];
  readonly description: string;
}

export interface ImprovementReviewItem {
  readonly id: string;
  readonly key: string;
  readonly kind: ImprovementReviewKind;
  readonly status: ImprovementReviewStatus;
  readonly objectiveId: string;
  readonly contextKey?: string;
  readonly affectedSkillId?: string;
  readonly affectedSkillVersion?: string;
  readonly priority: number;
  readonly risk: ImprovementRisk;
  readonly evidenceRefs: readonly string[];
  readonly hypothesisId?: string;
  readonly capabilityGapId?: string;
  readonly proposalId?: string;
  readonly candidateId?: string;
  readonly experimentIds: readonly string[];
  readonly decision?: ImprovementDecision;
  /** Optional, explicit code-change candidate. Never inferred from prose. */
  readonly codeProposal?: ActionableCodeProposalCandidate;
  readonly reason: string;
  readonly retries: number;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface ImprovementCycleCheckpoint {
  readonly lastProcessedExperienceId?: string;
  readonly lastProcessedAt?: IsoTimestamp;
  readonly processedExperienceIds: readonly string[];
  readonly reviewItems: readonly ImprovementReviewItem[];
  readonly running: boolean;
  readonly lastCycleId?: string;
  readonly lastCycleAt?: IsoTimestamp;
}

export interface ImprovementCycleResult {
  readonly cycleId: string;
  readonly processedExperienceIds: readonly string[];
  readonly reviewItemsCreated: readonly ImprovementReviewItem[];
  readonly experimentsQueued: readonly ImprovementReviewItem[];
  readonly experimentsCompleted: readonly SkillEvolutionExperiment[];
  readonly decisions: readonly ImprovementDecision[];
  readonly checkpoint: ImprovementCycleCheckpoint;
}

export interface ImprovementCycleLimits {
  readonly maxExperiences?: number;
  readonly maxReviewItems?: number;
  readonly maxExperiments?: number;
  readonly maxCandidateRevisions?: number;
  readonly maxRetries?: number;
}

export interface EvidenceImprovementCyclePolicy extends FitnessReviewPolicy {
  readonly limits?: ImprovementCycleLimits;
  readonly autoRetireReplacedSkills?: boolean;
  readonly rollbackToParentOnRegression?: boolean;
  readonly detectCapabilityGaps?: boolean;
  readonly runExperiments?: boolean;
  readonly fixtures?: SkillExperimentFixtureProvider;
}

export interface SkillExperimentFixtureRequest {
  readonly item: ImprovementReviewItem;
  readonly candidate: CandidateSkill;
  readonly objective: ObjectiveSpecification;
  readonly proposal: EvidenceBackedSkillProposal;
}

export interface SkillExperimentFixtures {
  readonly baseline?: EvidenceBackedExperience;
  readonly control: EvidenceBackedExperience;
  readonly candidateExperience: EvidenceBackedExperience;
}

export type SkillExperimentFixtureProvider = (request: SkillExperimentFixtureRequest) => SkillExperimentFixtures | undefined;

export interface ImprovementCycleStateStore {
  load(): Promise<ImprovementCycleCheckpoint>;
  save(checkpoint: ImprovementCycleCheckpoint): Promise<void>;
}

const DEFAULT_LIMITS: Required<ImprovementCycleLimits> = {
  maxExperiences: 50,
  maxReviewItems: 10,
  maxExperiments: 2,
  maxCandidateRevisions: 1,
  maxRetries: 1,
};

const EMPTY_CHECKPOINT: ImprovementCycleCheckpoint = {
  processedExperienceIds: [],
  reviewItems: [],
  running: false,
};

export class InMemoryImprovementCycleStateStore implements ImprovementCycleStateStore {
  private checkpoint: ImprovementCycleCheckpoint = EMPTY_CHECKPOINT;

  async load(): Promise<ImprovementCycleCheckpoint> {
    return clone(this.checkpoint);
  }

  async save(checkpoint: ImprovementCycleCheckpoint): Promise<void> {
    this.checkpoint = clone(checkpoint);
  }
}

export class JsonFileImprovementCycleStateStore implements ImprovementCycleStateStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<ImprovementCycleCheckpoint> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return normalizeCheckpoint(JSON.parse(raw) as Partial<ImprovementCycleCheckpoint>);
    } catch (error) {
      if (isMissingFile(error)) return clone(EMPTY_CHECKPOINT);
      throw error;
    }
  }

  async save(checkpoint: ImprovementCycleCheckpoint): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await atomicWriteFile(this.filePath, JSON.stringify(normalizeCheckpoint(checkpoint), null, 2));
  }
}

export class EvidenceImprovementCycle {
  private inProcess = false;

  constructor(
    private readonly deps: {
      readonly experiences: EvidenceExperienceStore;
      readonly fitness: SkillFitnessIndex;
      readonly skillEvolution: EvidenceDrivenSkillEvolution;
      readonly skills: SkillRegistry;
      readonly tools: ToolRegistry;
      readonly adaptiveLayer: AdaptiveLayer;
      readonly objectives: ObjectiveRegistry;
      readonly state: ImprovementCycleStateStore;
      readonly events?: EventBus;
      readonly fixtures?: SkillExperimentFixtureProvider;
    },
  ) {}

  async runImprovementCycle(policy: EvidenceImprovementCyclePolicy = {}): Promise<ImprovementCycleResult> {
    if (this.inProcess) {
      const checkpoint = await this.deps.state.load();
      return {
        cycleId: checkpoint.lastCycleId ?? "cycle-in-progress",
        processedExperienceIds: [],
        reviewItemsCreated: [],
        experimentsQueued: [],
        experimentsCompleted: [],
        decisions: [],
        checkpoint,
      };
    }

    this.inProcess = true;
    const cycleId = createId("imcycle");
    await this.deps.events?.emit("improvement.cycle.started", { cycleId }, { actor: "adaptive-improvement" });

    try {
      const limits = { ...DEFAULT_LIMITS, ...(policy.limits ?? {}) };
      const initial = normalizeCheckpoint(await this.deps.state.load());
      const started = { ...initial, running: true, lastCycleId: cycleId, lastCycleAt: now() };
      await this.deps.state.save(started);

      const allExperiences = await this.deps.experiences.list();
      const processed = new Set(started.processedExperienceIds);
      const newExperiences = allExperiences
        .filter((experience) => !processed.has(experience.id))
        .slice(0, limits.maxExperiences);

      await this.deps.fitness.updateFromExperiences(newExperiences);
      const unsafeItems = this.reviewUnsafeSkills(started.reviewItems, limits.maxReviewItems);
      const degradedItems = this.reviewDegradedSkills(
        [...started.reviewItems, ...unsafeItems],
        policy,
        limits.maxReviewItems - unsafeItems.length,
      );
      const gapItems = policy.detectCapabilityGaps === false
        ? []
        : await this.reviewCapabilityGaps(
          [...started.reviewItems, ...unsafeItems, ...degradedItems],
          newExperiences.length > 0,
          limits.maxReviewItems - unsafeItems.length - degradedItems.length,
        );

      const reviewItems = [...started.reviewItems, ...unsafeItems, ...degradedItems, ...gapItems];
      const experimentQueue = reviewItems
        .filter((item) => item.status === "queued" && item.risk === "SAFE_AUTOMATIC")
        .sort(compareReviewItems)
        .slice(0, policy.runExperiments === false ? 0 : limits.maxExperiments);

      const experimentsCompleted: SkillEvolutionExperiment[] = [];
      const decisions: ImprovementDecision[] = [];
      let revisionsUsed = 0;
      let nextItems = reviewItems;

      for (const queued of experimentQueue) {
        if (queued.kind === "degraded_skill" && revisionsUsed >= limits.maxCandidateRevisions) {
          nextItems = updateItem(nextItems, queued.key, {
            status: "deferred",
            decision: "COLLECT_MORE_DATA",
            reason: "Candidate revision budget for this cycle is exhausted.",
          });
          decisions.push("COLLECT_MORE_DATA");
          continue;
        }

        const processedItem = await this.processExperimentRequest(queued, limits, policy);
        nextItems = updateItem(nextItems, queued.key, processedItem.item);
        if (processedItem.experiment) experimentsCompleted.push(processedItem.experiment);
        if (processedItem.item.decision) decisions.push(processedItem.item.decision);
        if (queued.kind === "degraded_skill") revisionsUsed++;
      }

      const nextProcessed = unique([...started.processedExperienceIds, ...newExperiences.map((experience) => experience.id)]);
      const lastExperience = newExperiences[newExperiences.length - 1];
      const checkpoint: ImprovementCycleCheckpoint = {
        lastProcessedExperienceId: lastExperience?.id ?? started.lastProcessedExperienceId,
        lastProcessedAt: lastExperience?.createdAt ?? started.lastProcessedAt,
        processedExperienceIds: nextProcessed,
        reviewItems: nextItems,
        running: false,
        lastCycleId: cycleId,
        lastCycleAt: now(),
      };
      await this.deps.state.save(checkpoint);
      await this.deps.events?.emit("improvement.cycle.completed", {
        cycleId,
        processed: newExperiences.length,
        created: unsafeItems.length + degradedItems.length + gapItems.length,
        experiments: experimentsCompleted.length,
      }, { actor: "adaptive-improvement" });

      return {
        cycleId,
        processedExperienceIds: newExperiences.map((experience) => experience.id),
        reviewItemsCreated: [...unsafeItems, ...degradedItems, ...gapItems],
        experimentsQueued: experimentQueue,
        experimentsCompleted,
        decisions,
        checkpoint,
      };
    } finally {
      this.inProcess = false;
    }
  }

  private reviewUnsafeSkills(existing: readonly ImprovementReviewItem[], maxItems: number): ImprovementReviewItem[] {
    const created: ImprovementReviewItem[] = [];
    for (const skill of this.deps.skills.getAll()) {
      if (created.length >= maxItems) break;
      if (skill.status !== "active") continue;
      if (skill.source === "builtin") continue;
      const reason = unsafeSkillReason(skill, this.deps.skills, this.deps.tools);
      if (!reason) continue;
      const key = `quarantine:${skill.id}@${skill.manifest.version}`;
      if (existing.some((item) => item.key === key)) continue;
      this.deps.skills.quarantine(skill.id, reason, [], { version: skill.manifest.version });
      created.push(createReviewItem({
        key,
        kind: "quarantine_candidate",
        status: "completed",
        objectiveId: "core.safety",
        affectedSkillId: skill.id,
        affectedSkillVersion: skill.manifest.version,
        priority: 1,
        risk: "PROHIBITED_AUTONOMOUSLY",
        evidenceRefs: [],
        decision: "QUARANTINE",
        reason,
      }));
    }
    return created;
  }

  private reviewDegradedSkills(
    existing: readonly ImprovementReviewItem[],
    policy: EvidenceImprovementCyclePolicy,
    maxItems: number,
  ): ImprovementReviewItem[] {
    const records = this.deps.fitness.review(policy).filter((review) => review.decision === "REVIEW_CANDIDATE");
    const created: ImprovementReviewItem[] = [];
    for (const review of records) {
      if (created.length >= maxItems) break;
      const key = `degraded:${review.skillId}@${review.skillVersion}|${review.contextKey}`;
      if (existing.some((item) => item.key === key)) continue;
      const fitness = this.deps.fitness.get(review.skillId, review.skillVersion, review.contextKey);
      const priority = fitness ? priorityForFitness(fitness) : 0.5;
      const degradedRecord = this.deps.skills.getRecord(review.skillId, review.skillVersion);
      if (policy.rollbackToParentOnRegression && degradedRecord?.parentVersion) {
        this.deps.skills.rollback(review.skillId, degradedRecord.parentVersion, "Repeated regressions triggered rollback to parent version.", {
          evidenceRefs: review.evidenceRefs,
          previousVersion: review.skillVersion,
        });
        created.push(createReviewItem({
          key,
          kind: "degraded_skill",
          status: "completed",
          objectiveId: "core.no-regression",
          contextKey: review.contextKey,
          affectedSkillId: review.skillId,
          affectedSkillVersion: review.skillVersion,
          priority,
          risk: "SAFE_AUTOMATIC",
          evidenceRefs: review.evidenceRefs,
          decision: "REVISE",
          reason: `Rolled back ${review.skillId}@${review.skillVersion} to parent ${degradedRecord.parentVersion}.`,
        }));
        continue;
      }
      const item = createReviewItem({
        key,
        kind: "degraded_skill",
        status: "queued",
        objectiveId: "core.no-regression",
        contextKey: review.contextKey,
        affectedSkillId: review.skillId,
        affectedSkillVersion: review.skillVersion,
        priority,
        risk: "SAFE_AUTOMATIC",
        evidenceRefs: review.evidenceRefs,
        reason: review.reason,
      });
      this.deps.skills.updateStatus(review.skillId, "review", review.skillVersion);
      this.deps.adaptiveLayer.improvementScheduler.proposeImprovement(toProposal(item));
      created.push(item);
    }
    return created;
  }

  private async reviewCapabilityGaps(
    existing: readonly ImprovementReviewItem[],
    shouldReview: boolean,
    maxItems: number,
  ): Promise<ImprovementReviewItem[]> {
    if (!shouldReview || maxItems <= 0) return [];
    const patterns = await this.deps.skillEvolution.detectFailurePatterns();
    const created: ImprovementReviewItem[] = [];
    for (const pattern of patterns) {
      if (created.length >= maxItems) break;
      if (pattern.attribution.selectedSkills.length > 0) continue;
      const key = `gap:${pattern.key}`;
      if (existing.some((item) => item.key === key)) continue;
      const objective = this.deps.objectives.get(pattern.objectiveId);
      if (!objective) continue;
      const hypothesis = this.deps.skillEvolution.createHypothesis(pattern, objective);
      const gap = this.deps.skillEvolution.identifyCapabilityGap({
        hypothesis,
        pattern,
        neededBehavior: `Address repeated ${pattern.dimension}.`,
        requiredTools: [],
        triggerContext: [pattern.dimension],
      });
      if (gap.status !== "open") continue;
      const proposal = this.deps.skillEvolution.proposeSkillFromGap(gap, hypothesis);
      if (!proposal) continue;
      const candidate = this.deps.skillEvolution.createCandidateSkill(proposal);
      const risk = classifyCandidateRisk(candidate);
      const item = createReviewItem({
        key,
        kind: "capability_gap",
        status: risk === "SAFE_AUTOMATIC" ? "queued" : "rejected",
        objectiveId: objective.id,
        priority: pattern.confidence,
        risk,
        evidenceRefs: pattern.supportingExperienceIds,
        hypothesisId: hypothesis.id,
        capabilityGapId: gap.id,
        proposalId: proposal.id,
        candidateId: candidate.id,
        decision: risk === "SAFE_AUTOMATIC" ? undefined : "REQUIRE_HUMAN_REVIEW",
        reason: risk === "SAFE_AUTOMATIC"
          ? "Open capability gap is safe to evaluate with bounded candidate experiment."
          : "Capability gap candidate is not safe for autonomous execution.",
      });
      this.deps.adaptiveLayer.improvementScheduler.proposeImprovement(toProposal(item));
      created.push(item);
    }
    return created;
  }

  private async processExperimentRequest(
    item: ImprovementReviewItem,
    limits: Required<ImprovementCycleLimits>,
    policy: EvidenceImprovementCyclePolicy,
  ): Promise<{ readonly item: Partial<ImprovementReviewItem>; readonly experiment?: SkillEvolutionExperiment }> {
    if (item.retries >= limits.maxRetries) {
      return {
        item: {
          status: "deferred",
          decision: "COLLECT_MORE_DATA",
          reason: "Retry budget exhausted; waiting for more comparable evidence.",
        },
      };
    }

    const objective = this.deps.objectives.get(item.objectiveId);
    if (!objective) {
      return { item: { status: "rejected", decision: "REQUIRE_HUMAN_REVIEW", reason: `Objective ${item.objectiveId} is not registered.` } };
    }

    const proposal = item.proposalId
      ? this.deps.skillEvolution.getProposals().find((candidateProposal) => candidateProposal.id === item.proposalId)
      : this.createRevisionProposal(item, objective);
    if (!proposal) {
      return { item: { status: "deferred", decision: "COLLECT_MORE_DATA", reason: "No safe proposal could be created." } };
    }

    const candidate = item.candidateId
      ? this.deps.skillEvolution.getCandidate(item.candidateId)
      : this.createRevisionCandidate(item, proposal);
    if (!candidate) {
      return { item: { status: "deferred", decision: "COLLECT_MORE_DATA", reason: "No candidate is available for experiment." } };
    }

    const risk = classifyCandidateRisk(candidate);
    if (risk !== "SAFE_AUTOMATIC") {
      return {
        item: {
          status: "rejected",
          risk,
          decision: "REQUIRE_HUMAN_REVIEW",
          proposalId: proposal.id,
          candidateId: candidate.id,
          reason: "Candidate is not safe for autonomous experiment.",
          retries: item.retries + 1,
        },
      };
    }

    const fixtures = (policy.fixtures ?? this.deps.fixtures)?.({ item, candidate, objective, proposal });
    if (!fixtures) {
      return {
        item: {
          status: "deferred",
          decision: "COLLECT_MORE_DATA",
          proposalId: proposal.id,
          candidateId: candidate.id,
          reason: "No bounded experiment fixture is available; waiting for more evidence.",
          retries: item.retries + 1,
        },
      };
    }

    await this.deps.events?.emit("experiment.queued", { itemId: item.id, candidateId: candidate.id }, { actor: "adaptive-improvement" });
    const validation = this.deps.skillEvolution.validateCandidateSkill(candidate);
    const candidateWithValidation = { ...candidate, validation };
    const experiment = this.deps.skillEvolution.runControlCandidateExperiment({
      candidate: candidateWithValidation,
      objective,
      baseline: fixtures.baseline,
      control: fixtures.control,
      candidateExperience: fixtures.candidateExperience,
    });
    await this.deps.events?.emit("experiment.completed", {
      itemId: item.id,
      experimentId: experiment.id,
      decision: experiment.decision,
    }, { actor: "adaptive-improvement" });

    if (experiment.decision === "PROMOTE" && proposal.parentSkillId) {
      this.deps.skills.transition(proposal.parentSkillId, "review", "Validated replacement version is available for this context.", {
        version: proposal.parentVersion,
        evidenceRefs: experiment.evidenceRefs,
        replacementVersion: candidate.manifest.version,
      });
      if ((policy.autoRetireReplacedSkills ?? false) && item.affectedSkillId) {
        this.deps.skills.retire(item.affectedSkillId, "Repeated regressions and validated replacement support retirement.", {
          version: item.affectedSkillVersion,
          evidenceRefs: unique([...item.evidenceRefs, ...experiment.evidenceRefs]),
          replacementVersion: candidate.manifest.version,
        });
      }
    }

    return {
      item: {
        status: terminalStatusForDecision(experiment.decision),
        decision: experiment.decision,
        proposalId: proposal.id,
        candidateId: candidate.id,
        experimentIds: unique([...item.experimentIds, experiment.id]),
        reason: experiment.reason,
        retries: item.retries + 1,
      },
      experiment,
    };
  }

  private createRevisionProposal(
    item: ImprovementReviewItem,
    objective: ObjectiveSpecification,
  ): EvidenceBackedSkillProposal | undefined {
    if (!item.affectedSkillId || !item.affectedSkillVersion) return undefined;
    const record = this.deps.skills.getRecord(item.affectedSkillId);
    if (!record) return undefined;
    const hypothesis: EvidenceBackedHypothesis = {
      id: createId("hyp"),
      patternId: item.id,
      proposedCause: `Skill ${item.affectedSkillId}@${item.affectedSkillVersion} has repeated contextual regressions.`,
      proposedIntervention: `Create a bounded replacement candidate for ${item.affectedSkillId}.`,
      evidenceFor: [...item.evidenceRefs],
      evidenceAgainst: [],
      confidence: item.priority,
      status: "supported",
      measurementObjectiveId: objective.id,
      metricIds: objective.metrics.map((metric) => metric.id),
      createdAt: now(),
    };
    const gap: CapabilityGap = {
      id: createId("gap"),
      hypothesisId: hypothesis.id,
      patternId: item.id,
      triggerContext: item.contextKey ? [item.contextKey] : [],
      neededBehavior: `Revise ${record.manifest.description}`,
      existingSkillsConsidered: [{
        skillId: record.id,
        version: record.manifest.version,
        status: record.status,
        reason: "Existing skill is degraded in this context.",
        sufficient: false,
      }],
      requiredTools: [...record.manifest.requiresTools],
      measurementObjectiveId: objective.id,
      metricIds: objective.metrics.map((metric) => metric.id),
      status: "open",
      createdAt: now(),
    };
    return this.deps.skillEvolution.proposeSkillFromGap(gap, hypothesis, {
      parentSkillId: item.affectedSkillId,
      parentVersion: item.affectedSkillVersion,
    });
  }

  private createRevisionCandidate(item: ImprovementReviewItem, proposal: EvidenceBackedSkillProposal): CandidateSkill {
    return this.deps.skillEvolution.createCandidateSkill(proposal, {
      id: item.affectedSkillId,
      version: nextRevisionVersion(item.affectedSkillVersion),
    });
  }
}

function createReviewItem(params: {
  readonly key: string;
  readonly kind: ImprovementReviewKind;
  readonly status: ImprovementReviewStatus;
  readonly objectiveId: string;
  readonly contextKey?: string;
  readonly affectedSkillId?: string;
  readonly affectedSkillVersion?: string;
  readonly priority: number;
  readonly risk: ImprovementRisk;
  readonly evidenceRefs: readonly string[];
  readonly hypothesisId?: string;
  readonly capabilityGapId?: string;
  readonly proposalId?: string;
  readonly candidateId?: string;
  readonly decision?: ImprovementDecision;
  readonly reason: string;
}): ImprovementReviewItem {
  const timestamp = now();
  return {
    id: createId("review"),
    key: params.key,
    kind: params.kind,
    status: params.status,
    objectiveId: params.objectiveId,
    contextKey: params.contextKey,
    affectedSkillId: params.affectedSkillId,
    affectedSkillVersion: params.affectedSkillVersion,
    priority: params.priority,
    risk: params.risk,
    evidenceRefs: [...params.evidenceRefs],
    hypothesisId: params.hypothesisId,
    capabilityGapId: params.capabilityGapId,
    proposalId: params.proposalId,
    candidateId: params.candidateId,
    experimentIds: [],
    decision: params.decision,
    reason: params.reason,
    retries: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function toProposal(item: ImprovementReviewItem): ImprovementProposal {
  return {
    id: `ip-${item.key}`,
    type: "skill",
    target: item.affectedSkillId ?? item.capabilityGapId ?? item.id,
    description: item.reason,
    expectedImprovement: "Improve evidence-backed skill fitness without changing evaluator or permissions.",
    evidence: [...item.evidenceRefs],
    status: "proposed",
    score: item.priority,
    createdAt: item.createdAt,
    appliedAt: null,
  };
}

function priorityForFitness(fitness: SkillFitness): number {
  const regressionRate = fitness.regressed / Math.max(1, fitness.uses);
  return Math.max(0, Math.min(1, regressionRate * 0.7 + fitness.confidence * 0.3));
}

function compareReviewItems(a: ImprovementReviewItem, b: ImprovementReviewItem): number {
  const priority = b.priority - a.priority;
  if (priority !== 0) return priority;
  return a.key.localeCompare(b.key);
}

function updateItem(
  items: readonly ImprovementReviewItem[],
  key: string,
  patch: Partial<ImprovementReviewItem>,
): ImprovementReviewItem[] {
  return items.map((item) => item.key === key ? {
    ...item,
    ...patch,
    experimentIds: patch.experimentIds ?? item.experimentIds,
    evidenceRefs: patch.evidenceRefs ?? item.evidenceRefs,
    updatedAt: now(),
  } : item);
}

function unsafeSkillReason(record: SkillRecord, skills: SkillRegistry, tools: ToolRegistry): string | undefined {
  for (const permission of record.manifest.requiresPermissions) {
    if (isProhibitedPermission(permission)) return `Skill requests prohibited permission ${permission}.`;
  }
  for (const toolId of record.manifest.requiresTools) {
    if (!tools.get(toolId).ok) return `Skill requires unregistered tool ${toolId}.`;
  }
  for (const dependencyId of record.manifest.dependencies ?? []) {
    const dependency = skills.getRecord(dependencyId);
    if (!dependency) return `Skill requires missing dependency ${dependencyId}.`;
    if (dependency.status !== "active") return `Skill dependency ${dependencyId} is not active.`;
  }
  return undefined;
}

function classifyCandidateRisk(candidate: CandidateSkill): ImprovementRisk {
  if (candidate.selfAuthorizedPermissions.length > 0) return "PROHIBITED_AUTONOMOUSLY";
  if (candidate.protectedCoreChanges.length > 0) return "PROHIBITED_AUTONOMOUSLY";
  if (candidate.requestedCapabilities.some(isProtectedCapability)) return "PROHIBITED_AUTONOMOUSLY";
  if (candidate.manifest.requiresPermissions.some(isProhibitedPermission)) return "PROHIBITED_AUTONOMOUSLY";
  return "SAFE_AUTOMATIC";
}

function isProhibitedPermission(permission: string): boolean {
  return permission === "filesystem.write.external" ||
    permission === "secrets.read" ||
    permission === "secrets.write" ||
    permission === "plugin.install";
}

function isProtectedCapability(capability: string): boolean {
  return [
    "trusted-core.write",
    "evaluator.modify",
    "objective.modify",
    "security-policy.modify",
    "tool-registry.authorize",
    "workspace-boundary.override",
    "system-instructions",
  ].includes(capability);
}

function terminalStatusForDecision(decision: SkillExperimentDecision): ImprovementReviewStatus {
  return decision === "COLLECT_MORE_DATA" ? "deferred" : "completed";
}

function nextRevisionVersion(version: string | undefined): string {
  if (!version) return "0.1.0";
  const [major, minor] = version.split(".").map((part) => Number.parseInt(part, 10));
  return `${Number.isFinite(major) ? major : 0}.${Number.isFinite(minor) ? minor + 1 : 1}.0`;
}

function normalizeCheckpoint(value: Partial<ImprovementCycleCheckpoint>): ImprovementCycleCheckpoint {
  return {
    lastProcessedExperienceId: value.lastProcessedExperienceId,
    lastProcessedAt: value.lastProcessedAt,
    processedExperienceIds: [...(value.processedExperienceIds ?? [])],
    reviewItems: [...(value.reviewItems ?? [])],
    running: false,
    lastCycleId: value.lastCycleId,
    lastCycleAt: value.lastCycleAt,
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
