import { now } from "../core/types.js";
import type { DownloadTask, DownloadStatus } from "./types.js";

export class DownloadManager {
  private downloads: Map<string, DownloadTask> = new Map();
  private maxConcurrent = 3;
  private activeCount = 0;
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    for (const [id, task] of this.downloads) {
      if (task.status === "downloading") {
        task.status = "paused";
      }
    }
    this.initialized = false;
  }

  enqueue(url: string, destination: string, metadata?: Record<string, unknown>): string {
    const id = createId();
    const task: DownloadTask = {
      id, url, destination, status: "queued", progress: 0,
      totalBytes: 0, downloadedBytes: 0, speedBytesPerSec: 0,
      metadata: metadata ?? {},
    };
    this.downloads.set(id, task);
    this.processQueue();
    return id;
  }

  pause(id: string): boolean {
    const task = this.downloads.get(id);
    if (!task || task.status !== "downloading") return false;
    task.status = "paused";
    this.activeCount--;
    return true;
  }

  resume(id: string): boolean {
    const task = this.downloads.get(id);
    if (!task || task.status !== "paused") return false;
    task.status = "queued";
    this.processQueue();
    return true;
  }

  cancel(id: string): boolean {
    const task = this.downloads.get(id);
    if (!task) return false;
    if (task.status === "downloading") this.activeCount--;
    task.status = "cancelled";
    return true;
  }

  get(id: string): DownloadTask | undefined {
    return this.downloads.get(id);
  }

  getAll(): DownloadTask[] {
    return Array.from(this.downloads.values());
  }

  getActive(): DownloadTask[] {
    return this.getAll().filter((t) => t.status === "downloading");
  }

  getQueued(): DownloadTask[] {
    return this.getAll().filter((t) => t.status === "queued");
  }

  getCompleted(): DownloadTask[] {
    return this.getAll().filter((t) => t.status === "completed");
  }

  setMaxConcurrent(n: number): void {
    this.maxConcurrent = Math.max(1, n);
  }

  getStats(): { active: number; queued: number; completed: number; failed: number; paused: number; speedBytesPerSec: number } {
    const all = this.getAll();
    return {
      active: all.filter((t) => t.status === "downloading").length,
      queued: all.filter((t) => t.status === "queued").length,
      completed: all.filter((t) => t.status === "completed").length,
      failed: all.filter((t) => t.status === "failed").length,
      paused: all.filter((t) => t.status === "paused").length,
      speedBytesPerSec: all.filter((t) => t.status === "downloading").reduce((s, t) => s + t.speedBytesPerSec, 0),
    };
  }

  private processQueue(): void {
    while (this.activeCount < this.maxConcurrent) {
      const next = this.getQueued()[0];
      if (!next) break;
      this.startDownload(next);
    }
  }

  private async startDownload(task: DownloadTask): Promise<void> {
    task.status = "failed";
    task.error = "Downloads are unsupported: no download transport is configured.";
    task.completedAt = now();
  }
}

function createId(): string {
  return `dl-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}
