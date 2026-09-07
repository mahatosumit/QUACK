import { now } from "../core/types.js";
import type { VisionModelInfo, ModelStatus } from "./types.js";

export class VisionRegistry {
  private models: Map<string, VisionModelInfo> = new Map();

  register(model: VisionModelInfo): void {
    this.models.set(model.id, model);
  }

  unregister(id: string): boolean {
    return this.models.delete(id);
  }

  get(id: string): VisionModelInfo | undefined {
    return this.models.get(id);
  }

  getAll(): VisionModelInfo[] {
    return Array.from(this.models.values());
  }

  getAvailable(): VisionModelInfo[] {
    return this.getAll().filter((m) => m.status === "available" || m.status === "loaded");
  }

  findByImageFormat(format: string): VisionModelInfo[] {
    return this.getAvailable().filter((m) => m.supportedImageFormats.includes(format));
  }

  updateStatus(id: string, status: ModelStatus): boolean {
    const m = this.models.get(id);
    if (!m) return false;
    m.status = status;
    return true;
  }

  getStats(): { total: number; available: number; withOcr: number; withObjectDetection: number } {
    const all = this.getAll();
    const avail = this.getAvailable();
    return {
      total: all.length,
      available: avail.length,
      withOcr: avail.filter((m) => m.ocrSupport).length,
      withObjectDetection: avail.filter((m) => m.objectDetection).length,
    };
  }

  createDefaults(): void {
    this.register({
      id: "llava-7b", name: "LLaVA 7B", version: "1.6",
      runtimeId: "ollama-local", format: "gguf", quantization: "gguf_q4",
      architecture: "llava", contextWindow: 4096, parameters: 7,
      capabilities: ["vision", "chat", "reasoning"],
      capabilityScores: { vision: 80, chat: 75, reasoning: 65 },
      memoryUsage: { loadGB: 4.5, inferenceGB: 5, peakGB: 5.5, cpuGB: 8 },
      toolSupport: false, visionSupport: true, audioSupport: false,
      functionCalling: false, streaming: true, jsonMode: false,
      status: "available", source: "local",
      licensing: { name: "LLaVA", allowsCommercial: true, allowsModification: true, attributionRequired: false },
      performance: { id: "", modelId: "", runtimeId: "", benchmarkType: "vision", scores: {}, metrics: { latencyP50Ms: 300, latencyP95Ms: 600, latencyP99Ms: 1000, throughputTokensPerSec: 20, memoryPeakMB: 5000, gpuUtilizationPeak: 85, reliabilityPercent: 92, tokensPerSecond: 20, timeToFirstTokenMs: 500, errorRate: 0.03 }, startedAt: now(), completedAt: now(), durationMs: 0, dataset: "default", version: "1" },
      qualityScores: {}, discoveryMethod: "automatic", registeredAt: now(), updatedAt: now(),
      supportedImageFormats: ["png", "jpg", "jpeg", "webp"], maxImageSize: 10, objectDetection: false, faceDetection: false, ocrSupport: true,
    });
  }
}
