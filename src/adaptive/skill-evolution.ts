import { createId, now } from "../core/types.js";
import type { SkillVersion, SkillBenchmark } from "./types.js";

export function createSkillEvolutionEngine() {
  const skillVersions = new Map<string, SkillVersion[]>();

  function ensureSkill(skillId: string): SkillVersion[] {
    if (!skillVersions.has(skillId)) {
      skillVersions.set(skillId, []);
    }
    return skillVersions.get(skillId)!;
  }

  function getSkillVersions(skillId: string): SkillVersion[] {
    return ensureSkill(skillId);
  }

  function recordBenchmark(skillId: string, benchmark: SkillBenchmark): void {
    const versions = ensureSkill(skillId);
    if (versions.length === 0) {
      const version: SkillVersion = {
        id: createId("sv"),
        version: 1,
        definition: {},
        benchmarks: [benchmark],
        parentId: null,
        createdAt: now(),
        deprecated: false,
      };
      versions.push(version);
    } else {
      const latest = versions[versions.length - 1];
      latest.benchmarks.push(benchmark);
    }
  }

  function compareVersions(skillId: string, v1: number, v2: number): SkillBenchmark[] {
    const versions = skillVersions.get(skillId);
    if (!versions) return [];

    const ver1 = versions.find((v) => v.version === v1);
    const ver2 = versions.find((v) => v.version === v2);
    if (!ver1 || !ver2) return [];

    return [...ver1.benchmarks, ...ver2.benchmarks];
  }

  function deprecateVersion(skillId: string, version: number): void {
    const versions = skillVersions.get(skillId);
    if (!versions) throw new Error(`Skill ${skillId} not found`);
    const ver = versions.find((v) => v.version === version);
    if (!ver) throw new Error(`Version ${version} not found`);
    ver.deprecated = true;
  }

  function recommendUpgrade(skillId: string): number | null {
    const versions = skillVersions.get(skillId);
    if (!versions || versions.length < 2) return null;

    const activeVersions = versions.filter((v) => !v.deprecated);
    if (activeVersions.length < 2) return null;

    let bestVersion: SkillVersion | null = null;
    let bestScore = 0;

    for (const v of activeVersions) {
      if (v.benchmarks.length === 0) continue;
      const avgPassRate =
        v.benchmarks.reduce((sum, b) => sum + b.passRate, 0) /
        v.benchmarks.length;
      if (avgPassRate > bestScore) {
        bestScore = avgPassRate;
        bestVersion = v;
      }
    }

    return bestVersion ? bestVersion.version : null;
  }

  return { getSkillVersions, recordBenchmark, compareVersions, deprecateVersion, recommendUpgrade };
}
