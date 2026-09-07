import { type SkillRegistry } from "../skills/registry.js";
import { type SkillExecutionPlan } from "../skills/types.js";
import { type ModelRegistry, type ModelRouter, type RoutingPolicy } from "../models/index.js";

export class SkillOrchestrator {
  constructor(
    private readonly skillRegistry: SkillRegistry,
    private readonly modelRegistry?: ModelRegistry,
    private readonly modelRouter?: ModelRouter,
  ) {}

  discoverRelevant(goal: string): SkillExecutionPlan {
    const allSkills = this.skillRegistry.getAll().map((record) => {
      return this.skillRegistry.get(record.id)!;
    });

    return this.skillRegistry.planForGoal(goal, allSkills);
  }

  rankCandidates(plan: SkillExecutionPlan): SkillExecutionPlan {
    const sorted = plan.skills.slice().sort((a, b) => b.weight - a.weight);
    return { ...plan, skills: sorted };
  }

  estimateCost(goal: string, plan: SkillExecutionPlan): { totalUsd: number; breakdown: Array<{ skillId: string; costUsd: number }> } {
    if (!this.modelRouter || !this.modelRegistry) {
      return { totalUsd: 0, breakdown: [] };
    }

    const breakdown = plan.skills.map((entry) => {
      const models = this.modelRegistry!.getAll();
      const policy: RoutingPolicy = { id: "balanced", name: "Balanced", strategy: "balanced" };
      const selected = this.modelRouter!.select(models, entry.skillId, policy);
      const cost = selected ? this.modelRouter!.estimateCost(selected, 500, 200) : { totalCost: 0.01 };
      return { skillId: entry.skillId, costUsd: cost.totalCost };
    });

    return { totalUsd: breakdown.reduce((sum, b) => sum + b.costUsd, 0), breakdown };
  }

  composeWorkflow(plan: SkillExecutionPlan): string[] {
    return plan.skills.map((s) => s.skillId);
  }

  recordExecution(skillId: string, durationMs: number): void {
    this.skillRegistry.recordUsage(skillId, durationMs);
  }

  getPreferredSkills(): string[] {
    return this.skillRegistry.getAll()
      .filter((s) => s.useCount > 0)
      .sort((a, b) => b.useCount - a.useCount)
      .slice(0, 10)
      .map((s) => s.id);
  }
}
