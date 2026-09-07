import { now } from "../core/types.js";
import type { RuntimeMonitorSnapshot, RuntimeHealthEntry, ModelHealthEntry, GpuHealthEntry, MemoryState, RuntimeStatus, HealthStatus } from "./types.js";
import { RuntimeRegistry } from "./runtime-registry.js";
import { ModelRegistry } from "./model-registry.js";

export class RuntimeMonitor {
  private snapshots: RuntimeMonitorSnapshot[] = [];
  private maxSnapshots = 500;
  private runtimeRegistry: RuntimeRegistry;
  private modelRegistry: ModelRegistry;
  private errorCount = 0;
  private lastError: string | undefined;

  constructor(runtimeRegistry: RuntimeRegistry, modelRegistry: ModelRegistry) {
    this.runtimeRegistry = runtimeRegistry;
    this.modelRegistry = modelRegistry;
  }

  async collectSnapshot(): Promise<RuntimeMonitorSnapshot> {
    throw new Error("AIRM hardware telemetry is unsupported: no measurement provider is configured.");
  }

  getLatestSnapshot(): RuntimeMonitorSnapshot | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  getSnapshots(limit = 10): RuntimeMonitorSnapshot[] {
    return this.snapshots.slice(-limit);
  }

  reportError(error: string): void {
    this.lastError = error;
    this.errorCount++;
  }

  getSystemSummary(): { runtimes: { total: number; healthy: number; errored: number }; models: { total: number; loaded: number }; gpu: { utilization: number | null; memoryUtilization: number | null }; health: HealthStatus } {
    const latest = this.getLatestSnapshot();
    const rt = this.runtimeRegistry.getStats();
    const md = this.modelRegistry.getStats();
    const gpuUtil = latest?.gpus[0]?.utilization ?? null;
    const gpuMemUtil = latest?.gpus[0] ? (latest.gpus[0].memoryUsedMB / latest.gpus[0].memoryTotalMB) * 100 : null;
    const health: HealthStatus = latest ? (rt.errored > 0 ? "degraded" : "healthy") : "unknown";
    return {
      runtimes: { total: rt.total, healthy: rt.healthy, errored: rt.errored },
      models: { total: md.total, loaded: md.loaded },
      gpu: { utilization: gpuUtil, memoryUtilization: gpuMemUtil === null ? null : Math.round(gpuMemUtil) },
      health,
    };
  }

  clearHistory(): void {
    this.snapshots = [];
  }
}
