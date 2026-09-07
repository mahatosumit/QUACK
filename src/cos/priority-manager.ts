import { type AgentPriority } from "../organization/types.js";
import { type GoalDefinition } from "./types.js";

const ONE_DAY_MS = 86_400_000;
const ONE_WEEK_MS = 604_800_000;

interface PriorityQueueEntry {
  goalId: string;
  priority: AgentPriority;
  score: number;
  insertedAt: string;
}

export class PriorityManager {
  private queue: PriorityQueueEntry[] = [];

  enqueue(goal: GoalDefinition): void {
    const existing = this.queue.find((e) => e.goalId === goal.id);
    if (existing) {
      existing.priority = goal.priority;
      existing.score = this.computeScore(goal);
      return;
    }
    this.queue.push({
      goalId: goal.id,
      priority: goal.priority,
      score: this.computeScore(goal),
      insertedAt: new Date().toISOString(),
    });
    this.sort();
  }

  dequeue(): string | undefined {
    return this.queue.shift()?.goalId;
  }

  peek(): string | undefined {
    return this.queue[0]?.goalId;
  }

  remove(goalId: string): boolean {
    const idx = this.queue.findIndex((e) => e.goalId === goalId);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    return true;
  }

  reorder(goals: GoalDefinition[]): void {
    this.queue = goals.map((g) => ({
      goalId: g.id,
      priority: g.priority,
      score: this.computeScore(g),
      insertedAt: new Date().toISOString(),
    }));
    this.sort();
  }

  getQueue(): PriorityQueueEntry[] {
    return [...this.queue];
  }

  getPriority(goalId: string): AgentPriority | undefined {
    return this.queue.find((e) => e.goalId === goalId)?.priority;
  }

  getStats(): { total: number; critical: number; high: number; medium: number; low: number } {
    return {
      total: this.queue.length,
      critical: this.queue.filter((e) => e.priority === "critical").length,
      high: this.queue.filter((e) => e.priority === "high").length,
      medium: this.queue.filter((e) => e.priority === "medium").length,
      low: this.queue.filter((e) => e.priority === "low").length,
    };
  }

  clear(): void {
    this.queue = [];
  }

  private computeScore(goal: GoalDefinition): number {
    const priorityMap: Record<AgentPriority, number> = { critical: 100, high: 60, medium: 30, low: 10 };
    let score = priorityMap[goal.priority] ?? 30;
    if (goal.timeline.deadline) {
      const remaining = new Date(goal.timeline.deadline).getTime() - Date.now();
      if (remaining < ONE_DAY_MS) score += 40;
      else if (remaining < ONE_WEEK_MS) score += 20;
    }
    return score;
  }

  private sort(): void {
    this.queue.sort((a, b) => b.score - a.score);
  }
}
