import { type TaskNode, type SchedulerConfig, type SchedulerStats, type TaskNodeResult } from "./types.js";

/** Deterministic admission and resource ownership for one workflow. */
export class ExecutionScheduler {
  private queue: TaskNode[] = [];
  private readonly running = new Map<string, readonly string[]>();
  private readonly resources = new Set<string>();
  private readonly queuedAt = new Map<string, number>();
  private readonly settled = new Set<string>();
  private completedCount = 0;
  private failedCount = 0;
  private skippedCount = 0;
  private waitTimes: number[] = [];
  private executionTimes: number[] = [];
  private throughputWindow: number[] = [];

  constructor(private readonly config: SchedulerConfig) {
    if (!Number.isInteger(config.maxParallelNodes) || config.maxParallelNodes < 1) throw new Error("maxParallelNodes must be a positive integer.");
    if (!Number.isFinite(config.defaultTimeoutMs) || config.defaultTimeoutMs <= 0) throw new Error("defaultTimeoutMs must be positive and finite.");
    if (!Number.isFinite(config.queuePollIntervalMs) || config.queuePollIntervalMs < 0) throw new Error("queuePollIntervalMs must be finite and non-negative.");
  }

  enqueue(nodes: TaskNode[]): void {
    for (const node of nodes) {
      if (this.running.has(node.id) || this.queuedAt.has(node.id) || this.settled.has(node.id)) continue;
      this.queue.push(node);
      this.queuedAt.set(node.id, Date.now());
    }
    const priority = { critical: 0, high: 1, medium: 2, low: 3 };
    this.queue.sort((a, b) => priority[a.priority] - priority[b.priority]);
  }

  dequeue(): TaskNode | undefined {
    if (!this.canAccept()) return undefined;
    const index = this.queue.findIndex(node => (node.resources ?? []).every(resource => !this.resources.has(resource)));
    if (index < 0) return undefined;
    const [node] = this.queue.splice(index, 1);
    const resources = [...new Set(node.resources ?? [])];
    this.running.set(node.id, resources);
    for (const resource of resources) this.resources.add(resource);
    this.waitTimes.push(Date.now() - this.queuedAt.get(node.id)!);
    this.queuedAt.delete(node.id);
    return node;
  }

  complete(nodeId: string, result: TaskNodeResult): void {
    if (this.settled.has(nodeId)) return;
    this.release(nodeId);
    this.settled.add(nodeId);
    if (result.success) this.completedCount++;
    else this.failedCount++;
    this.executionTimes.push(result.durationMs);
    this.throughputWindow.push(Date.now());
  }

  skip(nodeId: string): void {
    if (this.settled.has(nodeId)) return;
    this.release(nodeId);
    this.settled.add(nodeId);
    this.skippedCount++;
  }

  release(nodeId: string): void {
    for (const resource of this.running.get(nodeId) ?? []) this.resources.delete(resource);
    this.running.delete(nodeId);
    this.queue = this.queue.filter(node => node.id !== nodeId);
    this.queuedAt.delete(nodeId);
  }

  canAccept(): boolean { return this.running.size < this.config.maxParallelNodes; }
  isFull(): boolean { return !this.canAccept(); }
  get runningCount(): number { return this.running.size; }
  get queuedCount(): number { return this.queue.length; }

  getStats(): SchedulerStats {
    const mean = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
    this.throughputWindow = this.throughputWindow.filter(time => time > Date.now() - 60_000);
    return { queued: this.queue.length, running: this.running.size, completed: this.completedCount,
      failed: this.failedCount, skipped: this.skippedCount, avgWaitTimeMs: mean(this.waitTimes),
      avgExecutionTimeMs: mean(this.executionTimes), throughput: this.throughputWindow.length };
  }

  reset(): void {
    if (this.running.size) throw new Error("Cannot reset a scheduler while operations are running.");
    this.queue = [];
    this.resources.clear();
    this.queuedAt.clear();
    this.settled.clear();
    this.completedCount = this.failedCount = this.skippedCount = 0;
    this.waitTimes = [];
    this.executionTimes = [];
    this.throughputWindow = [];
  }
}
