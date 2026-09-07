import { createId, now } from "../core/types.js";
import { type IsoTimestamp } from "../core/types.js";
import { type TimelineEntry } from "./types.js";

interface ScheduledReview {
  id: string;
  cadence: "daily" | "weekly" | "monthly" | "quarterly";
  description: string;
  lastRun?: IsoTimestamp;
  nextRun: IsoTimestamp;
  enabled: boolean;
}

interface TimeBudget {
  goalId: string;
  allocatedMs: number;
  usedMs: number;
}

export class TimeManager {
  private timelines = new Map<string, TimelineEntry[]>();
  private reviews = new Map<string, ScheduledReview>();
  private budgets = new Map<string, TimeBudget[]>();
  private reminders = new Map<string, { goalId: string; message: string; dueAt: IsoTimestamp; triggered: boolean }[]>();

  recordEntry(goalId: string, entry: Omit<TimelineEntry, "id" | "timestamp">): TimelineEntry {
    const full: TimelineEntry = { ...entry, id: createId("tl"), timestamp: now() };
    if (!this.timelines.has(goalId)) {
      this.timelines.set(goalId, []);
    }
    this.timelines.get(goalId)!.push(full);
    return full;
  }

  getTimeline(goalId: string): TimelineEntry[] {
    return this.timelines.get(goalId) ?? [];
  }

  getAllTimelines(): Map<string, TimelineEntry[]> {
    return new Map(this.timelines);
  }

  addRecurringReview(params: { cadence: "daily" | "weekly" | "monthly" | "quarterly"; description: string }): ScheduledReview {
    const review: ScheduledReview = {
      id: createId("review"),
      cadence: params.cadence,
      description: params.description,
      nextRun: this.computeNextRun(params.cadence),
      enabled: true,
    };
    this.reviews.set(review.id, review);
    return review;
  }

  getDueReviews(): ScheduledReview[] {
    const now_ = now();
    return [...this.reviews.values()].filter((r) => r.enabled && r.nextRun <= now_);
  }

  completeReview(id: string): boolean {
    const review = this.reviews.get(id);
    if (!review) return false;
    review.lastRun = now();
    review.nextRun = this.computeNextRun(review.cadence);
    return true;
  }

  getAllReviews(): ScheduledReview[] {
    return [...this.reviews.values()];
  }

  setTimeBudget(goalId: string, allocatedMs: number): void {
    if (!this.budgets.has(goalId)) {
      this.budgets.set(goalId, []);
    }
    const budgets = this.budgets.get(goalId)!;
    const existing = budgets.find((b) => b.goalId === goalId);
    if (existing) {
      existing.allocatedMs = allocatedMs;
    } else {
      budgets.push({ goalId, allocatedMs, usedMs: 0 });
    }
  }

  recordTimeSpent(goalId: string, ms: number): void {
    const budgets = this.budgets.get(goalId);
    if (budgets) {
      const budget = budgets.find((b) => b.goalId === goalId);
      if (budget) budget.usedMs += ms;
    }
  }

  getTimeBudget(goalId: string): { allocatedMs: number; usedMs: number; remainingMs: number } | undefined {
    const budgets = this.budgets.get(goalId);
    const budget = budgets?.find((b) => b.goalId === goalId);
    if (!budget) return undefined;
    return {
      allocatedMs: budget.allocatedMs,
      usedMs: budget.usedMs,
      remainingMs: Math.max(0, budget.allocatedMs - budget.usedMs),
    };
  }

  addReminder(goalId: string, message: string, dueAt: IsoTimestamp): boolean {
    if (!this.reminders.has(goalId)) {
      this.reminders.set(goalId, []);
    }
    this.reminders.get(goalId)!.push({ goalId, message, dueAt, triggered: false });
    return true;
  }

  getDueReminders(): { goalId: string; message: string; dueAt: IsoTimestamp }[] {
    const now_ = now();
    const due: { goalId: string; message: string; dueAt: IsoTimestamp }[] = [];
    for (const [, reminders] of this.reminders) {
      for (const r of reminders) {
        if (!r.triggered && r.dueAt <= now_) {
          r.triggered = true;
          due.push({ goalId: r.goalId, message: r.message, dueAt: r.dueAt });
        }
      }
    }
    return due;
  }

  getStats(): { totalEntries: number; totalReviews: number; activeBudgets: number; pendingReminders: number } {
    let totalEntries = 0;
    for (const [, entries] of this.timelines) totalEntries += entries.length;
    let pendingReminders = 0;
    for (const [, reminders] of this.reminders) pendingReminders += reminders.filter((r) => !r.triggered).length;
    return {
      totalEntries,
      totalReviews: this.reviews.size,
      activeBudgets: this.budgets.size,
      pendingReminders,
    };
  }

  clear(): void {
    this.timelines.clear();
    this.reviews.clear();
    this.budgets.clear();
    this.reminders.clear();
  }

  private computeNextRun(cadence: string): IsoTimestamp {
    const d = new Date();
    switch (cadence) {
      case "daily": d.setDate(d.getDate() + 1); break;
      case "weekly": d.setDate(d.getDate() + 7); break;
      case "monthly": d.setMonth(d.getMonth() + 1); break;
      case "quarterly": d.setMonth(d.getMonth() + 3); break;
    }
    return d.toISOString();
  }
}
