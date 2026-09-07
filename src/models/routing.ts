import type { CostEstimate, ModelComparison, ModelInfo, RoutingPolicy } from "./types.js";

export class ModelRouter {
  select(
    models: readonly ModelInfo[],
    goal: string,
    policy?: RoutingPolicy,
  ): ModelInfo | null {
    if (models.length === 0) return null;

    const available = models.filter((m) => m.status === "available");
    if (available.length === 0) return null;

    const strategy = policy?.strategy ?? "balanced";

    switch (strategy) {
      case "cost-first": {
        return available.reduce((cheapest, m) =>
          m.costPer1kInput + m.costPer1kOutput <
          cheapest.costPer1kInput + cheapest.costPer1kOutput
            ? m
            : cheapest,
        );
      }
      case "fastest-first": {
        return available.reduce((fastest, m) =>
          m.latencyMs < fastest.latencyMs ? m : fastest,
        );
      }
      case "capability-first": {
        return available.reduce((best, m) =>
          m.capabilities.length > best.capabilities.length ? m : best,
        );
      }
      case "local-first": {
        const local = available.find((m) => m.provider === "local");
        return local ?? available[0];
      }
      case "balanced":
      default: {
        return available.reduce((best, m) => {
          const score =
            m.capabilities.length * 10 +
            (m.status === "available" ? 20 : 0) -
            m.latencyMs / 100 -
            (m.costPer1kInput + m.costPer1kOutput) * 5;
          const bestScore =
            best.capabilities.length * 10 +
            (best.status === "available" ? 20 : 0) -
            best.latencyMs / 100 -
            (best.costPer1kInput + best.costPer1kOutput) * 5;
          return score > bestScore ? m : best;
        });
      }
    }
  }

  estimateCost(
    model: ModelInfo,
    inputTokens: number,
    outputTokens: number,
  ): CostEstimate {
    const inputCost = (inputTokens / 1000) * model.costPer1kInput;
    const outputCost = (outputTokens / 1000) * model.costPer1kOutput;

    return {
      modelId: model.id,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
    };
  }

  compare(models: readonly ModelInfo[]): ModelComparison {
    const available = models.filter((m) => m.status === "available");

    if (available.length === 0) {
      return {
        models: models.map((m) => m.id),
        fastest: null,
        cheapest: null,
        mostCapable: null,
        costRange: { min: 0, max: 0 },
        latencyRange: { min: 0, max: 0 },
      };
    }

    const costs = available.map((m) => m.costPer1kInput + m.costPer1kOutput);
    const latencies = available.map((m) => m.latencyMs);
    const capabilities = available.map((m) => m.capabilities.length);

    const minCost = Math.min(...costs);
    const maxCost = Math.max(...costs);
    const minLatency = Math.min(...latencies);
    const maxLatency = Math.max(...latencies);
    const maxCap = Math.max(...capabilities);

    return {
      models: available.map((m) => m.id),
      fastest: available.find((m) => m.latencyMs === minLatency)?.id ?? null,
      cheapest: available.find(
        (m) => m.costPer1kInput + m.costPer1kOutput === minCost,
      )?.id ?? null,
      mostCapable: available.find(
        (m) => m.capabilities.length === maxCap,
      )?.id ?? null,
      costRange: { min: minCost, max: maxCost },
      latencyRange: { min: minLatency, max: maxLatency },
    };
  }
}
