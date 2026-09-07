import { createId, now } from "../core/types.js";
import { type CodeExperimentRecord, type CodeImprovementProposal } from "../selfmod/types.js";
import { type CodeImprovementController } from "../selfmod/code-improvement-controller.js";
import { type MissionOrigin } from "../runtime/task.js";
import { type ImprovementReviewItem } from "./evidence-improvement-cycle.js";

export interface ImprovementProposalBridgeConfig {
  readonly enabled: boolean;
  readonly maxProposalsPerMission: number;
}

export interface ImprovementProposalBridgeContext {
  readonly taskId: string;
  readonly missionId?: string;
  readonly origin: MissionOrigin;
}

export interface ImprovementProposalBridgeResult {
  readonly proposals: readonly CodeExperimentRecord[];
  readonly skipped: number;
}

const DEFAULT_CONFIG: ImprovementProposalBridgeConfig = {
  enabled: true,
  maxProposalsPerMission: 1,
};

/**
 * Converts only explicit, concrete code candidates into persisted conceptual
 * proposals. It has no filesystem, git, tool, or approval authority.
 */
export class ImprovementProposalBridge {
  private readonly config: ImprovementProposalBridgeConfig;

  constructor(private readonly deps: {
    readonly controller: CodeImprovementController;
    readonly config?: Partial<ImprovementProposalBridgeConfig>;
  }) {
    this.config = { ...DEFAULT_CONFIG, ...(deps.config ?? {}) };
  }

  async createPendingProposals(
    items: readonly ImprovementReviewItem[],
    context: ImprovementProposalBridgeContext,
  ): Promise<ImprovementProposalBridgeResult> {
    // Defense in depth: an improvement-originated mission is never allowed to
    // create another self-improvement proposal, even if called directly.
    if (!this.config.enabled || context.origin === "improvement") {
      return { proposals: [], skipped: items.length };
    }

    const proposals: CodeExperimentRecord[] = [];
    let skipped = 0;
    for (const item of items) {
      if (proposals.length >= this.config.maxProposalsPerMission || !isActionableCodeCandidate(item)) {
        skipped += 1;
        continue;
      }
      const proposal = toCodeProposal(item);
      const queued = await this.deps.controller.queueProposal(proposal, {
        taskId: context.taskId,
        actor: "improvement-proposal-bridge",
      });
      if (queued.ok && queued.data.status === "PROPOSED") proposals.push(queued.data);
      else skipped += 1;
    }
    return { proposals, skipped };
  }
}

function isActionableCodeCandidate(item: ImprovementReviewItem): boolean {
  const candidate = item.codeProposal;
  return item.risk === "REQUIRES_APPROVAL"
    && candidate !== undefined
    && candidate.sourceEvidenceRefs.length > 0
    && candidate.hypothesis.trim().length > 0
    && candidate.description.trim().length > 0
    && candidate.targetScope.length > 0
    && candidate.expectedFiles.length > 0
    && [...candidate.targetScope, ...candidate.expectedFiles].every(isConcreteSourcePath);
}

function toCodeProposal(item: ImprovementReviewItem): CodeImprovementProposal {
  const candidate = item.codeProposal!;
  return {
    id: createId("improvement-code-proposal"),
    sourceEvidenceRefs: [...candidate.sourceEvidenceRefs],
    hypothesis: candidate.hypothesis,
    objectiveId: item.objectiveId,
    targetScope: [...candidate.targetScope],
    expectedFiles: [...candidate.expectedFiles],
    description: candidate.description,
    createdAt: now(),
  };
}

function isConcreteSourcePath(path: string): boolean {
  return path.length > 0 && !path.includes("..") && !path.endsWith("/") && /\.[a-z0-9]+$/i.test(path);
}
