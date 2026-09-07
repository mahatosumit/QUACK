import { now } from "../core/types.js";
import type { ScheduledTask } from "./types.js";

export class RuntimeScheduler {
  private tasks: Map<string, ScheduledTask> = new Map();
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onTaskReady: ((task: ScheduledTask) => Promise<void>) | null = null;

  onTask(callback: (task: ScheduledTask) => Promise<void>): void {
    this.onTaskReady = callback;
  }

  async start(intervalMs = 1000): Promise<void> {
    this.running = true;
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  schedule(task: Omit<ScheduledTask, "id" | "status" | "scheduledAt">): string {
    const id = createId();
    const scheduled: ScheduledTask = { id, ...task, status: "pending", scheduledAt: now() };
    this.tasks.set(id, scheduled);
    return id;
  }

  cancel(id: string): boolean {
    return this.tasks.delete(id);
  }

  getPending(): ScheduledTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === "pending");
  }

  getByType(type: string): ScheduledTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.type === type);
  }

  getAll(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  getStats(): { total: number; pending: number; running: number; completed: number; failed: number } {
    const all = Array.from(this.tasks.values());
    return {
      total: all.length,
      pending: all.filter((t) => t.status === "pending").length,
      running: all.filter((t) => t.status === "running").length,
      completed: all.filter((t) => t.status === "completed").length,
      failed: all.filter((t) => t.status === "failed").length,
    };
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    const pending = this.getPending().sort((a, b) => b.priority - a.priority);
    if (pending.length === 0) return;
    const task = pending[0]!;
    task.status = "running";
    task.startedAt = now();
    try {
      if (!this.onTaskReady) throw new Error("Scheduled execution is unsupported: no task executor is configured.");
      await this.onTaskReady(task);
      task.status = "completed";
    } catch (err) {
      task.status = "failed";
      task.error = err instanceof Error ? err.message : String(err);
    }
    task.completedAt = now();
  }
}

function createId(): string {
  return `sched-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}
