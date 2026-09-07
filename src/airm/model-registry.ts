import { now } from "../core/types.js";
import type { ModelInfo, ModelStatus, AiCapability, ModelFormat, Quantization, DiscoveryMethod, ModelSearchQuery } from "./types.js";

export class ModelRegistry {
  private models: Map<string, ModelInfo> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  register(model: ModelInfo): void {
    this.models.set(model.id, model);
  }

  unregister(id: string): boolean {
    return this.models.delete(id);
  }

  get(id: string): ModelInfo | undefined {
    return this.models.get(id);
  }

  getAll(): ModelInfo[] {
    return Array.from(this.models.values());
  }

  getByRuntime(runtimeId: string): ModelInfo[] {
    return this.getAll().filter((m) => m.runtimeId === runtimeId);
  }

  getByCapability(capability: AiCapability, minScore?: number): ModelInfo[] {
    return this.getAll().filter((m) => {
      const score = m.capabilityScores[capability];
      return score !== undefined && (minScore === undefined || score >= minScore);
    });
  }

  getByFormat(format: ModelFormat): ModelInfo[] {
    return this.getAll().filter((m) => m.format === format);
  }

  getByQuantization(quant: Quantization): ModelInfo[] {
    return this.getAll().filter((m) => m.quantization === quant);
  }

  getLoaded(): ModelInfo[] {
    return this.getAll().filter((m) => m.status === "loaded");
  }

  getAvailable(): ModelInfo[] {
    return this.getAll().filter((m) => m.status === "available" || m.status === "loaded");
  }

  getBySource(source: string): ModelInfo[] {
    return this.getAll().filter((m) => m.source === source);
  }

  search(query: ModelSearchQuery): ModelInfo[] {
    return this.getAll().filter((m) => {
      if (query.capabilities && !query.capabilities.every((c) => m.capabilities.includes(c))) return false;
      if (query.minContextWindow && m.contextWindow < query.minContextWindow) return false;
      if (query.maxParameters && m.parameters > query.maxParameters) return false;
      if (query.formats && !query.formats.includes(m.format)) return false;
      if (query.runtimes) {
        const rt = this.getRuntimeType(m.runtimeId);
        if (!rt || !query.runtimes.includes(rt)) return false;
      }
      if (query.quantizations && !query.quantizations.includes(m.quantization)) return false;
      if (query.minToolSupport && !m.toolSupport) return false;
      if (query.minVisionSupport && !m.visionSupport) return false;
      if (query.minStreaming && !m.streaming) return false;
      return true;
    });
  }

  updateStatus(id: string, status: ModelStatus): boolean {
    const m = this.models.get(id);
    if (!m) return false;
    m.status = status;
    m.updatedAt = now();
    return true;
  }

  updateScores(id: string, scores: Partial<Record<AiCapability, number>>): boolean {
    const m = this.models.get(id);
    if (!m) return false;
    Object.assign(m.capabilityScores, scores);
    m.updatedAt = now();
    return true;
  }

  getStats(): { total: number; loaded: number; available: number; downloading: number; errored: number; byRuntime: Record<string, number>; byCapability: Record<string, number> } {
    const all = this.getAll();
    const byRuntime: Record<string, number> = {};
    const byCapability: Record<string, number> = {};
    for (const m of all) {
      byRuntime[m.runtimeId] = (byRuntime[m.runtimeId] ?? 0) + 1;
      for (const c of m.capabilities) {
        byCapability[c] = (byCapability[c] ?? 0) + 1;
      }
    }
    return {
      total: all.length, loaded: all.filter((m) => m.status === "loaded").length,
      available: all.filter((m) => m.status === "available").length,
      downloading: all.filter((m) => m.status === "downloading").length,
      errored: all.filter((m) => m.status === "error").length,
      byRuntime, byCapability,
    };
  }

  autoDiscover(currentRuntimeIds: string[]): ModelInfo[] {
    // Discovery has no provider integration yet; never manufacture available models.
    return [];
  }

  private getRuntimeType(runtimeId: string): import("./types.js").RuntimeType | undefined {
    const rt = this.models.get(runtimeId);
    return undefined; // simplified — in production would query RuntimeRegistry
  }
}
