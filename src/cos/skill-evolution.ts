import { createId, now } from "../core/types.js";
import { type SkillVersion, type ImprovementProposal, type SelfEvaluationReport } from "./types.js";
import { type GoalManager } from "./goal-manager.js";
import { type OrganizationalIntelligence } from "./org-intelligence.js";

export class SkillEvolutionEngine {
  private skillVersions = new Map<string, SkillVersion[]>();
  private proposals = new Map<string, ImprovementProposal>();

  constructor(
    private goalManager: GoalManager,
    private orgIntelligence: OrganizationalIntelligence,
  ) {}

  recordVersion(skillId: string, version: string, benchmarkScore: number, qualityScore: number, changeLog: string[]): SkillVersion {
    const sv: SkillVersion = { version, benchmarkScore, qualityScore, usageCount: 0, lastOptimized: now(), changeLog };
    if (!this.skillVersions.has(skillId)) this.skillVersions.set(skillId, []);
    this.skillVersions.get(skillId)!.push(sv);
    return sv;
  }

  recordUsage(skillId: string): void {
    const versions = this.skillVersions.get(skillId);
    const latest = versions?.[versions.length - 1];
    if (latest) latest.usageCount++;
  }

  getVersions(skillId: string): SkillVersion[] {
    return this.skillVersions.get(skillId) ?? [];
  }

  getLatestVersion(skillId: string): SkillVersion | undefined {
    const versions = this.skillVersions.get(skillId);
    return versions?.[versions.length - 1];
  }

  getAllVersions(): Map<string, SkillVersion[]> {
    return new Map(this.skillVersions);
  }

  proposeImprovement(params: {
    title: string;
    description: string;
    category: ImprovementProposal["category"];
    currentState: string;
    proposedState: string;
    expectedBenefit: string;
    risk?: "low" | "medium" | "high";
    effort?: "small" | "medium" | "large";
    createdBy?: string;
  }): ImprovementProposal {
    const proposal: ImprovementProposal = {
      id: createId("impr"),
      title: params.title,
      description: params.description,
      category: params.category,
      currentState: params.currentState,
      proposedState: params.proposedState,
      expectedBenefit: params.expectedBenefit,
      risk: params.risk ?? "medium",
      effort: params.effort ?? "medium",
      status: "draft",
      createdBy: params.createdBy ?? "organization",
      createdAt: now(),
    };
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  approveProposal(id: string): boolean {
    const p = this.proposals.get(id);
    if (!p || p.status !== "draft") return false;
    p.status = "approved";
    return true;
  }

  implementProposal(id: string): boolean {
    const p = this.proposals.get(id);
    if (!p) return false;
    p.status = "implemented";
    p.implementedAt = now();
    return true;
  }

  rejectProposal(id: string): boolean {
    const p = this.proposals.get(id);
    if (!p) return false;
    p.status = "rejected";
    return true;
  }

  getProposal(id: string): ImprovementProposal | undefined {
    return this.proposals.get(id);
  }

  getProposals(status?: ImprovementProposal["status"]): ImprovementProposal[] {
    const all = [...this.proposals.values()];
    return status ? all.filter((p) => p.status === status) : all;
  }

  generateSelfEvaluation(): SelfEvaluationReport {
    const health = this.orgIntelligence.getHealthSummary();
    const activeGoals = this.goalManager.getActive();
    const proposals: ImprovementProposal[] = [];

    if (health.score < 80) {
      proposals.push(this.proposeImprovement({
        title: "Address health issues",
        description: `System health score is ${health.score}/100. Issues: ${health.issues.join(", ")}`,
        category: "performance",
        currentState: `Score: ${health.score}`,
        proposedState: "Score: 90+",
        expectedBenefit: "Improved system reliability",
        risk: "medium", effort: "medium",
      }));
    }

    if (activeGoals.length === 0) {
      proposals.push(this.proposeImprovement({
        title: "Define organization goals",
        description: "No active goals detected. Goals drive agent utilization and organizational focus.",
        category: "organization",
        currentState: "No active goals",
        proposedState: "3-5 active goals across different priorities",
        expectedBenefit: "Improved agent utilization and strategic alignment",
        risk: "low", effort: "small",
      }));
    }

    const report: SelfEvaluationReport = {
      id: createId("eval"),
      timestamp: now(),
      score: health.score,
      dimensions: [
        { name: "Health", score: health.score, notes: health.issues.join("; ") || "All systems nominal" },
        { name: "Goals", score: activeGoals.length > 0 ? 80 : 20, notes: `${activeGoals.length} active goals` },
        { name: "Proposals", score: proposals.length === 0 ? 100 : 60, notes: `${proposals.length} improvement areas identified` },
      ],
      proposals,
      healthSummary: health.score >= 80 ? "Healthy" : health.score >= 50 ? "Degraded" : "Critical",
    };
    return report;
  }

  clear(): void {
    this.skillVersions.clear();
    this.proposals.clear();
  }
}
