import { now } from "../core/types.js";
import type { SpeechModelInfo, ModelStatus } from "./types.js";

export class SpeechRegistry {
  private models: Map<string, SpeechModelInfo> = new Map();

  register(model: SpeechModelInfo): void {
    this.models.set(model.id, model);
  }

  unregister(id: string): boolean {
    return this.models.delete(id);
  }

  get(id: string): SpeechModelInfo | undefined {
    return this.models.get(id);
  }

  getAll(): SpeechModelInfo[] {
    return Array.from(this.models.values());
  }

  getAvailable(): SpeechModelInfo[] {
    return this.getAll().filter((m) => m.status === "available" || m.status === "loaded");
  }

  findByLanguage(language: string): SpeechModelInfo[] {
    return this.getAvailable().filter((m) => m.languages.includes(language));
  }

  updateStatus(id: string, status: ModelStatus): boolean {
    const m = this.models.get(id);
    if (!m) return false;
    m.status = status;
    return true;
  }

  getStats(): { total: number; available: number; withVoiceCloning: number } {
    const all = this.getAll();
    return {
      total: all.length,
      available: this.getAvailable().length,
      withVoiceCloning: all.filter((m) => m.voiceCloning).length,
    };
  }

  createDefaults(): void {
    this.register({
      id: "whisper-small", name: "Whisper Small", version: "latest",
      runtimeId: "ollama-local", format: "gguf", quantization: "gguf_q4",
      architecture: "whisper", contextWindow: 4096, parameters: 0.25,
      capabilities: ["speech-recognition"],
      capabilityScores: { "speech-recognition": 85 },
      memoryUsage: { loadGB: 0.5, inferenceGB: 0.8, peakGB: 1, cpuGB: 2 },
      toolSupport: false, visionSupport: false, audioSupport: true,
      functionCalling: false, streaming: false, jsonMode: false,
      status: "available", source: "local",
      licensing: { name: "MIT", allowsCommercial: true, allowsModification: true, attributionRequired: false },
      performance: { id: "", modelId: "", runtimeId: "", benchmarkType: "comprehensive", scores: {}, metrics: { latencyP50Ms: 50, latencyP95Ms: 100, latencyP99Ms: 200, throughputTokensPerSec: 0, memoryPeakMB: 1000, gpuUtilizationPeak: 30, reliabilityPercent: 95, tokensPerSecond: 0, timeToFirstTokenMs: 50, errorRate: 0.01 }, startedAt: now(), completedAt: now(), durationMs: 0, dataset: "default", version: "1" },
      qualityScores: {}, discoveryMethod: "automatic", registeredAt: now(), updatedAt: now(),
      sampleRate: 16000, languages: ["en", "es", "fr", "de", "zh", "ja"], voiceCloning: false, realtimeSupport: true,
    });
  }
}
