import { now } from "../core/types.js";
import type { DashboardData, DashboardActivity } from "./types.js";
import type { RuntimeRegistry } from "./runtime-registry.js";
import type { ModelRegistry } from "./model-registry.js";
import type { PipelineManager } from "./pipeline-manager.js";
import type { BenchmarkEngine } from "./benchmark-engine.js";
import type { DownloadManager } from "./download-manager.js";
import type { GpuScheduler } from "./gpu-scheduler.js";
import type { RuntimeMonitor } from "./runtime-monitor.js";

export class Dashboard {
  private activities: DashboardActivity[] = [];
  private maxActivities = 100;
  private runtimeRegistry: RuntimeRegistry;
  private modelRegistry: ModelRegistry;
  private pipelineManager: PipelineManager;
  private benchmarkEngine: BenchmarkEngine;
  private downloadManager: DownloadManager;
  private gpuScheduler: GpuScheduler;
  private runtimeMonitor: RuntimeMonitor;

  constructor(
    runtimeRegistry: RuntimeRegistry, modelRegistry: ModelRegistry,
    pipelineManager: PipelineManager, benchmarkEngine: BenchmarkEngine,
    downloadManager: DownloadManager, gpuScheduler: GpuScheduler,
    runtimeMonitor: RuntimeMonitor,
  ) {
    this.runtimeRegistry = runtimeRegistry;
    this.modelRegistry = modelRegistry;
    this.pipelineManager = pipelineManager;
    this.benchmarkEngine = benchmarkEngine;
    this.downloadManager = downloadManager;
    this.gpuScheduler = gpuScheduler;
    this.runtimeMonitor = runtimeMonitor;
  }

  getData(): DashboardData {
    const modelStats = this.modelRegistry.getStats();
    const runtimeStats = this.runtimeRegistry.getStats();
    const pipelineStats = this.pipelineManager.getStats();
    const gpuStats = this.gpuScheduler.getStats();
    const downloadStats = this.downloadManager.getStats();
    const monitorSummary = this.runtimeMonitor.getSystemSummary();
    const benchmarkStats = this.benchmarkEngine.getStats();

    const lastBench = benchmarkStats.total > 0 ? now() : undefined;
    const allBench = this.benchmarkEngine.getResults();
    const avgScore = allBench.length > 0
      ? Math.round(allBench.reduce((s, r) => {
          const scores = Object.values(r.scores);
          return s + (scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length));
        }, 0) / allBench.length)
      : 0;

    return {
      models: { total: modelStats.total, loaded: modelStats.loaded, downloading: modelStats.downloading, errored: modelStats.errored },
      runtimes: { total: runtimeStats.total, active: runtimeStats.active, errored: runtimeStats.errored },
      pipelines: { total: pipelineStats.totalPipelines, running: 0, success: pipelineStats.success, failed: pipelineStats.failed },
      hardware: {
        gpuUtilization: monitorSummary.gpu.utilization,
        cpuUtilization: null,
        memoryUtilization: null,
        vramUtilization: monitorSummary.gpu.memoryUtilization,
      },
      benchmarks: { total: benchmarkStats.total, averageScore: avgScore, lastRun: lastBench },
      downloads: { active: downloadStats.active, queued: downloadStats.queued, speedBytesPerSec: downloadStats.speedBytesPerSec },
      recentActivity: this.activities.slice(-10).reverse(),
    };
  }

  addActivity(type: DashboardActivity["type"], message: string, severity: DashboardActivity["severity"] = "info"): void {
    this.activities.push({ timestamp: now(), type, message, severity });
    if (this.activities.length > this.maxActivities) this.activities.shift();
  }

  getActivities(limit = 50): DashboardActivity[] {
    return this.activities.slice(-limit).reverse();
  }

  clearActivities(): void {
    this.activities = [];
  }
}
