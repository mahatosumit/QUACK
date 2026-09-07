import type { QualityPrediction } from "./types.js";

export function createQualityPredictionEngine() {
  let correctPredictions = 0;
  let totalPredictions = 0;

  function predict(request: Record<string, unknown>): QualityPrediction {
    const complexity = (request.complexity as number) ?? 0.5;
    const modelCapability = (request.modelCapability as number) ?? 0.8;
    const historySuccessRate = (request.historySuccessRate as number) ?? 0.7;
    const inputLength = (request.inputLength as number) ?? 1000;
    const expectedCost = (request.estimatedCost as number) ?? 0.01;
    const expectedLatency = (request.estimatedLatencyMs as number) ?? 1000;

    const baseProbability =
      modelCapability * 0.4 +
      historySuccessRate * 0.3 +
      (1 - complexity) * 0.2 +
      Math.max(0, 1 - inputLength / 100000) * 0.1;

    const riskLevel =
      baseProbability > 0.8
        ? "low"
        : baseProbability > 0.5
          ? "medium"
          : "high";

    return {
      successProbability: Math.round(baseProbability * 1000) / 1000,
      expectedCost: Math.round(expectedCost * 100) / 100,
      expectedLatencyMs: Math.round(expectedLatency),
      risk: riskLevel,
      confidence: Math.round(
        (Math.min(1, Math.max(0, modelCapability * historySuccessRate)) + 0.1) *
          1000
      ) / 1000,
    };
  }

  function updateModel(outcome: boolean, prediction: QualityPrediction): void {
    totalPredictions++;
    if (outcome === (prediction.successProbability > 0.5)) {
      correctPredictions++;
    }
  }

  function getAccuracy(): number {
    return totalPredictions > 0
      ? Math.round((correctPredictions / totalPredictions) * 1000) / 1000
      : 0;
  }

  return { predict, updateModel, getAccuracy };
}
