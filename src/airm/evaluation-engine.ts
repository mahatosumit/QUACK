import { now } from "../core/types.js";
import type { EvaluationRecord, ExecutionMetrics, UserFeedback, AiCapability } from "./types.js";

export class EvaluationEngine {
  private records: Map<string, EvaluationRecord> = new Map();

  record(entry: Omit<EvaluationRecord, "id">): string {
    const id = createId();
    const record: EvaluationRecord = { id, ...entry };
    this.records.set(id, record);
    return id;
  }

  get(id: string): EvaluationRecord | undefined {
    return this.records.get(id);
  }

  getAll(): EvaluationRecord[] {
    return Array.from(this.records.values());
  }

  getByModel(modelId: string): EvaluationRecord[] {
    return this.getAll().filter((r) => r.modelId === modelId);
  }

  getByRuntime(runtimeId: string): EvaluationRecord[] {
    return this.getAll().filter((r) => r.runtimeId === runtimeId);
  }

  getByTaskType(taskType: AiCapability): EvaluationRecord[] {
    return this.getAll().filter((r) => r.taskType === taskType);
  }

  getSuccessRate(modelId?: string): number {
    const records = modelId ? this.getByModel(modelId) : this.getAll();
    if (records.length === 0) return 0;
    return records.filter((r) => r.success).length / records.length;
  }

  getAverageLatency(modelId?: string): number {
    const records = modelId ? this.getByModel(modelId) : this.getAll();
    if (records.length === 0) return 0;
    return records.reduce((sum, r) => sum + r.metrics.latencyMs, 0) / records.length;
  }

  getAverageCost(modelId?: string): number {
    const records = modelId ? this.getByModel(modelId) : this.getAll();
    if (records.length === 0) return 0;
    return records.reduce((sum, r) => sum + r.metrics.cost, 0) / records.length;
  }

  getAverageRetries(modelId?: string): number {
    const records = modelId ? this.getByModel(modelId) : this.getAll();
    if (records.length === 0) return 0;
    return records.reduce((sum, r) => sum + r.metrics.retries, 0) / records.length;
  }

  recordFeedback(recordId: string, feedback: UserFeedback): boolean {
    const record = this.records.get(recordId);
    if (!record) return false;
    record.userFeedback = feedback;
    return true;
  }

  getModelRanking(limit = 10): { modelId: string; successRate: number; avgLatency: number; avgCost: number; score: number }[] {
    const byModel = new Map<string, EvaluationRecord[]>();
    for (const r of this.getAll()) {
      const list = byModel.get(r.modelId) ?? [];
      list.push(r);
      byModel.set(r.modelId, list);
    }
    const rankings = Array.from(byModel.entries()).map(([modelId, records]) => {
      const successRate = records.filter((r) => r.success).length / records.length;
      const avgLatency = records.reduce((s, r) => s + r.metrics.latencyMs, 0) / records.length;
      const avgCost = records.reduce((s, r) => s + r.metrics.cost, 0) / records.length;
      const score = Math.round((successRate * 100) - (avgLatency / 100) - (avgCost * 10));
      return { modelId, successRate, avgLatency, avgCost, score: Math.max(0, score) };
    });
    return rankings.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  getStats(): { total: number; success: number; failed: number; avgLatency: number; avgRetries: number; avgCost: number } {
    const all = this.getAll();
    return {
      total: all.length,
      success: all.filter((r) => r.success).length,
      failed: all.filter((r) => !r.success).length,
      avgLatency: this.getAverageLatency(),
      avgRetries: this.getAverageRetries(),
      avgCost: this.getAverageCost(),
    };
  }
}

function createId(): string {
  return `eval-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}
