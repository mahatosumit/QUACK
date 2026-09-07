import { type ObjectiveSpecification } from "./types.js";

export const DEFAULT_NO_REGRESSION_OBJECTIVE_ID = "core.no-regression";

export function createDefaultNoRegressionObjective(): ObjectiveSpecification {
  return freezeObjective({
    id: DEFAULT_NO_REGRESSION_OBJECTIVE_ID,
    name: "Complete task without regression",
    description: "Evaluate whether a runtime task completed without observable execution regressions.",
    metrics: [
      {
        id: "runtime.task.completed",
        description: "The task reached completed status.",
        direction: "target",
        measurementSource: "runtime.task.status",
        weight: 0.7,
        threshold: true,
      },
      {
        id: "runtime.failed_steps",
        description: "The number of failed execution steps reported by the runtime result.",
        direction: "minimize",
        measurementSource: "runtime.task.result.failedSteps",
        weight: 0.3,
        threshold: 0,
      },
    ],
    constraints: [
      "Metric definitions are trusted mission policy and must not be modified by the worker being evaluated.",
      "Deterministic measurements outrank model judgement.",
    ],
    baselineStrategy: "Compare against the latest prior evidence-backed experience for the same objective.",
    evaluationPolicy: {
      evaluatorId: "core.deterministic-objective-evaluator",
      minEvidenceCount: 1,
      requireBaseline: true,
    },
  });
}

export class ObjectiveRegistry {
  private readonly objectives = new Map<string, ObjectiveSpecification>();

  constructor(objectives: readonly ObjectiveSpecification[] = [createDefaultNoRegressionObjective()]) {
    for (const objective of objectives) {
      this.register(objective);
    }
  }

  register(objective: ObjectiveSpecification): ObjectiveSpecification {
    if (this.objectives.has(objective.id)) {
      throw new Error(`Objective ${objective.id} is already registered.`);
    }
    const trusted = freezeObjective(cloneObjective(objective));
    this.objectives.set(trusted.id, trusted);
    return cloneObjective(trusted);
  }

  get(id: string): ObjectiveSpecification | undefined {
    const objective = this.objectives.get(id);
    return objective ? cloneObjective(objective) : undefined;
  }

  list(): ObjectiveSpecification[] {
    return [...this.objectives.values()].map(cloneObjective);
  }
}

export function cloneObjective(objective: ObjectiveSpecification): ObjectiveSpecification {
  return JSON.parse(JSON.stringify(objective)) as ObjectiveSpecification;
}

function freezeObjective(objective: ObjectiveSpecification): ObjectiveSpecification {
  for (const metric of objective.metrics) {
    Object.freeze(metric);
  }
  Object.freeze(objective.metrics);
  Object.freeze(objective.constraints);
  Object.freeze(objective.evaluationPolicy);
  return Object.freeze(objective);
}
