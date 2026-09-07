import { createId, now } from "../core/types.js";
import type { Experiment, ExperimentConfig, ExperimentResult } from "./types.js";

export function createExperimentManager() {
  const experiments = new Map<string, Experiment>();

  function createExperiment(config: ExperimentConfig): Experiment {
    const experiment: Experiment = {
      id: createId("exp"),
      config,
      status: "draft",
      results: [],
      winner: null,
      createdAt: now(),
      completedAt: null,
      artifacts: [],
    };
    experiments.set(experiment.id, experiment);
    return experiment;
  }

  function getExperiment(id: string): Experiment | undefined {
    return experiments.get(id);
  }

  function listExperiments(type?: string): Experiment[] {
    const all = Array.from(experiments.values());
    return type ? all.filter((e) => e.config.type === type) : all;
  }

  async function runExperiment(id: string): Promise<Experiment> {
    const exp = experiments.get(id);
    if (!exp) throw new Error(`Experiment ${id} not found`);
    throw new Error("Experiment execution is unsupported: no experiment runner is configured.");
  }

  function getResults(id: string): ExperimentResult[] {
    const exp = experiments.get(id);
    return exp?.results ?? [];
  }

  function compareVariants(id: string): Record<string, number> {
    const exp = experiments.get(id);
    if (!exp) return {};
    const comparison: Record<string, number> = {};
    for (const r of exp.results) {
      comparison[r.variantId] = r.confidence;
    }
    return comparison;
  }

  function deleteExperiment(id: string): boolean {
    return experiments.delete(id);
  }

  return { createExperiment, getExperiment, listExperiments, runExperiment, getResults, compareVariants, deleteExperiment };
}

