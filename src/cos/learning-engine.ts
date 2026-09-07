import { createId, now } from "../core/types.js";
import { type CosLearningRecord } from "./types.js";
import { type OrganizationalMemory } from "../organization/memory.js";

export class LearningEngine {
  private records = new Map<string, CosLearningRecord>();

  constructor(private orgMemory?: OrganizationalMemory) {}

  record(params: {
    pattern: string;
    insight: string;
    category: CosLearningRecord["category"];
    confidence?: number;
    evidence?: string[];
  }): CosLearningRecord {
    const record: CosLearningRecord = {
      id: createId("learn"),
      pattern: params.pattern,
      insight: params.insight,
      category: params.category,
      confidence: params.confidence ?? 0.5,
      evidence: params.evidence ?? [],
      appliedCount: 0,
      createdAt: now(),
    };
    this.records.set(record.id, record);
    this.orgMemory?.record({
      type: "lesson",
      tags: ["learning", params.category],
      agents: [],
      content: `[Learning] ${params.pattern}: ${params.insight} (confidence: ${record.confidence})`,
    });
    return record;
  }

  recordFromSuccess(pattern: string, insight: string, evidence: string[]): CosLearningRecord {
    return this.record({ pattern, insight, category: "workflow", confidence: 0.8, evidence });
  }

  recordFromFailure(pattern: string, insight: string, evidence: string[]): CosLearningRecord {
    return this.record({ pattern, insight, category: "workflow", confidence: 0.6, evidence });
  }

  apply(id: string): void {
    const record = this.records.get(id);
    if (record) {
      record.appliedCount++;
      record.lastApplied = now();
      record.confidence = Math.min(1, record.confidence + 0.1);
    }
  }

  get(id: string): CosLearningRecord | undefined {
    return this.records.get(id);
  }

  getAll(): CosLearningRecord[] {
    return [...this.records.values()].sort((a, b) => b.confidence - a.confidence);
  }

  findByCategory(category: CosLearningRecord["category"]): CosLearningRecord[] {
    return this.getAll().filter((l) => l.category === category);
  }

  findHighConfidence(minConfidence = 0.7): CosLearningRecord[] {
    return this.getAll().filter((l) => l.confidence >= minConfidence);
  }

  search(query: string): CosLearningRecord[] {
    const lower = query.toLowerCase();
    return this.getAll().filter((l) =>
      l.pattern.toLowerCase().includes(lower) ||
      l.insight.toLowerCase().includes(lower),
    );
  }

  getStats(): { total: number; avgConfidence: number; byCategory: Record<string, number> } {
    const all = this.getAll();
    const byCategory: Record<string, number> = {};
    for (const l of all) byCategory[l.category] = (byCategory[l.category] ?? 0) + 1;
    return {
      total: all.length,
      avgConfidence: all.length > 0 ? all.reduce((s, l) => s + l.confidence, 0) / all.length : 0,
      byCategory,
    };
  }

  clear(): void {
    this.records.clear();
  }
}
