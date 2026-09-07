import { createId, now } from "../core/types.js";
import { type AgentPriority } from "../organization/types.js";
import {
  type GoalDefinition, type GoalStatus, type GoalMilestone, type GoalStatus as GS,
} from "./types.js";

export class GoalManager {
  private goals = new Map<string, GoalDefinition>();

  create(params: {
    mission: string;
    objectives: string[];
    priority?: AgentPriority;
    owner?: string;
    estimatedEffortHours?: number;
    deadline?: string;
    dependencies?: string[];
    successMetrics?: string[];
    failureCriteria?: string[];
    knowledgeTags?: string[];
  }): GoalDefinition {
    const id = createId("goal");
    const goal: GoalDefinition = {
      id,
      mission: params.mission,
      objectives: params.objectives,
      milestones: [],
      dependencies: params.dependencies ?? [],
      priority: params.priority ?? "medium",
      owner: params.owner ?? "organization",
      assignedAgents: [],
      estimatedEffortHours: params.estimatedEffortHours ?? 0,
      timeline: { start: now(), deadline: params.deadline },
      budget: {},
      successMetrics: params.successMetrics ?? [],
      failureCriteria: params.failureCriteria ?? [],
      progress: 0,
      relatedWorkflows: [],
      relatedSkills: [],
      relatedDocs: [],
      knowledgeTags: params.knowledgeTags ?? [],
      status: "draft",
      createdAt: now(),
      updatedAt: now(),
    };
    this.goals.set(id, goal);
    return goal;
  }

  get(id: string): GoalDefinition | undefined {
    return this.goals.get(id);
  }

  getAll(): GoalDefinition[] {
    return [...this.goals.values()];
  }

  getByStatus(status: GoalStatus): GoalDefinition[] {
    return this.getAll().filter((g) => g.status === status);
  }

  getActive(): GoalDefinition[] {
    return this.getByStatus("active");
  }

  activate(id: string): boolean {
    const goal = this.goals.get(id);
    if (!goal || (goal.status !== "draft" && goal.status !== "paused")) return false;
    goal.status = "active";
    goal.updatedAt = now();
    return true;
  }

  pause(id: string): boolean {
    const goal = this.goals.get(id);
    if (!goal || goal.status !== "active") return false;
    goal.status = "paused";
    goal.updatedAt = now();
    return true;
  }

  complete(id: string): boolean {
    const goal = this.goals.get(id);
    if (!goal || goal.status !== "active") return false;
    goal.status = "completed";
    goal.progress = 100;
    goal.completedAt = now();
    goal.updatedAt = now();
    return true;
  }

  fail(id: string): boolean {
    const goal = this.goals.get(id);
    if (!goal) return false;
    goal.status = "failed";
    goal.updatedAt = now();
    return true;
  }

  cancel(id: string): boolean {
    const goal = this.goals.get(id);
    if (!goal || goal.status === "completed") return false;
    goal.status = "cancelled";
    goal.updatedAt = now();
    return true;
  }

  addMilestone(goalId: string, description: string, dueBy?: string): GoalMilestone | undefined {
    const goal = this.goals.get(goalId);
    if (!goal) return undefined;
    const milestone: GoalMilestone = {
      id: createId("ms"),
      description,
      dueBy,
      status: "pending",
    };
    goal.milestones.push(milestone);
    goal.updatedAt = now();
    return milestone;
  }

  completeMilestone(goalId: string, milestoneId: string): boolean {
    const goal = this.goals.get(goalId);
    if (!goal) return false;
    const ms = goal.milestones.find((m) => m.id === milestoneId);
    if (!ms) return false;
    ms.status = "completed";
    ms.completedAt = now();
    goal.updatedAt = now();
    this.recalculateProgress(goal);
    return true;
  }

  updateProgress(goalId: string, progress: number): boolean {
    const goal = this.goals.get(goalId);
    if (!goal) return false;
    goal.progress = Math.max(0, Math.min(100, progress));
    goal.updatedAt = now();
    return true;
  }

  assignAgent(goalId: string, agentId: string): boolean {
    const goal = this.goals.get(goalId);
    if (!goal) return false;
    if (!goal.assignedAgents.includes(agentId)) {
      goal.assignedAgents.push(agentId);
      goal.updatedAt = now();
    }
    return true;
  }

  linkWorkflow(goalId: string, workflowId: string): boolean {
    const goal = this.goals.get(goalId);
    if (!goal) return false;
    if (!goal.relatedWorkflows.includes(workflowId)) {
      goal.relatedWorkflows.push(workflowId);
      goal.updatedAt = now();
    }
    return true;
  }

  linkSkill(goalId: string, skillId: string): boolean {
    const goal = this.goals.get(goalId);
    if (!goal) return false;
    if (!goal.relatedSkills.includes(skillId)) {
      goal.relatedSkills.push(skillId);
      goal.updatedAt = now();
    }
    return true;
  }

  getOverdue(): GoalDefinition[] {
    const now_ = new Date();
    return this.getActive().filter((g) => {
      if (!g.timeline.deadline) return false;
      return new Date(g.timeline.deadline) < now_;
    });
  }

  getStats(): { total: number; active: number; completed: number; failed: number; overdue: number } {
    const all = this.getAll();
    return {
      total: all.length,
      active: all.filter((g) => g.status === "active").length,
      completed: all.filter((g) => g.status === "completed").length,
      failed: all.filter((g) => g.status === "failed").length,
      overdue: this.getOverdue().length,
    };
  }

  clear(): void {
    this.goals.clear();
  }

  private recalculateProgress(goal: GoalDefinition): void {
    if (goal.milestones.length === 0) return;
    const completed = goal.milestones.filter((m) => m.status === "completed").length;
    goal.progress = Math.round((completed / goal.milestones.length) * 100);
  }
}
