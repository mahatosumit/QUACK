import { now } from "../core/types.js";
import { type OrgSnapshot } from "./types.js";
import { type AgentRegistry } from "../organization/registry.js";
import { type OrganizationalMemory } from "../organization/memory.js";
import { type GoalManager } from "./goal-manager.js";
import { type AgentLifecycleManager } from "../organization/lifecycle.js";

export class OrganizationalIntelligence {
  constructor(
    private registry: AgentRegistry,
    private orgMemory: OrganizationalMemory,
    private goalManager: GoalManager,
    private lifecycleManager: AgentLifecycleManager,
  ) {}

  snapshot(): OrgSnapshot {
    const agents = this.registry.getAll();
    const idle = agents.filter((a) => a.status === "idle").length;
    const busy = agents.filter((a) => a.status === "busy").length;
    const error = agents.filter((a) => a.status === "error").length;
    const allAssignments = this.lifecycleManager.getOrganizationState().assignments;
    const completedTasks = allAssignments.filter((a) => a.status === "completed").length;
    const failedTasks = allAssignments.filter((a) => a.status === "failed").length;
    const totalTasks = completedTasks + failedTasks;

    return {
      timestamp: now(),
      agentUtilization: { idle, busy, error, total: agents.length },
      skillCount: 0,
      modelCount: 0,
      goalCount: this.goalManager.getAll().length,
      workflowCount: this.lifecycleManager.getAllWorkflows().length,
      memorySize: this.orgMemory.getStats().total,
      taskCompletionRate: totalTasks > 0 ? completedTasks / totalTasks : 1,
      errorRate: totalTasks > 0 ? failedTasks / totalTasks : 0,
      bottlenecks: this.lifecycleManager.getBottlenecks().map((b) => ({ agentId: b.agentId, taskCount: b.taskCount })),
      knowledgeGaps: [],
    };
  }

  analyzeWorkload(): { agentId: string; role: string; load: number; status: string }[] {
    return this.registry.getAll().map((a) => ({
      agentId: a.id,
      role: a.role,
      load: a.currentTaskIds.length,
      status: a.status,
    }));
  }

  getKnowledgeGaps(): string[] {
    const memoryTypes = this.orgMemory.getStats().byType;
    const gaps: string[] = [];
    if (!memoryTypes["architecture"]) gaps.push("architecture documentation");
    if (!memoryTypes["lesson"]) gaps.push("lessons learned");
    if (!memoryTypes["decision"]) gaps.push("decision records");
    if (this.goalManager.getActive().length > 0 && !memoryTypes["pattern"]) gaps.push("workflow patterns");
    return gaps;
  }

  getHealthSummary(): { score: number; issues: string[] } {
    const s = this.snapshot();
    const issues: string[] = [];
    let score = 100;

    if (s.agentUtilization.error > 0) { score -= 15; issues.push(`${s.agentUtilization.error} agent(s) in error state`); }
    if (s.agentUtilization.busy >= s.agentUtilization.total * 0.8) { score -= 10; issues.push("high agent utilization"); }
    if (s.errorRate > 0.2) { score -= 15; issues.push(`high error rate: ${Math.round(s.errorRate * 100)}%`); }
    if (s.bottlenecks.length > 0) { score -= 5 * s.bottlenecks.length; issues.push(`${s.bottlenecks.length} bottleneck(s) detected`); }
    if (s.goalCount === 0) { score -= 5; issues.push("no active goals"); }

    return { score: Math.max(0, score), issues };
  }
}
