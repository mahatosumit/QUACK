import type { GpuInfo, GpuProcess, ModelInfo, MemoryState } from "./types.js";

export class GpuScheduler {
  private gpus: Map<string, GpuInfo> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  getGpu(id: string): GpuInfo | undefined {
    return this.gpus.get(id);
  }

  getAllGpus(): GpuInfo[] {
    return Array.from(this.gpus.values());
  }

  getBestGpu(requiredVRAMMB: number): GpuInfo | undefined {
    const available = this.getAllGpus().filter((g) => g.freeVRAMMB >= requiredVRAMMB);
    return available.sort((a, b) => b.freeVRAMMB - a.freeVRAMMB)[0];
  }

  allocateModel(gpuId: string, model: ModelInfo): boolean {
    throw new Error("GPU allocation is unsupported: no hardware controller is configured.");
  }

  releaseModel(gpuId: string, modelId: string): boolean {
    throw new Error("GPU allocation is unsupported: no hardware controller is configured.");
  }

  canFitModel(model: ModelInfo): boolean {
    const neededMB = Math.round(model.memoryUsage.inferenceGB * 1024);
    return this.getAllGpus().some((g) => g.freeVRAMMB >= neededMB);
  }

  getStats(): { totalGpus: number; totalVRAMMB: number; freeVRAMMB: number; utilization: number; processes: number } {
    const all = this.getAllGpus();
    return {
      totalGpus: all.length,
      totalVRAMMB: all.reduce((s, g) => s + g.totalVRAMMB, 0),
      freeVRAMMB: all.reduce((s, g) => s + g.freeVRAMMB, 0),
      utilization: all.length > 0 ? Math.round(all.reduce((s, g) => s + g.utilization, 0) / all.length) : 0,
      processes: all.reduce((s, g) => s + g.processes.length, 0),
    };
  }
}
