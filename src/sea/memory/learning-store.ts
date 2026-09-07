import { createId, now } from "../../core/types.js";
import { type LearningRecord } from "../types.js";

export class LearningStore {
  private repairs = new Map<string, LearningRecord>();
  private failures: Array<{ fix: string; context: string; timestamp: string; successRate: number }> = [];

  constructor(private readonly dataDir: string) {}

  async record(fix: string, context: string): Promise<void> {
    this.failures.push({ fix, context, timestamp: now(), successRate: 0.5 });
    if (this.failures.length > 500) {
      this.failures = this.failures.slice(-500);
    }
  }

  async recordRepair(pattern: string, fix: string): Promise<void> {
    const existing = this.repairs.get(pattern);
    if (existing) {
      this.repairs.set(pattern, {
        ...existing,
        occurrences: existing.occurrences + 1,
        lastApplied: now(),
      });
    } else {
      this.repairs.set(pattern, {
        pattern,
        context: "Workspace repair",
        fix,
        occurrences: 1,
        lastApplied: now(),
        successRate: 1.0,
      });
    }
  }

  async findRepair(errorPattern: string): Promise<LearningRecord | undefined> {
    const lower = errorPattern.toLowerCase();
    for (const [, record] of this.repairs) {
      if (lower.includes(record.pattern.toLowerCase())) {
        return record;
      }
    }
    return undefined;
  }

  async getCommonFixes(limit = 10): Promise<LearningRecord[]> {
    return [...this.repairs.values()]
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, limit);
  }

  async getRecentFailures(limit = 10): Promise<Array<{ fix: string; context: string; timestamp: string; successRate: number }>> {
    return this.failures.slice(-limit).reverse();
  }

  async clear(): Promise<void> {
    this.repairs.clear();
    this.failures = [];
  }

  stats(): { repairs: number; failures: number } {
    return { repairs: this.repairs.size, failures: this.failures.length };
  }
}
