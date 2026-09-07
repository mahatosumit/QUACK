import { now } from "../core/types.js";
import type { SystemMetricsSnapshot, MetricHistoryEntry } from "./types.js";

export class Monitoring {
  private history: MetricHistoryEntry[] = [];
  private snapshots: SystemMetricsSnapshot[] = [];
  private maxHistoryPerMetric = 500;
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  async collectSnapshot(): Promise<SystemMetricsSnapshot> {
    throw new Error("Monitoring collectSnapshot is unsupported: no verified system sampler is configured.");
  }

  recordMetric(name: string, value: number, labels?: Record<string, string>): MetricHistoryEntry {
    const entry: MetricHistoryEntry = { timestamp: now(), value, labels: labels ?? {} };
    this.history.push(entry);
    const count = this.history.filter((e) => e.labels["name"] === name || Object.values(e.labels).includes(name)).length;
    if (count > this.maxHistoryPerMetric) {
      const idx = this.history.findIndex((e) => e.labels["name"] === name || Object.values(e.labels).includes(name));
      if (idx >= 0) this.history.splice(idx, 1);
    }
    return entry;
  }

  getSnapshots(limit = 100, offset = 0): SystemMetricsSnapshot[] {
    return this.snapshots.slice(-(limit + offset), this.snapshots.length - offset || undefined).reverse();
  }

  getLatestSnapshot(): SystemMetricsSnapshot | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  getMetricHistory(_name: string, _limit = 100): MetricHistoryEntry[] {
    return this.history;
  }

  getMetricsSummary(): Record<string, { min: number; max: number; avg: number; count: number }> {
    const summary: Record<string, { min: number; max: number; avg: number; count: number }> = {};
    for (const entry of this.history) {
      const name = entry.labels["name"] ?? "default";
      if (!summary[name]) summary[name] = { min: entry.value, max: entry.value, avg: entry.value, count: 1 };
      else {
        const s = summary[name]!;
        s.min = Math.min(s.min, entry.value);
        s.max = Math.max(s.max, entry.value);
        s.avg = (s.avg * s.count + entry.value) / (s.count + 1);
        s.count++;
      }
    }
    return summary;
  }

  getSystemSummary(): { cpu: { current: number; average: number }; memory: { current: number; average: number }; disks: { current: number; average: number }; uptime: number } {
    throw new Error("Monitoring getSystemSummary is unsupported: no verified system sampler is configured.");
  }

  clearHistory(): void {
    this.history = [];
    this.snapshots = [];
  }
}
