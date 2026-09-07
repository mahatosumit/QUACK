import { createId, now } from "../../core/types.js";
import { type SeaMemoryEntry, type SeaMemoryType, type EditingPlan, type EditingResult } from "../types.js";

interface StoredEntry {
  key: string;
  type: SeaMemoryType;
  data: Record<string, unknown>;
  timestamp: string;
  ttlMs: number;
}

export class SeaMemory {
  private entries = new Map<string, StoredEntry>();
  private editHistory: Array<{ plan: EditingPlan; result: EditingResult; timestamp: string }> = [];

  constructor(private readonly dataDir: string) {}

  async store(key: string, type: SeaMemoryType, data: Record<string, unknown>, ttlMs = 3_600_000): Promise<void> {
    this.entries.set(key, { key, type, data, timestamp: now(), ttlMs });
  }

  async retrieve(key: string): Promise<Record<string, unknown> | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - Date.parse(entry.timestamp) > entry.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.data;
  }

  async findByType(type: SeaMemoryType): Promise<StoredEntry[]> {
    const now = Date.now();
    return [...this.entries.values()]
      .filter((e) => e.type === type && (now - Date.parse(e.timestamp)) <= e.ttlMs);
  }

  async recordEdit(plan: EditingPlan, result: EditingResult): Promise<void> {
    this.editHistory.push({ plan, result, timestamp: now() });
    if (this.editHistory.length > 200) {
      this.editHistory = this.editHistory.slice(-200);
    }

    if (result.applied) {
      const existing = this.entries.get("last-edit-summary");
      if (!existing) {
        await this.store("last-edit-summary", "workspace-pattern", {
          description: plan.goal,
          files: plan.affectedFiles,
          validations: result.validationResults.filter((v) => v.passed).length,
        }, 86_400_000);
      }
    }
  }

  getEditHistory(): ReadonlyArray<{ plan: EditingPlan; result: EditingResult; timestamp: string }> {
    return this.editHistory;
  }

  async clear(): Promise<void> {
    this.entries.clear();
    this.editHistory = [];
  }

  stats(): { entries: number; editHistory: number } {
    return { entries: this.entries.size, editHistory: this.editHistory.length };
  }
}
