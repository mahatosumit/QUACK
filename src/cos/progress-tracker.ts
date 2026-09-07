import { now } from "../core/types.js";
import { type GoalDefinition } from "./types.js";
import { type GoalManager } from "./goal-manager.js";
import { type TimeManager } from "./time-manager.js";

export class ProgressTracker {
  constructor(
    private goalManager: GoalManager,
    private timeManager: TimeManager,
  ) {}

  getOverallProgress(): { totalCompleted: number; totalActive: number; completionRate: number; overdueCount: number } {
    const all = this.goalManager.getAll();
    const total = all.length || 1;
    return {
      totalCompleted: all.filter((g) => g.status === "completed").length,
      totalActive: all.filter((g) => g.status === "active").length,
      completionRate: all.filter((g) => g.status === "completed").length / total,
      overdueCount: this.goalManager.getOverdue().length,
    };
  }

  getGoalProgress(goalId: string): { progress: number; milestonesCompleted: number; milestonesTotal: number; estimatedCompletion?: string } {
    const goal = this.goalManager.get(goalId);
    if (!goal) return { progress: 0, milestonesCompleted: 0, milestonesTotal: 0 };
    const completed = goal.milestones.filter((m) => m.status === "completed").length;
    const timeBudget = this.timeManager.getTimeBudget(goalId);
    let estimatedCompletion: string | undefined;
    if (timeBudget && timeBudget.usedMs > 0 && goal.progress > 0) {
      const rate = goal.progress / timeBudget.usedMs;
      const remaining = (100 - goal.progress) / rate;
      estimatedCompletion = new Date(Date.now() + remaining).toISOString();
    }
    return {
      progress: goal.progress,
      milestonesCompleted: completed,
      milestonesTotal: goal.milestones.length,
      estimatedCompletion,
    };
  }

  getAllGoalProgress(): Map<string, { progress: number; milestonesCompleted: number; milestonesTotal: number }> {
    const result = new Map<string, { progress: number; milestonesCompleted: number; milestonesTotal: number }>();
    for (const goal of this.goalManager.getAll()) {
      result.set(goal.id, {
        progress: goal.progress,
        milestonesCompleted: goal.milestones.filter((m) => m.status === "completed").length,
        milestonesTotal: goal.milestones.length,
      });
    }
    return result;
  }

  getOnTrack(): GoalDefinition[] {
    return this.goalManager.getActive().filter((g) => {
      if (!g.timeline.deadline) return true;
      return new Date(g.timeline.deadline) > new Date();
    });
  }

  getAtRisk(): GoalDefinition[] {
    return this.goalManager.getActive().filter((g) => {
      if (!g.timeline.deadline) return false;
      const remaining = new Date(g.timeline.deadline).getTime() - Date.now();
      return remaining > 0 && remaining < 86400000 && g.progress < 80;
    });
  }
}
