import { createId, now } from "../core/types.js";
import { type OrgMemoryEntry } from "./types.js";

export class OrganizationalMemory {
  private entries: OrgMemoryEntry[] = [];
  private indexByType = new Map<string, Set<string>>();
  private indexByTag = new Map<string, Set<string>>();
  private maxEntries = 5000;

  record(entry: Omit<OrgMemoryEntry, "id" | "timestamp" | "relevanceScore" | "accessCount">): OrgMemoryEntry {
    if (this.entries.length >= this.maxEntries) {
      this.entries.sort((a, b) => a.relevanceScore - b.relevanceScore);
      const removed = this.entries.shift()!;
      this.removeFromIndex(removed);
    }

    const full: OrgMemoryEntry = {
      ...entry,
      id: createId("orgmem"),
      timestamp: now(),
      relevanceScore: 1,
      accessCount: 0,
    };

    this.entries.push(full);
    this.addToIndex(full);
    return full;
  }

  recordSuccess(agents: string[], content: string): OrgMemoryEntry {
    return this.record({ type: "success", tags: ["success"], agents, content });
  }

  recordFailure(agents: string[], content: string): OrgMemoryEntry {
    return this.record({ type: "failure", tags: ["failure"], agents, content });
  }

  recordDecision(topic: string, agents: string[], content: string): OrgMemoryEntry {
    return this.record({ type: "decision", tags: ["decision", topic], agents, content });
  }

  recordLesson(agents: string[], content: string): OrgMemoryEntry {
    return this.record({ type: "lesson", tags: ["lesson"], agents, content });
  }

  recordArchitecture(component: string, agents: string[], content: string): OrgMemoryEntry {
    return this.record({ type: "architecture", tags: ["architecture", component], agents, content });
  }

  queryByType(type: OrgMemoryEntry["type"]): OrgMemoryEntry[] {
    const ids = this.indexByType.get(type);
    if (!ids) return [];
    return [...ids]
      .map((id) => this.entries.find((e) => e.id === id))
      .filter((e): e is OrgMemoryEntry => e !== undefined)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  queryByTag(tag: string): OrgMemoryEntry[] {
    const ids = this.indexByTag.get(tag);
    if (!ids) return [];
    return [...ids]
      .map((id) => this.entries.find((e) => e.id === id))
      .filter((e): e is OrgMemoryEntry => e !== undefined)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  search(query: string): OrgMemoryEntry[] {
    const lower = query.toLowerCase();
    return this.entries
      .filter((e) =>
        e.content.toLowerCase().includes(lower) ||
        e.tags.some((t) => t.toLowerCase().includes(lower)),
      )
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  getRelated(tag: string, limit = 5): OrgMemoryEntry[] {
    return this.queryByTag(tag).slice(0, limit);
  }

  getTopPatterns(limit = 10): { type: string; count: number; avgScore: number }[] {
    const grouped = new Map<string, { count: number; totalScore: number }>();
    for (const e of this.entries) {
      const key = e.type;
      const existing = grouped.get(key) ?? { count: 0, totalScore: 0 };
      existing.count++;
      existing.totalScore += e.relevanceScore;
      grouped.set(key, existing);
    }
    return [...grouped.entries()]
      .map(([type, val]) => ({ type, count: val.count, avgScore: val.totalScore / val.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  updateRelevance(id: string, delta: number): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      entry.relevanceScore = Math.max(0, entry.relevanceScore + delta);
      entry.accessCount++;
    }
  }

  getStats(): { total: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    for (const e of this.entries) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
    }
    return { total: this.entries.length, byType };
  }

  getAll(): OrgMemoryEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
    this.indexByType.clear();
    this.indexByTag.clear();
  }

  private addToIndex(entry: OrgMemoryEntry): void {
    if (!this.indexByType.has(entry.type)) {
      this.indexByType.set(entry.type, new Set());
    }
    this.indexByType.get(entry.type)!.add(entry.id);

    for (const tag of entry.tags) {
      if (!this.indexByTag.has(tag)) {
        this.indexByTag.set(tag, new Set());
      }
      this.indexByTag.get(tag)!.add(entry.id);
    }
  }

  private removeFromIndex(entry: OrgMemoryEntry): void {
    this.indexByType.get(entry.type)?.delete(entry.id);
    for (const tag of entry.tags) {
      this.indexByTag.get(tag)?.delete(entry.id);
    }
  }
}
