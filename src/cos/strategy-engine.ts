import { createId, now } from "../core/types.js";
import { type ExecutionStrategy, type RiskAnalysis, type GoalDefinition } from "./types.js";

export class StrategyEngine {
  private strategies = new Map<string, ExecutionStrategy>();

  create(params: {
    goalId: string;
    approach: string;
    taskGraph?: { step: string; dependsOn: string[] }[];
    risks?: RiskAnalysis[];
    fallbackStrategies?: string[];
    validationPlan?: string;
    completionMetrics?: string[];
  }): ExecutionStrategy {
    const strategy: ExecutionStrategy = {
      id: createId("strat"),
      goalId: params.goalId,
      approach: params.approach,
      taskGraph: params.taskGraph ?? [],
      risks: params.risks ?? [],
      fallbackStrategies: params.fallbackStrategies ?? [],
      validationPlan: params.validationPlan ?? "",
      reviewSchedule: { cadence: "weekly", nextReview: new Date(Date.now() + 604800000).toISOString() },
      completionMetrics: params.completionMetrics ?? [],
      status: "draft",
      createdAt: now(),
    };
    this.strategies.set(strategy.id, strategy);
    return strategy;
  }

  approve(id: string): boolean {
    const s = this.strategies.get(id);
    if (!s || s.status !== "draft") return false;
    s.status = "approved";
    return true;
  }

  activate(id: string): boolean {
    const s = this.strategies.get(id);
    if (!s || s.status !== "approved") return false;
    s.status = "active";
    return true;
  }

  complete(id: string): boolean {
    const s = this.strategies.get(id);
    if (!s) return false;
    s.status = "completed";
    return true;
  }

  supersede(id: string): boolean {
    const s = this.strategies.get(id);
    if (!s) return false;
    s.status = "superseded";
    return true;
  }

  get(id: string): ExecutionStrategy | undefined {
    return this.strategies.get(id);
  }

  getByGoal(goalId: string): ExecutionStrategy[] {
    return this.getAll().filter((s) => s.goalId === goalId);
  }

  getAll(): ExecutionStrategy[] {
    return [...this.strategies.values()];
  }

  generateForGoal(goal: GoalDefinition): ExecutionStrategy {
    const steps = goal.objectives.map((obj) => ({ step: obj, dependsOn: [] as string[] }));
    for (let i = 1; i < steps.length; i++) {
      steps[i].dependsOn = [steps[i - 1].step];
    }
    return this.create({
      goalId: goal.id,
      approach: `Execute ${goal.objectives.length} objectives: ${goal.objectives.join(" -> ")}`,
      taskGraph: steps,
      completionMetrics: goal.successMetrics,
      validationPlan: `Verify: ${goal.successMetrics.join(", ")}`,
    });
  }

  clear(): void {
    this.strategies.clear();
  }
}
