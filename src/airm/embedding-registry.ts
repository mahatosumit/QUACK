import { now } from "../core/types.js";
import type { EmbeddingModelInfo, ModelStatus } from "./types.js";

export class EmbeddingRegistry {
  private models: Map<string, EmbeddingModelInfo> = new Map();

  register(model: EmbeddingModelInfo): void {
    this.models.set(model.id, model);
  }

  unregister(id: string): boolean {
    return this.models.delete(id);
  }

  get(id: string): EmbeddingModelInfo | undefined {
    return this.models.get(id);
  }

  getAll(): EmbeddingModelInfo[] {
    return Array.from(this.models.values());
  }

  getAvailable(): EmbeddingModelInfo[] {
    return this.getAll().filter((m) => m.status === "available" || m.status === "loaded");
  }

  findByDimension(minDimensions: number, maxDimensions?: number): EmbeddingModelInfo[] {
    return this.getAvailable().filter((m) => {
      if (m.dimensions < minDimensions) return false;
      if (maxDimensions !== undefined && m.dimensions > maxDimensions) return false;
      return true;
    });
  }

  findBySimilarity(metric: "cosine" | "dot" | "euclidean"): EmbeddingModelInfo[] {
    return this.getAvailable().filter((m) => m.similarityMetric === metric);
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
      id: "nomic-embed-text", name: "Nomic Embed Text", version: "1.5",
      runtimeId: "ollama-local", format: "gguf", quantization: "gguf_q4",
      architecture: "bert", contextWindow: 2048, parameters: 0.137,
      capabilities: ["embeddings"], capabilityScores: { embeddings: 90 },
      memoryUsage: { loadGB: 0.3, inferenceGB: 0.5, peakGB: 0.6, cpuGB: 1 },
      toolSupport: false, visionSupport: false, audioSupport: false,
      functionCalling: false, streaming: false, jsonMode: false,
      status: "available", source: "local",
      licensing: { name: "Apache 2.0", allowsCommercial: true, allowsModification: true, attributionRequired: true },
      performance: { id: "", modelId: "", runtimeId: "", benchmarkType: "comprehensive", scores: {}, metrics: { latencyP50Ms: 10, latencyP95Ms: 25, latencyP99Ms: 50, throughputTokensPerSec: 100, memoryPeakMB: 500, gpuUtilizationPeak: 0, reliabilityPercent: 99, tokensPerSecond: 100, timeToFirstTokenMs: 10, errorRate: 0.001 }, startedAt: now(), completedAt: now(), durationMs: 0, dataset: "default", version: "1" },
      qualityScores: {}, discoveryMethod: "automatic", registeredAt: now(), updatedAt: now(),
      dimensions: 768, maxInputTokens: 2048, similarityMetric: "cosine",
    });
  }
}
