import { createId, now } from "../core/types.js";
import type { ExperiencePattern } from "./types.js";

export function createExperienceMiningEngine() {
  const patterns: ExperiencePattern[] = [];
  const maxPatterns = 1000;

  function recordPattern(pattern: ExperiencePattern): void {
    const existing = patterns.findIndex(
      (p) => p.pattern === pattern.pattern
    );
    if (existing >= 0) {
      patterns[existing].frequency++;
      patterns[existing].successRate =
        (patterns[existing].successRate + pattern.successRate) / 2;
      patterns[existing].lastObserved = now();
      const newTags = pattern.tags.filter(
        (t) => !patterns[existing].tags.includes(t)
      );
      patterns[existing].tags.push(...newTags);
    } else {
      patterns.push({ ...pattern, id: pattern.id || createId("epat") });
      if (patterns.length > maxPatterns) {
        patterns.sort((a, b) => a.frequency - b.frequency);
        patterns.shift();
      }
    }
  }

  function findPatterns(context: string[]): ExperiencePattern[] {
    return patterns.filter((p) =>
      context.some((c) => p.tags.includes(c) || p.context.includes(c))
    ).sort((a, b) => b.frequency - a.frequency || b.successRate - a.successRate);
  }

  function getFrequentPatterns(limit: number): ExperiencePattern[] {
    return [...patterns]
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, limit);
  }

  function getStats(): Record<string, number> {
    const stats: Record<string, number> = { total: patterns.length };
    stats.avgFrequency =
      patterns.length > 0
        ? patterns.reduce((s, p) => s + p.frequency, 0) / patterns.length
        : 0;
    stats.avgSuccessRate =
      patterns.length > 0
        ? patterns.reduce((s, p) => s + p.successRate, 0) / patterns.length
        : 0;
    return stats;
  }

  return { recordPattern, findPatterns, getFrequentPatterns, getStats };
}
