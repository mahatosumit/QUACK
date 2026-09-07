import { createId, now } from "../core/types.js";
import type { WorkflowObservation, WorkflowOptimization } from "./types.js";

export function createWorkflowEvolutionEngine() {
  const observations = new Map<string, WorkflowObservation[]>();
  const optimizations = new Map<string, WorkflowOptimization[]>();

  function observeExecution(workflowId: string, observation: WorkflowObservation): void {
    if (!observations.has(workflowId)) {
      observations.set(workflowId, []);
    }
    observations.get(workflowId)!.push(observation);

    const existingObs = observations.get(workflowId)!;
    const totalLatency = existingObs.reduce((s, o) => s + o.latencyMs, 0);
    const totalFailures = existingObs.reduce((s, o) => s + o.failures, 0);
    const totalRetries = existingObs.reduce((s, o) => s + o.retries, 0);

    const recommendations: string[] = [];
    if (observation.latencyMs > 5000) {
      recommendations.push(`Step ${observation.stepId} exceeds 5s latency — consider batching or parallelism`);
    }
    if (observation.failures > 0) {
      recommendations.push(`Step ${observation.stepId} has ${observation.failures} failures — add retry with backoff`);
    }
    if (observation.toolCalls > 5) {
      recommendations.push(`Step ${observation.stepId} makes ${observation.toolCalls} tool calls — consider caching`);
    }
    if (observation.routingDecisions > 3) {
      recommendations.push(`Step ${observation.stepId} has ${observation.routingDecisions} routing decisions — consider a dedicated router`);
    }

    const score = Math.max(
      0,
      100 - (totalLatency / existingObs.length / 100) - totalFailures * 10 - totalRetries * 5
    );

    const optimization: WorkflowOptimization = {
      id: createId("opt"),
      workflowId,
      observations: [observation],
      recommendations,
      score,
      applied: false,
      createdAt: now(),
    };

    if (!optimizations.has(workflowId)) {
      optimizations.set(workflowId, []);
    }
    optimizations.get(workflowId)!.push(optimization);
  }

  function getOptimizations(workflowId: string): WorkflowOptimization[] {
    return optimizations.get(workflowId) ?? [];
  }

  function getRecommendations(workflowId: string): string[] {
    const opts = optimizations.get(workflowId) ?? [];
    const all = opts.flatMap((o) => o.recommendations);
    return [...new Set(all)];
  }

  function applyOptimization(workflowId: string, optId: string): void {
    const opts = optimizations.get(workflowId);
    if (!opts) throw new Error(`Workflow ${workflowId} not found`);
    const opt = opts.find((o) => o.id === optId);
    if (!opt) throw new Error(`Optimization ${optId} not found`);
    opt.applied = true;
  }

  return { observeExecution, getOptimizations, getRecommendations, applyOptimization };
}
