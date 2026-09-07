import { now } from "../core/types.js";
import { type ModelRuntime } from "../models/runtime.js";
import { type ReflectionResult, type ReflectionVerdict, type TaskNode, type TaskNodeResult, type TaskNodeStatus } from "./types.js";

export class ReflectionEngine {
  constructor(private readonly modelRuntime?: Pick<ModelRuntime, "selectModel">) {}

  reflect(node: TaskNode, result: TaskNodeResult, durationMs: number): ReflectionResult {
    const objectiveAchieved = result.success;
    const requiresRetry = !result.success && node.retryCount < node.retryPolicy.maxRetries;
    const requiresEscalation = !result.success && node.retryCount >= node.retryPolicy.maxRetries;
    const product = this.evaluateProduct(node, result);
    const observations: string[] = [];
    const lessons: string[] = [];
    const recommendations: string[] = [];

    if (result.success) {
      observations.push(`Node "${node.description}" completed successfully in ${durationMs}ms.`);
      observations.push(`Made ${result.toolCalls.length} tool calls.`);
      if (result.error) observations.push(`Non-critical issue: ${result.error}`);
      lessons.push(`Completed with ${result.toolCalls.length} tool invocations.`);
      recommendations.push("Continue to next node.");
    } else {
      observations.push(`Node "${node.description}" failed.`);
      if (result.error) observations.push(`Error: ${result.error}`);
      observations.push(`Retry ${node.retryCount + 1}/${node.retryPolicy.maxRetries}.`);
      lessons.push(`Failure at node ${node.id}: ${result.error ?? "unknown cause"}`);
      if (requiresRetry) {
        recommendations.push(`Retry with backoff (attempt ${node.retryCount + 1}/${node.retryPolicy.maxRetries}).`);
      }
      if (requiresEscalation) {
        recommendations.push("Max retries exceeded. Escalate to human or abort.");
      }
    }

    if (result.durationMs > node.estimatedDurationMs * 1.5) {
      observations.push(`Node exceeded estimated duration (${result.durationMs}ms vs ${node.estimatedDurationMs}ms).`);
      lessons.push("Duration estimate was too low.");
    }
    const model = this.modelRuntime?.selectModel({ goal: node.description, capability: "reasoning" });
    if (model?.ok) {
      observations.push(`Reflection model selected: ${model.data.id}.`);
    }

    let verdict: ReflectionVerdict = "success";
    if (!result.success && requiresRetry) verdict = "needs_retry";
    else if (!result.success && requiresEscalation) verdict = "needs_escalation";
    else if (!result.success) verdict = "failure";
    else if (!product.isValid) verdict = "partial";

    return {
      nodeId: node.id,
      verdict,
      objectiveAchieved,
      validationPassed: product.isValid,
      requiresRetry,
      requiresEscalation,
      requiresMoreContext: product.needsMoreContext,
      observations,
      lessons,
      recommendations,
      alternativeStrategy: requiresRetry ? this.suggestAlternative(node, result) : undefined,
      memoryUpdates: this.buildMemoryUpdates(node, result, product),
      confidence: this.calcConfidence(result, node),
      durationMs,
    };
  }

  private evaluateProduct(node: TaskNode, result: TaskNodeResult): { isValid: boolean; needsMoreContext: boolean; issues: string[] } {
    const issues: string[] = [];
    if (result.error && !result.success) issues.push(result.error);
    if (result.toolCalls.length === 0 && node.requiredTools.length > 0) {
      issues.push("No tools were invoked despite tool requirements.");
    }
    return {
      isValid: issues.length === 0 && result.success,
      needsMoreContext: issues.some((i) => i.includes("not found") || i.includes("missing")),
      issues,
    };
  }

  private suggestAlternative(node: TaskNode, result: TaskNodeResult): string | undefined {
    if (!result.success) {
      if (node.requiredTools.length > 0) {
        return `Retry with alternative tool selection. Consider different approach for: ${node.description}`;
      }
      return `Retry with adjusted parameters. Simplify: ${node.description}`;
    }
    return undefined;
  }

  private buildMemoryUpdates(node: TaskNode, result: TaskNodeResult, product: { isValid: boolean; issues: string[] }): string[] {
    const updates: string[] = [];
    if (result.success) {
      updates.push(`Node "${node.id}" completed successfully.`);
    } else {
      updates.push(`Node "${node.id}" failed: ${result.error ?? "unknown"}.`);
    }
    if (product.issues.length > 0) {
      updates.push(`Issues: ${product.issues.join("; ")}`);
    }
    return updates;
  }

  private calcConfidence(result: TaskNodeResult, node: TaskNode): number {
    let confidence = result.success ? 0.8 : 0.2;
    if (result.toolCalls.length > 0) confidence += 0.1;
    if (result.durationMs < node.estimatedDurationMs) confidence += 0.05;
    if (node.retryCount > 0) confidence -= 0.1 * node.retryCount;
    return Math.max(0, Math.min(1, confidence));
  }
}
