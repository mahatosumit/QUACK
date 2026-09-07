import { createId, now, type IsoTimestamp } from "../core/types.js";
import { type EventBus } from "../events/event-bus.js";
import { type EvidenceExperienceStore } from "../cos/index.js";
import { type SkillRegistry } from "../skills/registry.js";
import { type SkillFitnessIndex } from "./skill-fitness.js";
import { EvidenceImprovementCycle, type EvidenceImprovementCyclePolicy } from "./evidence-improvement-cycle.js";
import { type ImprovementProposalBridge } from "./improvement-proposal-bridge.js";
import { type MissionOrigin } from "../runtime/task.js";

export interface ImprovementCoordinatorConfig {
  readonly enabled: boolean;
  readonly autoEvaluate: boolean;
  readonly minimumEvidence: number;
  readonly cooldownMs: number;
}

export interface ImprovementEligibilityResult {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
  readonly lastCycleAt?: IsoTimestamp;
}

export interface ImprovementTriggerContext {
  readonly taskId: string;
  readonly missionId?: string;
  readonly origin: MissionOrigin;
  readonly actor: string;
  readonly goal: string;
  readonly evidenceCount: number;
}

export class ImprovementCoordinator {
  private lastCycleAt?: IsoTimestamp;
  private config: ImprovementCoordinatorConfig;
  private proposalBridge?: ImprovementProposalBridge;

  constructor(
    private readonly deps: {
      readonly events: EventBus;
      readonly experiences: EvidenceExperienceStore;
      readonly fitness: SkillFitnessIndex;
      readonly improvementCycle: EvidenceImprovementCycle;
      readonly skills: SkillRegistry;
      readonly config: ImprovementCoordinatorConfig;
      readonly proposalBridge?: ImprovementProposalBridge;
    },
  ) {
    this.config = deps.config;
    this.proposalBridge = deps.proposalBridge;
  }

  evaluateEligibility(context: ImprovementTriggerContext): ImprovementEligibilityResult {
    const reasons: string[] = [];

    if (!this.config.enabled) {
      return { eligible: false, reasons: ["improvement.disabled"] };
    }

    if (!this.config.autoEvaluate) {
      return { eligible: false, reasons: ["improvement.autoEvaluate.disabled"] };
    }

    if (context.origin === "improvement") {
      return { eligible: false, reasons: ["recursion.guard:origin=improvement"] };
    }

    if (context.evidenceCount < this.config.minimumEvidence) {
      reasons.push(`evidence.below.minimum:${context.evidenceCount}<${this.config.minimumEvidence}`);
    }

    if (this.lastCycleAt) {
      const elapsed = Date.now() - new Date(this.lastCycleAt).getTime();
      if (elapsed < this.config.cooldownMs) {
        reasons.push(`cooldown.active:${elapsed}ms<${this.config.cooldownMs}ms`);
      }
    }

    // Every eligibility prerequisite is mandatory. In particular, a failure
    // signal must never override the configured evidence threshold or cooldown.
    // This keeps the policy deterministic, config-aware, and auditable.
    if (reasons.length > 0) {
      return { eligible: false, reasons };
    }

    return { eligible: true, reasons: [...reasons, "eligible"], lastCycleAt: this.lastCycleAt };
  }

  async onMissionCompleted(context: ImprovementTriggerContext): Promise<void> {
    await this.deps.events.emit("improvement.eligibility_checked", {
      taskId: context.taskId,
      missionId: context.missionId ?? null,
      origin: context.origin,
      actor: context.actor,
      evidenceCount: context.evidenceCount,
    }, { taskId: context.taskId, actor: "improvement-coordinator" });

    const eligibility = this.evaluateEligibility(context);

    if (!eligibility.eligible) {
      await this.deps.events.emit("improvement.skipped", {
        taskId: context.taskId,
        reasons: eligibility.reasons,
      }, { taskId: context.taskId, actor: "improvement-coordinator" });
      return;
    }

    await this.deps.events.emit("improvement.started", {
      taskId: context.taskId,
      missionId: context.missionId ?? null,
      origin: context.origin,
      actor: context.actor,
    }, { taskId: context.taskId, actor: "improvement-coordinator" });

    try {
      const policy: EvidenceImprovementCyclePolicy = {
        limits: { maxExperiences: 10, maxReviewItems: 5, maxExperiments: 1 },
        detectCapabilityGaps: true,
        runExperiments: false,
      };

      const result = await this.deps.improvementCycle.runImprovementCycle(policy);
      this.lastCycleAt = result.checkpoint.lastCycleAt;

      await this.deps.events.emit("improvement.completed", {
        taskId: context.taskId,
        cycleId: result.cycleId,
        processed: result.processedExperienceIds.length,
        reviewItemsCreated: result.reviewItemsCreated.length,
        experimentsQueued: result.experimentsQueued.length,
        decisions: result.decisions,
      }, { taskId: context.taskId, actor: "improvement-coordinator" });

      if (result.reviewItemsCreated.length > 0) {
        await this.deps.events.emit("proposal.created", {
          taskId: context.taskId,
          count: result.reviewItemsCreated.length,
          items: result.reviewItemsCreated.map((item) => ({
            id: item.id,
            kind: item.kind,
            risk: item.risk,
            affectedSkillId: item.affectedSkillId ?? null,
            reason: item.reason,
          })),
        }, { taskId: context.taskId, actor: "improvement-coordinator" });

        await this.proposalBridge?.createPendingProposals(result.reviewItemsCreated, context);
      }
    } catch (error) {
      await this.deps.events.emit("improvement.failed", {
        taskId: context.taskId,
        error: error instanceof Error ? error.message : String(error),
      }, { taskId: context.taskId, actor: "improvement-coordinator" });
    }
  }

  getLastCycleAt(): IsoTimestamp | undefined {
    return this.lastCycleAt;
  }

  setLastCycleAt(timestamp: IsoTimestamp): void {
    this.lastCycleAt = timestamp;
  }

  /** Exposes the effective policy for controlled management surfaces. */
  getConfig(): ImprovementCoordinatorConfig {
    return { ...this.config };
  }

  /** Applies only explicitly supplied improvement-policy fields for this running process. */
  updateConfig(patch: Partial<ImprovementCoordinatorConfig>): ImprovementCoordinatorConfig {
    this.config = { ...this.config, ...patch };
    return this.getConfig();
  }

  /** Late wiring keeps runtime construction acyclic while the bridge remains optional. */
  setProposalBridge(bridge: ImprovementProposalBridge): void {
    this.proposalBridge = bridge;
  }
}

export function createImprovementCoordinator(
  deps: {
    readonly events: EventBus;
    readonly experiences: EvidenceExperienceStore;
    readonly fitness: SkillFitnessIndex;
    readonly improvementCycle: EvidenceImprovementCycle;
    readonly skills: SkillRegistry;
    readonly config: ImprovementCoordinatorConfig;
    readonly proposalBridge?: ImprovementProposalBridge;
  },
): ImprovementCoordinator {
  return new ImprovementCoordinator(deps);
}
