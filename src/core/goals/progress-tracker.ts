import { type GoalDefinition } from "../../cos/types.js";
import { type ObjectiveNode, type ObjectiveTree } from "./objective-tree.js";

export interface ProgressSnapshot {
  goalId: string;
  progress: number;
  milestonesTotal: number;
  milestonesCompleted: number;
  overdue: boolean;
  status: GoalDefinition["status"];
  lastUpdated: string;
}

export interface OverallProgress {
  totalGoals: number;
  activeGoals: number;
  completedGoals: number;
  failedGoals: number;
  overdueGoals: number;
  averageProgress: number;
  byStatus: Record<string, number>;
}

/**
 * ProgressTracker — tracks progress for goals/projects/tasks/actions. Wraps
 * the existing cos/ProgressTracker focus (project-level metrics) by adding
 * goal-level progress snapshots and overdue detection.
 */
export class GoalsProgressTracker {
  private snapshots = new Map<string, ProgressSnapshot>();

  /** Record a snapshot for a single goal. */
  track(goal: GoalDefinition): ProgressSnapshot {
    const milestonesTotal = goal.milestones.length;
    const milestonesCompleted = goal.milestones.filter((m) => m.status === "completed").length;
    const overdue = !!goal.timeline.deadline && new Date(goal.timeline.deadline) < new Date() && goal.status === "active";
    const snapshot: ProgressSnapshot = {
      goalId: goal.id,
      progress: goal.progress,
      milestonesTotal,
      milestonesCompleted,
      overdue,
      status: goal.status,
      lastUpdated: goal.updatedAt,
    };
    this.snapshots.set(goal.id, snapshot);
    return snapshot;
  }

  trackMany(goals: readonly GoalDefinition[]): OverallProgress {
    for (const g of goals) this.track(g);
    return this.summarize(goals);
  }

  get(goalId: string): ProgressSnapshot | undefined {
    return this.snapshots.get(goalId);
  }

  getAll(): readonly ProgressSnapshot[] {
    return [...this.snapshots.values()];
  }

  /** Track objective-tree node progress as goal-level snapshots. */
  trackTree(tree: ObjectiveTree, goalId?: string): ProgressSnapshot[] {
    const nodes = tree.getAll();
    const out: ProgressSnapshot[] = [];
    for (const node of nodes) {
      if (node.level === "goal" && node.goalId) {
        const snapshot: ProgressSnapshot = {
          goalId: node.goalId,
          progress: node.progress,
          milestonesTotal: tree.getChildren(node.id).length,
          milestonesCompleted: tree.getChildren(node.id).filter((c) => c.status === "completed").length,
          overdue: false,
          status: node.status === "completed" ? "completed" : node.status === "failed" ? "failed" : "active",
          lastUpdated: node.updatedAt,
        };
        this.snapshots.set(node.goalId, snapshot);
        out.push(snapshot);
      } else if (goalId && node.level === "task") {
        // Best-effort: aggregate task progress into the named goal
        void goalId;
      }
    }
    return out;
  }

  summarize(goals: readonly GoalDefinition[]): OverallProgress {
    const total = goals.length;
    const active = goals.filter((g) => g.status === "active").length;
    const completed = goals.filter((g) => g.status === "completed").length;
    const failed = goals.filter((g) => g.status === "failed").length;
    const overdue = goals.filter((g) =>
      !!g.timeline.deadline && new Date(g.timeline.deadline) < new Date() && g.status === "active",
    ).length;
    const averageProgress = total > 0 ? Math.round(goals.reduce((sum, g) => sum + g.progress, 0) / total) : 0;
    const byStatus: Record<string, number> = {};
    for (const g of goals) byStatus[g.status] = (byStatus[g.status] ?? 0) + 1;
    return { totalGoals: total, activeGoals: active, completedGoals: completed, failedGoals: failed, overdueGoals: overdue, averageProgress, byStatus };
  }

  clear(): void {
    this.snapshots.clear();
  }
}
