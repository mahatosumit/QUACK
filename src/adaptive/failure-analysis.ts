import { createId, now } from "../core/types.js";
import type { FailureRecord, FailureCategory } from "./types.js";

export function createFailureAnalysisEngine() {
  const failures: FailureRecord[] = [];
  const maxFailures = 1000;

  function recordFailure(failure: FailureRecord): void {
    failures.push(failure);
    if (failures.length > maxFailures) {
      failures.splice(0, failures.length - maxFailures);
    }
  }

  function getFailuresByCategory(category: FailureCategory): FailureRecord[] {
    return failures.filter((f) => f.category === category);
  }

  function getFailureRate(windowMs: number): number {
    const cutoff = Date.now() - windowMs;
    const windowed = failures.filter(
      (f) => new Date(f.timestamp).getTime() > cutoff
    );
    return windowed.length / Math.max(1, (failures.length));
  }

  function getRecommendations(taskId: string): string[] {
    const taskFailures = failures.filter((f) => f.taskId === taskId);
    if (taskFailures.length === 0) return [];

    const categories = taskFailures.map((f) => f.category);
    const categoryCounts: Record<string, number> = {};
    for (const cat of categories) {
      categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
    }

    const topCategory = Object.entries(categoryCounts).sort(
      (a, b) => b[1] - a[1]
    )[0]?.[0];

    const recommendations: Record<string, string> = {
      reasoning: "Add structured reasoning step with validation checkpoints",
      tool: "Wrap tool calls in try-catch with retry logic",
      environment: "Validate environment dependencies before execution",
      model: "Fall back to alternative model when primary fails",
      provider: "Implement provider failover strategy",
      network: "Add exponential backoff with jitter for network calls",
      user: "Validate user input before processing",
      workspace: "Verify workspace state before operations",
      unknown: "Enable debug logging and classify the failure pattern",
    };

    return topCategory ? [recommendations[topCategory] ?? "Investigate failure root cause"] : [];
  }

  function getStats(): Record<string, number> {
    const stats: Record<string, number> = { total: failures.length };
    for (const f of failures) {
      stats[f.category] = (stats[f.category] ?? 0) + 1;
    }
    return stats;
  }

  function createFailureRecord(
    taskId: string,
    category: FailureCategory,
    message: string,
    context: Record<string, unknown> = {}
  ): FailureRecord {
    return {
      id: createId("fail"),
      taskId,
      category,
      message,
      context,
      recovery: null,
      timestamp: now(),
    };
  }

  return { recordFailure, getFailuresByCategory, getFailureRate, getRecommendations, getStats, createFailureRecord };
}
