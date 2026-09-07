import { now } from "../core/types.js";
import type { NodeAdvert, NodeCapability, CapabilityCategory, ClusterNode } from "./types.js";

export interface TaskRequirement {
  requiredCapabilities: { category: CapabilityCategory; name: string; minScore?: number }[];
  preferredPlatform?: string;
  minMemoryGB?: number;
  minCpuCores?: number;
  requiresGpu?: boolean;
  requiresDesktop?: boolean;
}

export interface MatchResult {
  nodeId: string;
  score: number;
  breakdown: { category: CapabilityCategory; score: number; matched: boolean }[];
}

export class CapabilityNegotiator {
  private adverts: Map<string, NodeAdvert> = new Map();

  registerAdvert(advert: NodeAdvert): void {
    this.adverts.set(advert.nodeId, advert);
  }

  unregisterAdvert(nodeId: string): void {
    this.adverts.delete(nodeId);
  }

  getAdvert(nodeId: string): NodeAdvert | undefined {
    return this.adverts.get(nodeId);
  }

  getAllAdverts(): NodeAdvert[] {
    return Array.from(this.adverts.values());
  }

  findBestMatch(requirements: TaskRequirement, limit = 5): MatchResult[] {
    const scores: MatchResult[] = [];

    for (const [nodeId, advert] of this.adverts) {
      if (advert.availability !== "available") continue;
      if (advert.load >= 0.9) continue;

      if (requirements.minMemoryGB && advert.hardware.memory) {
        if (advert.hardware.memory.totalGB < requirements.minMemoryGB) continue;
      }

      if (requirements.requiresGpu && (!advert.hardware.gpus || advert.hardware.gpus.length === 0)) continue;

      const breakdown: MatchResult["breakdown"] = [];
      let totalScore = 0;
      let maxPossible = 0;

      for (const req of requirements.requiredCapabilities) {
        maxPossible += 100;
        const match = this.findCapability(advert.capabilities, req.category, req.name, req.minScore);
        if (match) {
          breakdown.push({ category: req.category, score: match.score, matched: true });
          totalScore += match.score;
        } else {
          breakdown.push({ category: req.category, score: 0, matched: false });
        }
      }

      const loadPenalty = advert.load * 20;
      totalScore = Math.max(0, totalScore - loadPenalty);

      scores.push({ nodeId, score: maxPossible > 0 ? Math.round((totalScore / maxPossible) * 100) : 0, breakdown });
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, limit);
  }

  findNodesWithCapability(category: CapabilityCategory, name: string, minScore = 1): NodeAdvert[] {
    return Array.from(this.adverts.values()).filter((a) => {
      if (a.availability !== "available") return false;
      return this.findCapability(a.capabilities, category, name, minScore) !== null;
    });
  }

  getCapabilityGaps(requirements: TaskRequirement): { category: CapabilityCategory; name: string; minScore?: number; availableNodes: number }[] {
    const gaps: { category: CapabilityCategory; name: string; minScore?: number; availableNodes: number }[] = [];
    for (const req of requirements.requiredCapabilities) {
      const nodes = this.findNodesWithCapability(req.category, req.name, req.minScore);
      if (nodes.length === 0) {
        gaps.push({ ...req, availableNodes: 0 });
      }
    }
    return gaps;
  }

  getCapabilityHeatmap(): Record<CapabilityCategory, { total: number; available: number; avgScore: number }> {
    const map: Record<string, { total: number; available: number; totalScore: number }> = {};
    for (const advert of this.adverts.values()) {
      for (const cap of advert.capabilities) {
        if (!map[cap.category]) map[cap.category] = { total: 0, available: 0, totalScore: 0 };
        map[cap.category]!.total++;
        if (advert.availability === "available") {
          map[cap.category]!.available++;
          map[cap.category]!.totalScore += cap.score;
        }
      }
    }
    const result = {} as Record<CapabilityCategory, { total: number; available: number; avgScore: number }>;
    for (const [cat, data] of Object.entries(map)) {
      result[cat as CapabilityCategory] = { total: data.total, available: data.available, avgScore: data.available > 0 ? Math.round(data.totalScore / data.available) : 0 };
    }
    return result;
  }

  private findCapability(caps: NodeCapability[], category: CapabilityCategory, name: string, minScore?: number): NodeCapability | null {
    return caps.find((c) => c.category === category && c.name.toLowerCase() === name.toLowerCase() && (minScore === undefined || c.score >= minScore)) ?? null;
  }
}
