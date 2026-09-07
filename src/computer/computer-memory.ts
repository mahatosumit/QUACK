import { now } from "../core/types.js";
import type {
  ComputerAction, ActionResult, ComputerObservation, ComputerPlan,
  RecordedStep, SessionRecording,
} from "./types.js";

export interface ComputerMemoryEntry {
  id: string;
  type: "observation" | "action_result" | "plan" | "recording" | "learned_pattern";
  data: unknown;
  context: string;
  tags: string[];
  timestamp: string;
  ttl?: number;
}

export class ComputerMemory {
  private entries: ComputerMemoryEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  recordObservation(observation: ComputerObservation, context: string): void {
    this.addEntry({ id: this.createId(), type: "observation", data: observation, context, tags: ["observation", observation.type], timestamp: now() });
  }

  recordActionResult(action: ComputerAction, result: ActionResult, context: string): void {
    this.addEntry({ id: this.createId(), type: "action_result", data: { action, result }, context, tags: ["action", result.type === "error" ? "error" : "success"], timestamp: now() });
  }

  recordPlan(plan: ComputerPlan): void {
    this.addEntry({ id: this.createId(), type: "plan", data: plan, context: plan.context, tags: ["plan", plan.goal], timestamp: now() });
  }

  recordRecording(recording: SessionRecording): void {
    this.addEntry({ id: this.createId(), type: "recording", data: { id: recording.id, name: recording.name, steps: recording.steps.length, tags: recording.tags }, context: recording.name, tags: ["recording", ...recording.tags], timestamp: now(), ttl: 7 * 24 * 60 * 60 * 1000 });
  }

  recordLearnedPattern(pattern: string, context: string): void {
    this.addEntry({ id: this.createId(), type: "learned_pattern", data: pattern, context, tags: ["pattern"], timestamp: now() });
  }

  query(tags?: string[], type?: string, limit = 10): ComputerMemoryEntry[] {
    let results = this.entries;
    if (type) results = results.filter((e) => e.type === type);
    if (tags && tags.length > 0) {
      results = results.filter((e) => tags.some((t) => e.tags.includes(t)));
    }
    return results.slice(-limit).reverse();
  }

  search(text: string): ComputerMemoryEntry[] {
    const lower = text.toLowerCase();
    return this.entries
      .filter((e) => {
        const str = JSON.stringify(e.data).toLowerCase();
        return str.includes(lower) || e.context.toLowerCase().includes(lower) || e.tags.some((t) => t.includes(lower));
      })
      .slice(-20)
      .reverse();
  }

  getRecentObservations(count = 5): ComputerObservation[] {
    return this.entries
      .filter((e) => e.type === "observation")
      .slice(-count)
      .reverse()
      .map((e) => e.data as ComputerObservation);
  }

  getRecentPlans(count = 5): ComputerPlan[] {
    return this.entries
      .filter((e) => e.type === "plan")
      .slice(-count)
      .reverse()
      .map((e) => e.data as ComputerPlan);
  }

  getStats(): { total: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    for (const e of this.entries) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
    }
    return { total: this.entries.length, byType };
  }

  clear(): void {
    this.entries = [];
  }

  private addEntry(entry: ComputerMemoryEntry): void {
    this.pruneExpired();
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  private pruneExpired(): void {
    const nowMs = Date.now();
    this.entries = this.entries.filter((e) => {
      if (!e.ttl) return true;
      const entryTime = new Date(e.timestamp).getTime();
      return nowMs - entryTime < e.ttl;
    });
  }

  private createId(): string {
    return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
  }
}
