import { now } from "../core/types.js";
import { type CosMetricsSnapshot } from "./types.js";
import { type AgentRegistry } from "../organization/registry.js";
import { type OrganizationalMemory } from "../organization/memory.js";
import { type AgentMetricsCollector } from "../organization/metrics.js";
import { type GoalManager } from "./goal-manager.js";
import { type DecisionEngine } from "./decision-engine.js";
import { type ExperienceEngine } from "./experience-engine.js";
import { type LearningEngine } from "./learning-engine.js";
import { type GovernanceEngine } from "./governance-engine.js";
import { type AgentLifecycleManager } from "../organization/lifecycle.js";

const MAX_HISTORY_LENGTH = 1000;

export class MetricsEngine {
  private history: CosMetricsSnapshot[] = [];

  constructor(
    private registry: AgentRegistry,
    private orgMemory: OrganizationalMemory,
    private agentMetrics: AgentMetricsCollector,
    private goalManager: GoalManager,
    private decisionEngine: DecisionEngine,
    private experienceEngine: ExperienceEngine,
    private learningEngine: LearningEngine,
    private governanceEngine: GovernanceEngine,
    private lifecycleManager: AgentLifecycleManager,
  ) {}

  snapshot(): CosMetricsSnapshot {
    const agents = this.registry.getAll();
    const workMetrics = this.lifecycleManager.getOrganizationState().assignments;
    const completed = workMetrics.filter((a) => a.status === "completed").length;
    const failed = workMetrics.filter((a) => a.status === "failed").length;

    const s: CosMetricsSnapshot = {
      timestamp: now(),
      goals: { ...this.goalManager.getStats() },
      decisions: this.decisionEngine.getStats(),
      experiences: this.experienceEngine.getStats(),
      learning: this.learningEngine.getStats(),
      agents: {
        total: agents.length,
        avgTasksCompleted: agents.length > 0 ? agents.reduce((s, a) => s + a.metrics.tasksCompleted, 0) / agents.length : 0,
        avgErrorRate: agents.length > 0 ? agents.reduce((s, a) => s + a.health.errorRate, 0) / agents.length : 0,
      },
      workflows: {
        total: this.lifecycleManager.getAllWorkflows().length,
        successRate: (completed + failed) > 0 ? completed / (completed + failed) : 1,
      },
      policies: this.governanceEngine.getStats(),
    };
    this.history.push(s);
    if (this.history.length > MAX_HISTORY_LENGTH) this.history.shift();
    return s;
  }

  getHistory(): CosMetricsSnapshot[] {
    return [...this.history];
  }

  getLatest(): CosMetricsSnapshot | undefined {
    return this.history[this.history.length - 1];
  }

  getTrend(dimension: keyof CosMetricsSnapshot["goals"], window = 10): { timestamp: string; value: number }[] {
    return this.history.slice(-window).map((s) => ({
      timestamp: s.timestamp,
      value: s.goals[dimension] as number,
    }));
  }

  clear(): void {
    this.history = [];
  }
}
