import { createId, now } from "../core/types.js";
import type { EvaluationResult, EvaluationComparison } from "./types.js";

export function createModelEvaluationFramework() {
  const results: EvaluationResult[] = [];

  async function evaluateModel(modelId: string, suite: string): Promise<EvaluationResult> {
    throw new Error("Model evaluation is unsupported: no measured evaluation runner is configured.");
  }

  async function compareModels(modelIds: string[], suite: string): Promise<EvaluationComparison> {
    const evalResults: EvaluationResult[] = [];
    for (const modelId of modelIds) {
      const result = await evaluateModel(modelId, suite);
      evalResults.push(result);
    }

    const rankings = evalResults
      .sort((a, b) => {
        const aAvg = Object.values(a.scores).reduce((s, v) => s + v, 0) / Object.values(a.scores).length;
        const bAvg = Object.values(b.scores).reduce((s, v) => s + v, 0) / Object.values(b.scores).length;
        return bAvg - aAvg;
      })
      .map((r) => r.modelId);

    return {
      suite,
      results: evalResults,
      rankings,
      timestamp: now(),
    };
  }

  function getHistory(modelId: string): EvaluationResult[] {
    return results.filter((r) => r.modelId === modelId);
  }

  function getLeaderboard(suite: string): EvaluationResult[] {
    return results
      .filter((r) => r.suite === suite)
      .sort((a, b) => {
        const aAvg = Object.values(a.scores).reduce((s, v) => s + v, 0) / Object.values(a.scores).length;
        const bAvg = Object.values(b.scores).reduce((s, v) => s + v, 0) / Object.values(b.scores).length;
        return bAvg - aAvg;
      });
  }

  return { evaluateModel, compareModels, getHistory, getLeaderboard };
}
