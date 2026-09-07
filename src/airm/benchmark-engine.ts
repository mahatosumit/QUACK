import { now } from "../core/types.js";
import type { BenchmarkResult, BenchmarkType, BenchmarkMetrics, ModelInfo } from "./types.js";
import { ModelRegistry } from "./model-registry.js";

export class BenchmarkEngine {
  private results: Map<string, BenchmarkResult> = new Map();
  private modelRegistry: ModelRegistry;

  constructor(modelRegistry: ModelRegistry) {
    this.modelRegistry = modelRegistry;
  }

  async runBenchmark(modelId: string, benchmarkType: BenchmarkType): Promise<BenchmarkResult> {
    throw new Error("AIRM benchmarking is unsupported: no measured benchmark runner is configured.");
  }

  getResult(id: string): BenchmarkResult | undefined {
    return this.results.get(id);
  }

  getResults(modelId?: string, benchmarkType?: BenchmarkType): BenchmarkResult[] {
    let all = Array.from(this.results.values());
    if (modelId) all = all.filter((r) => r.modelId === modelId);
    if (benchmarkType) all = all.filter((r) => r.benchmarkType === benchmarkType);
    return all.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  }

  getLatestResult(modelId: string): BenchmarkResult | undefined {
    const results = this.getResults(modelId);
    return results[0];
  }

  compareModels(modelIds: string[], benchmarkType: BenchmarkType): { modelId: string; scores: Record<string, number>; overall: number }[] {
    return modelIds.flatMap((modelId) => {
      const result = this.getLatestResultForType(modelId, benchmarkType);
      if (!result || Object.keys(result.scores).length === 0) return [];
      const values = Object.values(result.scores);
      return [{ modelId, scores: result.scores, overall: values.reduce((a, b) => a + b, 0) / values.length }];
    }).sort((a, b) => b.overall - a.overall);
  }

  getStats(): { total: number; byType: Record<string, number>; byModel: Record<string, number> } {
    const all = this.getResults();
    const byType: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    for (const r of all) {
      byType[r.benchmarkType] = (byType[r.benchmarkType] ?? 0) + 1;
      byModel[r.modelId] = (byModel[r.modelId] ?? 0) + 1;
    }
    return { total: all.length, byType, byModel };
  }

  private getLatestResultForType(modelId: string, benchmarkType: BenchmarkType): BenchmarkResult | undefined {
    const results = this.getResults(modelId, benchmarkType);
    return results[0];
  }

  private generateScores(type: BenchmarkType, model: ModelInfo): Record<string, number> { throw new Error("Synthetic benchmark scores are unsupported."); }

  private generateMetrics(type: BenchmarkType, model: ModelInfo): BenchmarkMetrics { throw new Error("Synthetic benchmark metrics are unsupported."); }
}

function createId(): string {
  return `bm-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}
