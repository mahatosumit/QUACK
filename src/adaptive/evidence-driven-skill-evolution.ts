import { createId, now, type IsoTimestamp } from "../core/types.js";
import {
  type EvidenceBackedExperience,
  type EvidenceExperienceStore,
  type ExecutionProvenance,
  type ObjectiveSpecification,
  type ObjectiveEvaluationStatus,
} from "../cos/index.js";
import { DeterministicObjectiveEvaluator } from "../cos/index.js";
import { type Permission } from "../security/permissions.js";
import { type SkillDefinition, type SkillLoadSource, type SkillManifest, type SkillRecord } from "../skills/types.js";
import { SkillRegistry } from "../skills/registry.js";
import { type ToolRegistry } from "../tools/tool.js";
import {
  type AdaptiveLayer,
  type Experiment,
  type ExperimentResult,
  type SkillBenchmark,
} from "./types.js";

export type FailurePatternStatus = "candidate" | "actionable" | "dismissed";
export type HypothesisStatus = "candidate" | "supported" | "challenged" | "validated" | "rejected";
export type CapabilityGapStatus = "open" | "covered_by_existing_skill" | "proposed" | "closed";
export type AdaptiveSkillOrigin = "built_in" | "local_user" | "generated_by_quack" | "imported_external" | "plugin";
export type CandidateSkillStatus =
  | "discovered"
  | "candidate"
  | "validating"
  | "sandboxed"
  | "evaluated"
  | "active"
  | "rejected"
  | "retired"
  | "quarantined";
export type SkillExperimentDecision =
  | "PROMOTE"
  | "REJECT"
  | "REVISE"
  | "COLLECT_MORE_DATA"
  | "REQUIRE_HUMAN_REVIEW";

export interface FailurePattern {
  readonly id: string;
  readonly objectiveId: string;
  readonly key: string;
  readonly classification: string;
  readonly dimension: string;
  readonly supportingExperienceIds: readonly string[];
  readonly opposingExperienceIds: readonly string[];
  readonly count: number;
  readonly comparablePopulation: number;
  readonly confidence: number;
  readonly status: FailurePatternStatus;
  readonly attribution: Pick<ExecutionProvenance, "strategyId" | "workflowId" | "selectedSkills" | "variant">;
  readonly createdAt: IsoTimestamp;
}

export interface EvidenceBackedHypothesis {
  readonly id: string;
  readonly patternId: string;
  readonly proposedCause: string;
  readonly proposedIntervention: string;
  readonly evidenceFor: readonly string[];
  readonly evidenceAgainst: readonly string[];
  readonly confidence: number;
  readonly status: HypothesisStatus;
  readonly measurementObjectiveId: string;
  readonly metricIds: readonly string[];
  readonly createdAt: IsoTimestamp;
}

export interface ExistingSkillAssessment {
  readonly skillId: string;
  readonly version: string;
  readonly status: SkillRecord["status"];
  readonly reason: string;
  readonly sufficient: boolean;
}

export interface CapabilityGap {
  readonly id: string;
  readonly hypothesisId: string;
  readonly patternId: string;
  readonly triggerContext: readonly string[];
  readonly neededBehavior: string;
  readonly existingSkillsConsidered: readonly ExistingSkillAssessment[];
  readonly requiredTools: readonly string[];
  readonly measurementObjectiveId: string;
  readonly metricIds: readonly string[];
  readonly status: CapabilityGapStatus;
  readonly createdAt: IsoTimestamp;
}

export interface EvidenceBackedSkillProposal {
  readonly id: string;
  readonly hypothesisId: string;
  readonly capabilityGapId: string;
  readonly supportingEvidence: readonly string[];
  readonly desiredBehavior: string;
  readonly triggerContext: readonly string[];
  readonly requiredTools: readonly string[];
  readonly expectedMetricEffect: string;
  readonly constraints: readonly string[];
  readonly origin: AdaptiveSkillOrigin;
  readonly parentSkillId?: string;
  readonly parentVersion?: string;
  readonly proposedBy: "user" | "evidence";
  readonly status: "draft" | "proposed" | "validated" | "rejected" | "promoted";
  readonly createdAt: IsoTimestamp;
}

export interface CandidateSkill {
  readonly id: string;
  readonly proposalId: string;
  readonly manifest: SkillManifest;
  readonly origin: AdaptiveSkillOrigin;
  readonly parentSkillId?: string;
  readonly parentVersion?: string;
  readonly status: CandidateSkillStatus;
  readonly instructions: string;
  readonly requestedCapabilities: readonly string[];
  readonly selfAuthorizedPermissions: readonly Permission[];
  readonly protectedCoreChanges: readonly string[];
  readonly validation?: CandidateSkillValidation;
  readonly createdAt: IsoTimestamp;
}

export interface CandidateSkillValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly checkedAt: IsoTimestamp;
}

export interface SkillEvolutionExperiment {
  readonly id: string;
  readonly experimentId: string;
  readonly candidateId: string;
  readonly controlExperienceId: string;
  readonly candidateExperienceId: string;
  readonly objectiveId: string;
  readonly decision: SkillExperimentDecision;
  readonly reason: string;
  readonly results: readonly ExperimentResult[];
  readonly evidenceRefs: readonly string[];
  readonly createdAt: IsoTimestamp;
}

export interface PatternDetectionOptions {
  readonly minComparableExperiences?: number;
  readonly minOccurrences?: number;
  readonly minConfidence?: number;
}

export class EvidenceDrivenSkillEvolution {
  private readonly patterns = new Map<string, FailurePattern>();
  private readonly hypotheses = new Map<string, EvidenceBackedHypothesis>();
  private readonly gaps = new Map<string, CapabilityGap>();
  private readonly proposals = new Map<string, EvidenceBackedSkillProposal>();
  private readonly candidates = new Map<string, CandidateSkill>();
  private readonly experiments = new Map<string, SkillEvolutionExperiment>();
  private readonly candidateHistory = new Map<string, CandidateSkill[]>();

  constructor(
    private readonly deps: {
      readonly experiences: EvidenceExperienceStore;
      readonly skills: SkillRegistry;
      readonly tools: ToolRegistry;
      readonly adaptiveLayer: AdaptiveLayer;
      readonly evaluator: DeterministicObjectiveEvaluator;
      readonly allowedPermissions?: readonly Permission[];
    },
  ) {}

  async detectFailurePatterns(options: PatternDetectionOptions = {}): Promise<FailurePattern[]> {
    const minComparable = options.minComparableExperiences ?? 3;
    const minOccurrences = options.minOccurrences ?? 2;
    const minConfidence = options.minConfidence ?? 0.5;
    const experiences = await this.deps.experiences.list();
    const byObjective = groupBy(experiences, (experience) => experience.objective.id);
    const detected: FailurePattern[] = [];

    for (const [objectiveId, objectiveExperiences] of byObjective) {
      if (objectiveExperiences.length < minComparable) continue;
      const failures = objectiveExperiences.filter(isFailureExperience);
      const buckets = new Map<string, EvidenceBackedExperience[]>();
      for (const failure of failures) {
        for (const dimension of patternDimensions(failure)) {
          const key = `${objectiveId}|${dimension}`;
          buckets.set(key, [...(buckets.get(key) ?? []), failure]);
        }
      }

      for (const [key, supporting] of buckets) {
        const confidence = supporting.length / objectiveExperiences.length;
        if (supporting.length < minOccurrences || confidence < minConfidence) continue;
        const dimension = key.slice(objectiveId.length + 1);
        const opposing = objectiveExperiences.filter((experience) =>
          !isFailureExperience(experience) && patternDimensions(experience).includes(dimension)
        );
        const existing = [...this.patterns.values()].find((pattern) =>
          pattern.key === key &&
          sameSet(pattern.supportingExperienceIds, supporting.map((experience) => experience.id)) &&
          sameSet(pattern.opposingExperienceIds, opposing.map((experience) => experience.id))
        );
        if (existing) {
          detected.push(existing);
          continue;
        }
        const pattern: FailurePattern = {
          id: createId("fpat"),
          objectiveId,
          key,
          classification: classifyDimension(dimension),
          dimension,
          supportingExperienceIds: supporting.map((experience) => experience.id),
          opposingExperienceIds: opposing.map((experience) => experience.id),
          count: supporting.length,
          comparablePopulation: objectiveExperiences.length,
          confidence,
          status: "actionable",
          attribution: summarizeAttribution(supporting),
          createdAt: now(),
        };
        this.patterns.set(pattern.id, pattern);
        detected.push(pattern);
      }
    }

    return detected;
  }

  createHypothesis(pattern: FailurePattern, objective: ObjectiveSpecification): EvidenceBackedHypothesis {
    const status: HypothesisStatus = pattern.status === "actionable"
      ? (pattern.opposingExperienceIds.length > 0 ? "challenged" : "supported")
      : "candidate";
    const hypothesis: EvidenceBackedHypothesis = {
      id: createId("hyp"),
      patternId: pattern.id,
      proposedCause: `Repeated ${pattern.classification} evidence appears in ${pattern.count} of ${pattern.comparablePopulation} comparable experiences.`,
      proposedIntervention: `Introduce or reuse a bounded skill that improves behaviour for ${pattern.dimension}.`,
      evidenceFor: [...pattern.supportingExperienceIds],
      evidenceAgainst: [...pattern.opposingExperienceIds],
      confidence: pattern.confidence,
      status,
      measurementObjectiveId: objective.id,
      metricIds: objective.metrics.map((metric) => metric.id),
      createdAt: now(),
    };
    this.hypotheses.set(hypothesis.id, hypothesis);
    return hypothesis;
  }

  identifyCapabilityGap(params: {
    readonly hypothesis: EvidenceBackedHypothesis;
    readonly pattern: FailurePattern;
    readonly neededBehavior: string;
    readonly requiredTools: readonly string[];
    readonly triggerContext?: readonly string[];
  }): CapabilityGap {
    const considered = assessExistingSkills(this.deps.skills, params.neededBehavior, params.requiredTools);
    const covered = considered.some((skill) => skill.sufficient && skill.status === "active");
    const gap: CapabilityGap = {
      id: createId("gap"),
      hypothesisId: params.hypothesis.id,
      patternId: params.pattern.id,
      triggerContext: params.triggerContext ?? [params.pattern.dimension],
      neededBehavior: params.neededBehavior,
      existingSkillsConsidered: considered,
      requiredTools: [...params.requiredTools],
      measurementObjectiveId: params.hypothesis.measurementObjectiveId,
      metricIds: [...params.hypothesis.metricIds],
      status: covered ? "covered_by_existing_skill" : "open",
      createdAt: now(),
    };
    this.gaps.set(gap.id, gap);
    return gap;
  }

  proposeSkillFromGap(
    gap: CapabilityGap,
    hypothesis: EvidenceBackedHypothesis,
    options: { readonly proposedBy?: "user" | "evidence"; readonly origin?: AdaptiveSkillOrigin; readonly parentSkillId?: string; readonly parentVersion?: string } = {},
  ): EvidenceBackedSkillProposal | undefined {
    if (gap.status === "covered_by_existing_skill") return undefined;
    const proposal: EvidenceBackedSkillProposal = {
      id: createId("sprop"),
      hypothesisId: hypothesis.id,
      capabilityGapId: gap.id,
      supportingEvidence: [...hypothesis.evidenceFor],
      desiredBehavior: gap.neededBehavior,
      triggerContext: [...gap.triggerContext],
      requiredTools: [...gap.requiredTools],
      expectedMetricEffect: `Improve objective ${gap.measurementObjectiveId} metrics: ${gap.metricIds.join(", ")}`,
      constraints: [
        "Candidate skill cannot authorize its own permissions.",
        "Candidate skill cannot alter evaluator, objective, ToolRegistry, permissions, or workspace policy.",
      ],
      origin: options.origin ?? "generated_by_quack",
      parentSkillId: options.parentSkillId,
      parentVersion: options.parentVersion,
      proposedBy: options.proposedBy ?? "evidence",
      status: "proposed",
      createdAt: now(),
    };
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  proposeSkillFromUser(params: {
    readonly desiredBehavior: string;
    readonly triggerContext?: readonly string[];
    readonly requiredTools: readonly string[];
    readonly origin?: AdaptiveSkillOrigin;
  }): EvidenceBackedSkillProposal {
    const id = createId("sprop");
    const proposal: EvidenceBackedSkillProposal = {
      id,
      hypothesisId: "user-request",
      capabilityGapId: "user-request",
      supportingEvidence: [],
      desiredBehavior: params.desiredBehavior,
      triggerContext: params.triggerContext ?? [],
      requiredTools: [...params.requiredTools],
      expectedMetricEffect: "User-requested capability; requires later evidence before promotion.",
      constraints: [
        "User-requested candidates still require structural validation and evidence-gated promotion.",
      ],
      origin: params.origin ?? "local_user",
      proposedBy: "user",
      status: "draft",
      createdAt: now(),
    };
    this.proposals.set(id, proposal);
    return proposal;
  }

  createCandidateSkill(
    proposal: EvidenceBackedSkillProposal,
    params: {
      readonly id?: string;
      readonly name?: string;
      readonly version?: string;
      readonly instructions?: string;
      readonly requestedCapabilities?: readonly string[];
      readonly selfAuthorizedPermissions?: readonly Permission[];
      readonly protectedCoreChanges?: readonly string[];
    } = {},
  ): CandidateSkill {
    const skillId = params.id ?? proposal.parentSkillId ?? slugify(proposal.desiredBehavior);
    const version = params.version ?? nextCandidateVersion(this.candidateHistory.get(skillId), proposal.parentVersion);
    const manifest: SkillManifest = {
      id: skillId,
      name: params.name ?? titleize(skillId),
      version,
      description: proposal.desiredBehavior,
      author: "QUACK Adaptive Learning",
      category: "analysis",
      tags: unique([...proposal.triggerContext.flatMap(tokenize), "adaptive", "candidate"]),
      requiresPermissions: ["workspace.read"],
      requiresTools: [...proposal.requiredTools],
      entry: `adaptive:${skillId}@${version}`,
      documentation: "Generated as a bounded adaptive candidate. Not privileged policy.",
    };
    const candidate: CandidateSkill = {
      id: createId("cskill"),
      proposalId: proposal.id,
      manifest,
      origin: proposal.origin,
      parentSkillId: proposal.parentSkillId,
      parentVersion: proposal.parentVersion,
      status: "candidate",
      instructions: params.instructions ?? `When ${proposal.triggerContext.join(", ") || "the context matches"}, ${proposal.desiredBehavior}.`,
      requestedCapabilities: params.requestedCapabilities ?? [],
      selfAuthorizedPermissions: params.selfAuthorizedPermissions ?? [],
      protectedCoreChanges: params.protectedCoreChanges ?? [],
      createdAt: now(),
    };
    this.candidates.set(candidate.id, candidate);
    this.candidateHistory.set(skillId, [...(this.candidateHistory.get(skillId) ?? []), candidate]);
    return candidate;
  }

  validateCandidateSkill(candidate: CandidateSkill): CandidateSkillValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!isValidSkillId(candidate.manifest.id)) errors.push("Skill id must use lowercase letters, numbers, dots, or hyphens.");
    if (!isValidVersion(candidate.manifest.version)) errors.push("Skill version must be a stable semver-like value.");
    if (!candidate.manifest.description.trim()) errors.push("Skill description is required.");
    if (!candidate.instructions.trim()) errors.push("Candidate instructions are required.");
    if (candidate.origin === "generated_by_quack" || candidate.origin === "imported_external") {
      warnings.push("Generated/imported skills are untrusted until evidence-gated promotion.");
    }

    for (const toolId of candidate.manifest.requiresTools) {
      const tool = this.deps.tools.get(toolId);
      if (!tool.ok) {
        errors.push(`Required tool ${toolId} is not registered.`);
        continue;
      }
      for (const permission of tool.data.describe().permissions) {
        if (!candidate.manifest.requiresPermissions.includes(permission)) {
          errors.push(`Tool ${toolId} requires undeclared permission ${permission}.`);
        }
      }
    }

    for (const dependency of candidate.manifest.dependencies ?? []) {
      if (!this.deps.skills.getRecord(dependency)) {
        errors.push(`Skill dependency ${dependency} is not registered.`);
      }
    }

    const allowed = new Set(this.deps.allowedPermissions ?? []);
    if (allowed.size > 0) {
      for (const permission of candidate.manifest.requiresPermissions) {
        if (!allowed.has(permission)) errors.push(`Permission ${permission} is not satisfiable by current policy.`);
      }
    }

    for (const permission of candidate.selfAuthorizedPermissions) {
      errors.push(`Candidate cannot self-authorize permission ${permission}.`);
    }

    for (const permission of candidate.manifest.requiresPermissions) {
      if (isProhibitedPermission(permission)) errors.push(`Permission ${permission} is prohibited for adaptive candidates.`);
    }

    for (const capability of candidate.requestedCapabilities) {
      if (isProtectedCapability(capability)) errors.push(`Capability ${capability} targets protected core authority.`);
    }

    for (const change of candidate.protectedCoreChanges) {
      errors.push(`Candidate cannot modify protected core component ${change}.`);
    }

    if (this.deps.skills.get(candidate.manifest.id, candidate.manifest.version)) {
      errors.push(`Skill ${candidate.manifest.id}@${candidate.manifest.version} already exists; candidate cannot overwrite an existing version.`);
    }
    if (this.deps.skills.getRecord(candidate.manifest.id) && !candidate.parentSkillId) {
      errors.push(`Skill ${candidate.manifest.id} already exists; same-ID candidates require explicit parent version lineage.`);
    }
    if (candidate.parentSkillId) {
      if (candidate.parentSkillId !== candidate.manifest.id) {
        errors.push(`Candidate parent ${candidate.parentSkillId} must match logical skill id ${candidate.manifest.id} for a version revision.`);
      }
      if (!candidate.parentVersion) {
        errors.push("Candidate revisions require a parent version.");
      } else if (!this.deps.skills.getRecord(candidate.parentSkillId, candidate.parentVersion)) {
        errors.push(`Parent skill ${candidate.parentSkillId}@${candidate.parentVersion} is not registered.`);
      } else if (candidate.parentVersion === candidate.manifest.version) {
        errors.push("Candidate version cannot parent itself.");
      }
    }

    const validation: CandidateSkillValidation = {
      valid: errors.length === 0,
      errors,
      warnings,
      checkedAt: now(),
    };
    this.candidates.set(candidate.id, { ...candidate, status: "sandboxed", validation });
    return validation;
  }

  runControlCandidateExperiment(params: {
    readonly candidate: CandidateSkill;
    readonly objective: ObjectiveSpecification;
    readonly baseline?: EvidenceBackedExperience;
    readonly control: EvidenceBackedExperience;
    readonly candidateExperience: EvidenceBackedExperience;
  }): SkillEvolutionExperiment {
    const validation = params.candidate.validation ?? this.validateCandidateSkill(params.candidate);
    if (!validation.valid) {
      return this.recordExperiment(params, undefined, "REJECT", validation.errors.join("; "));
    }

    const comparable = areComparable(params.objective, params.control, params.candidateExperience);
    if (!comparable.ok) {
      return this.recordExperiment(params, undefined, "REQUIRE_HUMAN_REVIEW", comparable.reason);
    }

    const controlEvaluation = this.deps.evaluator.evaluate({
      objective: params.objective,
      runId: params.control.runId,
      observations: params.control.metricObservations,
      baselineRunId: params.baseline?.runId,
      baselineObservations: params.baseline?.metricObservations,
      execution: params.control.execution,
    });
    const candidateEvaluation = this.deps.evaluator.evaluate({
      objective: params.objective,
      runId: params.candidateExperience.runId,
      observations: params.candidateExperience.metricObservations,
      baselineRunId: params.baseline?.runId,
      baselineObservations: params.baseline?.metricObservations,
      execution: params.candidateExperience.execution,
    });

    const decision = decideExperiment(controlEvaluation.status, candidateEvaluation.status);
    const experiment = this.recordExperiment(params, [
      {
        variantId: "control",
        metrics: evaluationMetrics(controlEvaluation.status),
        sampleSize: 1,
        confidence: controlEvaluation.confidence,
        isWinner: decision !== "PROMOTE",
      },
      {
        variantId: "candidate",
        metrics: evaluationMetrics(candidateEvaluation.status),
        sampleSize: 1,
        confidence: candidateEvaluation.confidence,
        isWinner: decision === "PROMOTE",
      },
    ], decision, `Control=${controlEvaluation.status}; candidate=${candidateEvaluation.status}.`);

    if (decision === "PROMOTE") {
      this.promoteCandidate(params.candidate, experiment);
    } else if (decision === "REJECT") {
      this.candidates.set(params.candidate.id, { ...params.candidate, status: "rejected", validation });
    } else {
      this.candidates.set(params.candidate.id, { ...params.candidate, status: "evaluated", validation });
    }

    return experiment;
  }

  promoteCandidate(candidate: CandidateSkill, experiment: SkillEvolutionExperiment): void {
    if (experiment.decision !== "PROMOTE") {
      throw new Error(`Candidate ${candidate.manifest.id} cannot be promoted from decision ${experiment.decision}.`);
    }
    const validation = candidate.validation ?? this.validateCandidateSkill(candidate);
    if (!validation.valid) {
      throw new Error(`Candidate ${candidate.manifest.id} is not valid: ${validation.errors.join("; ")}`);
    }

    this.deps.skills.register(candidateToDefinition(candidate), sourceForOrigin(candidate.origin), "active", {
      parentVersion: candidate.parentVersion,
      supersedesVersion: candidate.parentVersion,
      evidenceRefs: experiment.evidenceRefs,
      setDefault: true,
    });
    this.deps.adaptiveLayer.skillEvolution.recordBenchmark(candidate.manifest.id, {
      suite: experiment.id,
      passRate: 1,
      avgLatencyMs: 0,
      sampleSize: 1,
      timestamp: now(),
    } satisfies SkillBenchmark);
    this.candidates.set(candidate.id, { ...candidate, status: "active", validation });
  }

  getCandidateHistory(skillId: string): CandidateSkill[] {
    return [...(this.candidateHistory.get(skillId) ?? [])];
  }

  getCandidate(id: string): CandidateSkill | undefined {
    const candidate = this.candidates.get(id);
    return candidate ? clone(candidate) : undefined;
  }

  getPatterns(): FailurePattern[] {
    return [...this.patterns.values()];
  }

  getHypotheses(): EvidenceBackedHypothesis[] {
    return [...this.hypotheses.values()];
  }

  getCapabilityGaps(): CapabilityGap[] {
    return [...this.gaps.values()];
  }

  getProposals(): EvidenceBackedSkillProposal[] {
    return [...this.proposals.values()];
  }

  getExperiments(): SkillEvolutionExperiment[] {
    return [...this.experiments.values()];
  }

  private recordExperiment(
    params: {
      readonly candidate: CandidateSkill;
      readonly objective: ObjectiveSpecification;
      readonly control: EvidenceBackedExperience;
      readonly candidateExperience: EvidenceBackedExperience;
    },
    results: readonly ExperimentResult[] | undefined,
    decision: SkillExperimentDecision,
    reason: string,
  ): SkillEvolutionExperiment {
    const experiment = this.deps.adaptiveLayer.experimentManager.createExperiment({
      type: "skill",
      name: `${params.candidate.manifest.id} candidate evaluation`,
      description: reason,
      variants: [
        { id: "control", label: "Control", config: { experienceId: params.control.id }, weight: 0.5 },
        { id: "candidate", label: "Candidate", config: { experienceId: params.candidateExperience.id, candidateId: params.candidate.id }, weight: 0.5 },
      ],
      metrics: params.objective.metrics.map((metric) => metric.id),
      iterations: 1,
      confidenceThreshold: 1,
    });
    if (results) {
      experiment.status = "completed";
      experiment.completedAt = now();
      experiment.results = [...results];
      experiment.winner = results.find((result) => result.isWinner)?.variantId ?? null;
    } else {
      experiment.status = "failed";
    }
    experiment.artifacts.push(params.control.id, params.candidateExperience.id);

    const evolutionExperiment: SkillEvolutionExperiment = {
      id: createId("seexp"),
      experimentId: experiment.id,
      candidateId: params.candidate.id,
      controlExperienceId: params.control.id,
      candidateExperienceId: params.candidateExperience.id,
      objectiveId: params.objective.id,
      decision,
      reason,
      results: results ? [...results] : [],
      evidenceRefs: [
        ...params.control.evidence.map((evidence) => evidence.id),
        ...params.candidateExperience.evidence.map((evidence) => evidence.id),
      ],
      createdAt: now(),
    };
    this.experiments.set(evolutionExperiment.id, evolutionExperiment);
    return evolutionExperiment;
  }
}

function isFailureExperience(experience: EvidenceBackedExperience): boolean {
  return experience.resultStatus === "failed" ||
    experience.evaluation.status === "REGRESSED" ||
    experience.evaluation.status === "INCONCLUSIVE";
}

function patternDimensions(experience: EvidenceBackedExperience): string[] {
  const dimensions = [
    `evaluation:${experience.evaluation.status}`,
    ...experience.evidence
      .filter((evidence) => evidence.metricId)
      .map((evidence) => `metric:${evidence.metricId}:${evidence.conclusion}`),
    ...experience.outcomes
      .filter((outcome) => outcome.startsWith("task.error:"))
      .map((outcome) => `outcome:${outcome}`),
  ];

  if (experience.execution.strategyId) dimensions.push(`strategy:${experience.execution.strategyId}`);
  if (experience.execution.workflowId) dimensions.push(`workflow:${experience.execution.workflowId}`);
  for (const skill of experience.execution.selectedSkills) {
    dimensions.push(`skill:${skill.skillId}`);
    if (skill.version) dimensions.push(`skill-version:${skill.skillId}@${skill.version}`);
  }

  return unique(dimensions);
}

function classifyDimension(dimension: string): string {
  const [kind] = dimension.split(":");
  switch (kind) {
    case "metric": return "objective-metric";
    case "outcome": return "runtime-outcome";
    case "strategy": return "strategy-attribution";
    case "workflow": return "workflow-attribution";
    case "skill":
    case "skill-version": return "skill-attribution";
    default: return "evaluation-status";
  }
}

function summarizeAttribution(experiences: readonly EvidenceBackedExperience[]): FailurePattern["attribution"] {
  const first = experiences[0]?.execution;
  return {
    strategyId: first?.strategyId,
    workflowId: first?.workflowId,
    selectedSkills: uniqueSkills(experiences.flatMap((experience) => [...experience.execution.selectedSkills])),
    variant: first?.variant,
  };
}

function assessExistingSkills(
  registry: SkillRegistry,
  neededBehavior: string,
  requiredTools: readonly string[],
): ExistingSkillAssessment[] {
  const matches = registry.getAll();
  return matches.map((record) => {
    const hasTools = requiredTools.every((tool) => record.manifest.requiresTools.includes(tool));
    const behaviorTokens = tokenize(neededBehavior);
    const text = `${record.manifest.name} ${record.manifest.description} ${record.manifest.tags.join(" ")}`.toLowerCase();
    const tokenHits = behaviorTokens.filter((token) => text.includes(token)).length;
    return {
      skillId: record.id,
      version: record.manifest.version,
      status: record.status,
      reason: `${tokenHits} behaviour token(s) matched; required tools ${hasTools ? "covered" : "not covered"}.`,
      sufficient: tokenHits >= 2 && (requiredTools.length === 0 || hasTools),
    };
  }).filter((assessment) => !assessment.reason.startsWith("0 behaviour"));
}

function areComparable(
  objective: ObjectiveSpecification,
  control: EvidenceBackedExperience,
  candidate: EvidenceBackedExperience,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (control.objective.id !== objective.id || candidate.objective.id !== objective.id) {
    return { ok: false, reason: "Control and candidate must use the same objective." };
  }
  if (control.objective.evaluationPolicy.evaluatorId !== objective.evaluationPolicy.evaluatorId ||
    candidate.objective.evaluationPolicy.evaluatorId !== objective.evaluationPolicy.evaluatorId) {
    return { ok: false, reason: "Control and candidate must use the same evaluator policy." };
  }
  if (control.execution.variant?.role !== "control") {
    return { ok: false, reason: "Control experience must carry control variant attribution." };
  }
  if (candidate.execution.variant?.role !== "candidate") {
    return { ok: false, reason: "Candidate experience must carry candidate variant attribution." };
  }
  return { ok: true };
}

function decideExperiment(
  control: ObjectiveEvaluationStatus,
  candidate: ObjectiveEvaluationStatus,
): SkillExperimentDecision {
  if (candidate === "IMPROVED" && control !== "IMPROVED") return "PROMOTE";
  if (candidate === "REGRESSED") return "REJECT";
  if (candidate === "INSUFFICIENT_EVIDENCE") return "COLLECT_MORE_DATA";
  if (candidate === "INCONCLUSIVE") return "REQUIRE_HUMAN_REVIEW";
  return "REVISE";
}

function evaluationMetrics(status: ObjectiveEvaluationStatus): Record<string, number> {
  return {
    improved: status === "IMPROVED" ? 1 : 0,
    regressed: status === "REGRESSED" ? 1 : 0,
    inconclusive: status === "INCONCLUSIVE" ? 1 : 0,
    insufficientEvidence: status === "INSUFFICIENT_EVIDENCE" ? 1 : 0,
  };
}

function candidateToDefinition(candidate: CandidateSkill): SkillDefinition {
  return {
    manifest: candidate.manifest,
    portableExecution: {
      schemaVersion: 1,
      steps: [{
        id: "execute",
        description: candidate.instructions,
        requiredTools: [...candidate.manifest.requiresTools],
        toolInvocations: candidate.manifest.requiresTools.map((toolId) => ({
          toolId,
          input: defaultPortableToolInput(toolId),
          reason: `Execute bounded candidate step for ${candidate.manifest.id}@${candidate.manifest.version}.`,
        })),
      }],
      limits: {
        maxSteps: 1,
        maxToolCalls: Math.max(1, candidate.manifest.requiresTools.length),
        maxRetriesPerStep: 0,
        timeoutMs: 5_000,
      },
    },
    execute: async () => ({
      ok: true,
      data: {
        instructions: candidate.instructions,
        candidateId: candidate.id,
      },
      durationMs: 0,
    }),
  };
}

function defaultPortableToolInput(toolId: string): Record<string, unknown> {
  if (toolId === "core.workspace.list-files") return { path: ".", depth: 1 };
  if (toolId === "core.workspace.read-file") return { path: { $fromParameter: "path" } };
  if (toolId === "core.echo") return { message: { $fromInput: "goal" } };
  return {};
}

function sourceForOrigin(origin: AdaptiveSkillOrigin): SkillLoadSource {
  switch (origin) {
    case "built_in": return "builtin";
    case "local_user": return "file";
    case "generated_by_quack": return "generated";
    case "imported_external": return "imported";
    case "plugin": return "plugin";
  }
}

function isValidSkillId(id: string): boolean {
  return /^[a-z0-9][a-z0-9.-]*$/.test(id);
}

function isValidVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version);
}

function isProhibitedPermission(permission: Permission): boolean {
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

function nextCandidateVersion(history: readonly CandidateSkill[] | undefined, parentVersion?: string): string {
  if (parentVersion) {
    const [major, minor] = parentVersion.split(".").map((part) => Number.parseInt(part, 10));
    return `${Number.isFinite(major) ? major : 0}.${Number.isFinite(minor) ? minor + 1 : 1}.0`;
  }
  return history && history.length > 0 ? `0.${history.length + 1}.0` : "0.1.0";
}

function groupBy<T>(values: readonly T[], keyOf: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return groups;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const values = new Set(a);
  return b.every((value) => values.has(value));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function uniqueSkills(skills: readonly ExecutionProvenance["selectedSkills"][number][]): ExecutionProvenance["selectedSkills"] {
  const byKey = new Map<string, ExecutionProvenance["selectedSkills"][number]>();
  for (const skill of skills) {
    byKey.set(`${skill.skillId}@${skill.version ?? ""}`, skill);
  }
  return [...byKey.values()];
}

function tokenize(text: string): string[] {
  return unique(text.toLowerCase().split(/[^a-z0-9.-]+/).filter((part) => part.length > 2));
}

function slugify(text: string): string {
  const slug = tokenize(text).slice(0, 4).join("-");
  return slug || "adaptive-skill";
}

function titleize(id: string): string {
  return id.split(/[-.]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
