import { createId, now } from "../core/types.js";
import type { KnowledgeEntry } from "./types.js";

export function createContinuousLearning() {
  const entries: KnowledgeEntry[] = [];
  const maxEntries = 5000;

  function addEntry(entry: KnowledgeEntry): void {
    entries.push({ ...entry, id: entry.id || createId("kl") });
    if (entries.length > maxEntries) {
      entries.splice(0, entries.length - maxEntries);
    }
  }

  function search(query: string, tags?: string[]): KnowledgeEntry[] {
    const lowerQuery = query.toLowerCase();
    let results = entries.filter(
      (e) =>
        e.content.toLowerCase().includes(lowerQuery) ||
        e.source.toLowerCase().includes(lowerQuery) ||
        e.tags.some((t) => t.toLowerCase().includes(lowerQuery))
    );

    if (tags && tags.length > 0) {
      results = results.filter((e) => tags.some((t) => e.tags.includes(t)));
    }

    return results.sort((a, b) => b.score - a.score);
  }

  function getTopEntries(limit: number): KnowledgeEntry[] {
    return [...entries]
      .sort((a, b) => b.score - a.score || b.usageCount - a.usageCount)
      .slice(0, limit);
  }

  function recordUsage(entryId: string): void {
    const entry = entries.find((e) => e.id === entryId);
    if (entry) {
      entry.usageCount++;
      entry.score = calculateScore(entry);
    }
  }

  function getStats(): Record<string, number> {
    const stats: Record<string, number> = { total: entries.length };
    for (const e of entries) {
      stats[`type_${e.type}`] = (stats[`type_${e.type}`] ?? 0) + 1;
    }
    stats.avgScore =
      entries.length > 0
        ? entries.reduce((s, e) => s + e.score, 0) / entries.length
        : 0;
    return stats;
  }

  function createKnowledgeEntry(
    type: KnowledgeEntry["type"],
    content: string,
    source: string,
    tags: string[] = []
  ): KnowledgeEntry {
    return {
      id: createId("kl"),
      type,
      content,
      source,
      tags,
      usageCount: 0,
      score: 0,
      createdAt: now(),
    };
  }

  return { addEntry, search, getTopEntries, recordUsage, getStats, createKnowledgeEntry };
}

function calculateScore(entry: KnowledgeEntry): number {
  return Math.min(100, entry.usageCount * 10 + entry.source.length * 0.1);
}
