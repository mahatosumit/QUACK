import { createId, now } from "../core/types.js";
import { type ExperienceRecord } from "./types.js";

export class ExperienceEngine {
  private experiences = new Map<string, ExperienceRecord>();

  save(params: {
    title: string;
    category: ExperienceRecord["category"];
    description: string;
    context: string[];
    steps: string[];
    outcome?: "success" | "failure";
    tags?: string[];
    sourceGoalId?: string;
    createdBy: string;
  }): ExperienceRecord {
    const record: ExperienceRecord = {
      id: createId("exp"),
      title: params.title,
      category: params.category,
      description: params.description,
      context: params.context,
      steps: params.steps,
      outcome: params.outcome ?? "success",
      tags: params.tags ?? [],
      relevance: 1,
      usageCount: 0,
      sourceGoalId: params.sourceGoalId,
      createdBy: params.createdBy,
      createdAt: now(),
    };
    this.experiences.set(record.id, record);
    return record;
  }

  get(id: string): ExperienceRecord | undefined {
    return this.experiences.get(id);
  }

  search(query: string, category?: string): ExperienceRecord[] {
    const lower = query.toLowerCase();
    return this.getAll().filter((e) => {
      if (category && e.category !== category) return false;
      return (
        e.title.toLowerCase().includes(lower) ||
        e.description.toLowerCase().includes(lower) ||
        e.tags.some((t) => t.toLowerCase().includes(lower)) ||
        e.context.some((c) => c.toLowerCase().includes(lower))
      );
    });
  }

  findByTag(tag: string): ExperienceRecord[] {
    return this.getAll().filter((e) => e.tags.includes(tag));
  }

  findByCategory(category: ExperienceRecord["category"]): ExperienceRecord[] {
    return this.getAll().filter((e) => e.category === category);
  }

  getAll(): ExperienceRecord[] {
    return [...this.experiences.values()].sort((a, b) => b.relevance - a.relevance);
  }

  recordUsage(id: string): void {
    const exp = this.experiences.get(id);
    if (exp) {
      exp.usageCount++;
      exp.lastUsedAt = now();
      exp.relevance = Math.min(10, exp.relevance + 0.5);
    }
  }

  recommend(context: string[], limit = 5): ExperienceRecord[] {
    const scored = this.getAll().map((e) => {
      const matchCount = context.filter((c) =>
        e.title.toLowerCase().includes(c.toLowerCase()) ||
        e.description.toLowerCase().includes(c.toLowerCase()) ||
        e.tags.some((t) => t.toLowerCase().includes(c.toLowerCase())),
      ).length;
      return { experience: e, score: matchCount * 2 + e.relevance + e.usageCount * 0.5 };
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.experience);
  }

  getStats(): { total: number; byCategory: Record<string, number> } {
    const byCategory: Record<string, number> = {};
    for (const e of this.getAll()) {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
    }
    return { total: this.experiences.size, byCategory };
  }

  clear(): void {
    this.experiences.clear();
  }
}
