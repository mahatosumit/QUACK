import { now } from "../core/types.js";
import type { RerankerModelInfo, ModelStatus } from "./types.js";

export class RerankerRegistry {
  private models: Map<string, RerankerModelInfo> = new Map();

  register(model: RerankerModelInfo): void {
    this.models.set(model.id, model);
  }

  unregister(id: string): boolean {
    return this.models.delete(id);
  }

  get(id: string): RerankerModelInfo | undefined {
    return this.models.get(id);
  }

  getAll(): RerankerModelInfo[] {
    return Array.from(this.models.values());
  }

  getAvailable(): RerankerModelInfo[] {
    return this.getAll().filter((m) => m.status === "available" || m.status === "loaded");
  }

  updateStatus(id: string, status: ModelStatus): boolean {
    const m = this.models.get(id);
    if (!m) return false;
    m.status = status;
    return true;
  }

  getStats(): { total: number; available: number } {
    return { total: this.models.size, available: this.getAvailable().length };
  }

  createDefaults(): void {
    this.register({
      id: "ms-marco-minilm", name: "MS MARCO MiniLM", version: "v2",
      runtimeId: "ollama-local", format: "onnx", quantization: "fp16",
      architecture: "minilm", contextWindow: 512, parameters: 0.033,
      capabilities: ["reranking"],
      capabilityScores: { reranking: 85 },
      memoryUsage: { loadGB: 0.2, inferenceGB: 0.3, peakGB: 0.4, cpuGB: 1 },
      toolSupport: false, visionSupport: false, audioSupport: false,
      functionCalling: false, streaming: false, jsonMode: false,
      status: "available", source: "local",
      licensing: { name: "MIT", allowsCommercial: true, allowsModification: true, attributionRequired: false },
      performance: { id: "", modelId: "", runtimeId: "", benchmarkType: "comprehensive", scores: {}, metrics: { latencyP50Ms: 5, latencyP95Ms: 15, latencyP99Ms: 30, throughputTokensPerSec: 500, memoryPeakMB: 400, gpuUtilizationPeak: 0, reliabilityPercent: 99, tokensPerSecond: 500, timeToFirstTokenMs: 5, errorRate: 0.001 }, startedAt: now(), completedAt: now(), durationMs: 0, dataset: "default", version: "1" },
      qualityScores: {}, discoveryMethod: "automatic", registeredAt: now(), updatedAt: now(),
      maxInputTokens: 512, maxDocuments: 100,
    });
  }
}
