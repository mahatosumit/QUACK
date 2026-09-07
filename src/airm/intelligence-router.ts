import type { RoutingRequest, RoutingDecision, RoutingBreakdown, AiCapability, ModelInfo, RuntimeInfo, RuntimeProfile } from "./types.js";
import { CapabilityRegistry } from "./capability-registry.js";
import { RuntimeRegistry } from "./runtime-registry.js";
import { ModelRegistry } from "./model-registry.js";

export interface RouterDependencies {
  capabilityRegistry: CapabilityRegistry;
  runtimeRegistry: RuntimeRegistry;
  modelRegistry: ModelRegistry;
  getProfile?: (profileId: string) => RuntimeProfile | undefined;
}

export class IntelligenceRouter {
  private deps: RouterDependencies;
  private policies: Map<string, RoutingPolicy> = new Map();

  constructor(deps: RouterDependencies) {
    this.deps = deps;
  }

  setPolicy(id: string, policy: RoutingPolicy): void {
    this.policies.set(id, policy);
  }

  getPolicy(id: string): RoutingPolicy | undefined {
    return this.policies.get(id);
  }

  removePolicy(id: string): boolean {
    return this.policies.delete(id);
  }

  async route(request: RoutingRequest): Promise<RoutingDecision | null> {
    const candidates = this.findCandidates(request);
    if (candidates.length === 0) return null;

    const scored = candidates.map((model) => ({
      model,
      score: this.scoreModel(model, request),
    }));
    scored.sort((a, b) => b.score.total - a.score.total);

    if (scored.length === 0) return null;
    const best = scored[0]!;
    return {
      modelId: best.model.model.id,
      runtimeId: best.model.model.runtimeId,
      score: best.score.total,
      breakdown: best.score.breakdown,
      alternatives: scored.slice(1, 4).map((s) => ({ modelId: s.model.model.id, score: s.score.total })),
    };
  }

  private findCandidates(request: RoutingRequest): { model: ModelInfo; runtime: RuntimeInfo }[] {
    const models = this.deps.modelRegistry.getAvailable();
    const candidates: { model: ModelInfo; runtime: RuntimeInfo }[] = [];
    for (const model of models) {
      const runtime = this.deps.runtimeRegistry.get(model.runtimeId);
      if (!runtime) continue;
      if (runtime.status !== "ready" && runtime.status !== "loading") continue;
      const hasAllCaps = request.requiredCapabilities.every((c) => model.capabilities.includes(c));
      if (!hasAllCaps) continue;
      if (request.constraints.offlineRequired && model.source !== "local") continue;
      if (request.constraints.gpuRequired) {
        const hw = runtime.hardwareRequirements;
        if (!hw.gpuRequired) continue;
        if (request.constraints.minVRAMGB && hw.minVRAMGB < request.constraints.minVRAMGB) continue;
      }
      if (request.constraints.maxLatency && runtime.latency > request.constraints.maxLatency) continue;
      if (request.constraints.minReliability && runtime.availability < request.constraints.minReliability) continue;
      candidates.push({ model, runtime });
    }
    return candidates;
  }

  private scoreModel(candidate: { model: ModelInfo; runtime: RuntimeInfo }, request: RoutingRequest): { total: number; breakdown: RoutingBreakdown } {
    const capScore = this.scoreCapabilities(candidate.model, request.requiredCapabilities);
    const latencyScore = request.constraints.maxLatency
      ? Math.max(0, 100 - (candidate.runtime.latency / request.constraints.maxLatency) * 100)
      : 50;
    const costScore = candidate.model.source === "local" ? 100 : 50;
    const reliabilityScore = candidate.runtime.availability * 100;
    const hwScore = 80;
    const prefScore = this.scorePreferences(candidate, request.preferences);
    const histScore = candidate.model.performance.metrics.reliabilityPercent;

    const breakdown: RoutingBreakdown = {
      capabilityScore: capScore, latencyScore, costScore,
      reliabilityScore, hardwareScore: hwScore, preferenceScore: prefScore, historicalScore: histScore,
    };

    const w = request.preferences ?? {};
    const wCap = (w.qualityWeight ?? 40) / 100;
    const wLat = (w.latencyWeight ?? 15) / 100;
    const wCost = (w.costWeight ?? 15) / 100;
    const total = Math.round(
      capScore * wCap + latencyScore * 0.15 + costScore * 0.15 +
      reliabilityScore * 0.1 + hwScore * 0.05 + prefScore * 0.05 + histScore * 0.05
    );
    return { total, breakdown };
  }

  private scoreCapabilities(model: ModelInfo, required: AiCapability[]): number {
    if (required.length === 0) return 100;
    let total = 0;
    for (const cap of required) {
      const score = model.capabilityScores[cap] ?? 0;
      total += score;
    }
    return Math.round(total / required.length);
  }

  private scorePreferences(candidate: { model: ModelInfo; runtime: RuntimeInfo }, prefs?: import("./types.js").RoutingPreferences): number {
    if (!prefs) return 50;
    let score = 50;
    if (prefs.preferredRuntimes?.includes(candidate.runtime.type as any)) score += 30;
    if (prefs.avoidRuntimes?.includes(candidate.runtime.type as any)) score -= 40;
    if (prefs.preferredFormats?.includes(candidate.model.format)) score += 10;
    if (prefs.preferredQuantizations?.includes(candidate.model.quantization)) score += 10;
    return Math.max(0, Math.min(100, score));
  }
}

export interface RoutingPolicy {
  id: string;
  name: string;
  rules: RoutingRule[];
  priority: number;
}

export interface RoutingRule {
  condition: { field: string; operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "in" | "contains"; value: unknown };
  action: { field: string; value: unknown };
}
