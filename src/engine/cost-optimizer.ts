import { type ProviderCapabilityProfile, type RoutingDecision, type RoutingPolicy, type TaskNode } from "./types.js";

export class CostOptimizer {
  constructor(
    private readonly profiles: ProviderCapabilityProfile[],
    private readonly defaultPolicy: RoutingPolicy = "balanced",
  ) {}

  selectProvider(node: TaskNode, policy?: RoutingPolicy): RoutingDecision {
    const activePolicy = policy ?? this.defaultPolicy;
    const candidates = this.filterCapable(node, this.profiles);
    if (candidates.length === 0) {
      return { providerId: "unknown", modelId: "unknown", estimatedCost: 0, estimatedLatencyMs: 0, reason: "No capable provider found." };
    }

    switch (activePolicy) {
      case "cost_first":
        return this.selectCheapest(candidates, node);
      case "fastest_first":
        return this.selectFastest(candidates, node);
      case "capability_first":
        return this.selectMostCapable(candidates);
      case "local_first":
        return this.selectLocal(candidates, node);
      case "balanced":
        return this.selectBalanced(candidates, node);
      default:
        return this.selectBalanced(candidates, node);
    }
  }

  updateProfiles(profiles: ProviderCapabilityProfile[]): void {
    this.profiles.length = 0;
    this.profiles.push(...profiles);
  }

  estimateCost(profile: ProviderCapabilityProfile, estimatedTokens: number): number {
    const inputTokens = Math.round(estimatedTokens * 0.7);
    const outputTokens = estimatedTokens - inputTokens;
    return (inputTokens / 1000) * profile.costPer1kInputTokens +
           (outputTokens / 1000) * profile.costPer1kOutputTokens;
  }

  private filterCapable(node: TaskNode, profiles: ProviderCapabilityProfile[]): ProviderCapabilityProfile[] {
    const caps = node.requiredProviderCapabilities ?? [];
    return profiles.filter((p) => {
      if (caps.length === 0) return true;
      if (caps.includes("tools") && !p.supportsTools) return false;
      if (caps.includes("streaming") && !p.supportsStreaming) return false;
      if (caps.includes("structured_output") && !p.supportsStructuredOutput) return false;
      return true;
    });
  }

  private selectCheapest(candidates: ProviderCapabilityProfile[], node: TaskNode): RoutingDecision {
    const sorted = [...candidates].sort((a, b) => {
      const costA = this.estimateCost(a, 1000);
      const costB = this.estimateCost(b, 1000);
      return costA - costB;
    });
    const best = sorted[0];
    return {
      providerId: best.providerId,
      modelId: best.modelId,
      estimatedCost: this.estimateCost(best, 1000),
      estimatedLatencyMs: best.latencyP50Ms,
      reason: `Cheapest provider selected (${best.providerId}/${best.modelId}).`,
    };
  }

  private selectFastest(candidates: ProviderCapabilityProfile[], node: TaskNode): RoutingDecision {
    const sorted = [...candidates].sort((a, b) => a.latencyP50Ms - b.latencyP50Ms);
    const best = sorted[0];
    return {
      providerId: best.providerId,
      modelId: best.modelId,
      estimatedCost: this.estimateCost(best, 1000),
      estimatedLatencyMs: best.latencyP50Ms,
      reason: `Fastest provider selected (${best.providerId}/${best.modelId}, ~${best.latencyP50Ms}ms P50).`,
    };
  }

  private selectMostCapable(candidates: ProviderCapabilityProfile[]): RoutingDecision {
    const sorted = [...candidates].sort((a, b) => b.reasoningScore - a.reasoningScore);
    const best = sorted[0];
    return {
      providerId: best.providerId,
      modelId: best.modelId,
      estimatedCost: this.estimateCost(best, 1000),
      estimatedLatencyMs: best.latencyP50Ms,
      reason: `Most capable provider by reasoning score (${best.providerId}/${best.modelId}, score: ${best.reasoningScore}).`,
    };
  }

  private selectLocal(candidates: ProviderCapabilityProfile[], node: TaskNode): RoutingDecision {
    const local = candidates.filter((c) => c.isLocal);
    if (local.length > 0) {
      const best = local[0];
      return {
        providerId: best.providerId,
        modelId: best.modelId,
        estimatedCost: this.estimateCost(best, 1000),
        estimatedLatencyMs: best.latencyP50Ms,
        reason: `Local provider selected (${best.providerId}/${best.modelId}).`,
      };
    }
    return this.selectBalanced(candidates, node);
  }

  private selectBalanced(candidates: ProviderCapabilityProfile[], node: TaskNode): RoutingDecision {
    const scored = candidates.map((c) => ({
      profile: c,
      score: c.reasoningScore * 0.4 +
             (1 / (c.latencyP50Ms + 1)) * 100 * 0.3 +
             (1 / (this.estimateCost(c, 1000) + 0.001)) * 0.3,
    }));
    const sorted = scored.sort((a, b) => b.score - a.score);
    const best = sorted[0].profile;
    return {
      providerId: best.providerId,
      modelId: best.modelId,
      estimatedCost: this.estimateCost(best, 1000),
      estimatedLatencyMs: best.latencyP50Ms,
      reason: `Balanced selection: ${best.providerId}/${best.modelId} (score: ${sorted[0].score.toFixed(2)}).`,
    };
  }
}
