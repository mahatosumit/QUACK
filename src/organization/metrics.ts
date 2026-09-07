import { createId, now } from "../core/types.js";
import { type AgentInstance, type AgentMetrics, type AgentStatus } from "./types.js";

export class AgentMetricsCollector {
  private snapshots = new Map<string, AgentMetrics[]>();

  recordSnapshot(id: string, metrics: AgentMetrics): void {
    if (!this.snapshots.has(id)) {
      this.snapshots.set(id, []);
    }
    const list = this.snapshots.get(id)!;
    list.push({ ...metrics });
    if (list.length > 100) list.shift();
  }

  getHistory(id: string): AgentMetrics[] {
    return this.snapshots.get(id) ?? [];
  }

  getThroughput(id: string, windowMs: number = 300000): number {
    const cutoff = Date.now() - windowMs;
    const history = this.getHistory(id);
    const recent = history.filter((m) => {
      const ts = new Date(m.lastError ?? now()).getTime();
      return !isNaN(ts) && ts >= cutoff;
    });
    return recent.length;
  }

  getErrorRate(id: string, windowMs: number = 300000): number {
    const history = this.getHistory(id);
    if (history.length === 0) return 0;
    const recent = history.slice(-20);
    const errors = recent.filter((m) => m.errorCount > 0).length;
    return errors / recent.length;
  }

  getAvgResponseTime(id: string, windowMs: number = 300000): number {
    const history = this.getHistory(id);
    const recent = history.slice(-10);
    if (recent.length === 0) return 0;
    const total = recent.reduce((sum, m) => sum + (m.avgExecutionTimeMs || 0), 0);
    return total / recent.length;
  }

  compareAgents(ids: string[]): Record<string, { tasksCompleted: number; errorRate: number; avgTimeMs: number }> {
    const result: Record<string, { tasksCompleted: number; errorRate: number; avgTimeMs: number }> = {};
    for (const id of ids) {
      const history = this.getHistory(id);
      const latest = history[history.length - 1];
      result[id] = {
        tasksCompleted: latest?.tasksCompleted ?? 0,
        errorRate: this.getErrorRate(id),
        avgTimeMs: this.getAvgResponseTime(id),
      };
    }
    return result;
  }
}
