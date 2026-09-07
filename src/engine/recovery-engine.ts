import { type RetryPolicy, type RecoveryPlan, type RecoveryAction, type TaskNode, type TaskNodeResult, type BackoffStrategy } from "./types.js";

export class RecoveryEngine {
  computeBackoff(policy: RetryPolicy, attempt: number): number {
    switch (policy.backoff) {
      case "fixed":
        return Math.min(policy.baseDelayMs, policy.maxDelayMs);
      case "linear":
        return Math.min(policy.baseDelayMs * (attempt + 1), policy.maxDelayMs);
      case "exponential":
        return Math.min(policy.baseDelayMs * Math.pow(2, attempt), policy.maxDelayMs);
      case "jitter":
        const exp = Math.min(policy.baseDelayMs * Math.pow(2, attempt), policy.maxDelayMs);
        return exp / 2 + Math.random() * (exp / 2);
      default:
        return policy.baseDelayMs;
    }
  }

  buildRecoveryPlan(node: TaskNode, result: TaskNodeResult): RecoveryPlan {
    const retryCount = node.retryCount + 1;
    const backoffDelay = this.computeBackoff(node.retryPolicy, retryCount - 1);
    const failureClass = this.classifyFailure(result);

    if (failureClass === "permanent") {
      return {
        action: "escalate",
        reason: `Permanent failure detected for node "${node.description}": ${result.error ?? "unknown"}.`,
        retryCount,
        backoffDelayMs: 0,
        rollbackNodeIds: this.findRollbackTargets(node),
        escalationMessage: `Node ${node.id} ("${node.description}") failed with permanent error: ${result.error ?? "unknown"}. Requires human intervention.`,
      };
    }

    if (retryCount > node.retryPolicy.maxRetries) {
      return {
        action: "escalate",
        reason: `Max retries (${node.retryPolicy.maxRetries}) exceeded for node "${node.description}".`,
        retryCount,
        backoffDelayMs: 0,
        rollbackNodeIds: this.findRollbackTargets(node),
        escalationMessage: `Node ${node.id} ("${node.description}") failed after ${retryCount} attempts. Error: ${result.error ?? "unknown"}. Requires human intervention.`,
      };
    }

    if (this.shouldTryDifferentTool(result)) {
      return {
        action: "retry_different_tool",
        reason: "Current tool selection may be suboptimal.",
        retryCount,
        backoffDelayMs: backoffDelay,
        rollbackNodeIds: [],
      };
    }

    return {
      action: "retry",
      reason: `Retry attempt ${retryCount}/${node.retryPolicy.maxRetries}.`,
      retryCount,
      backoffDelayMs: backoffDelay,
      rollbackNodeIds: [],
    };
  }

  shouldRetry(result: TaskNodeResult, retryCount: number, maxRetries: number): boolean {
    return !result.success && retryCount < maxRetries;
  }

  shouldEscalate(result: TaskNodeResult, retryCount: number, maxRetries: number): boolean {
    return !result.success && retryCount >= maxRetries;
  }

  isRecoverableError(error: string): boolean {
    const unrecoverable = [
      "permission_denied", "permission denied",
      "not found", "not_found",
      "invalid syntax", "syntax error",
      "authentication", "unauthorized",
    ];
    const lower = error.toLowerCase();
    return !unrecoverable.some((u) => lower.includes(u));
  }

  classifyFailure(result: TaskNodeResult): "transient" | "permanent" | "unknown" {
    if (!result.error) return "unknown";
    const transient = ["timeout", "rate limit", "network", "connection", "busy", "unavailable", "too many requests"];
    const permanent = ["not found", "permission", "denied", "syntax", "invalid", "authentication"];
    const lower = result.error.toLowerCase();
    if (transient.some((t) => lower.includes(t))) return "transient";
    if (permanent.some((p) => lower.includes(p))) return "permanent";
    return "unknown";
  }

  private findRollbackTargets(node: TaskNode): string[] {
    return [node.id];
  }

  private shouldTryDifferentTool(result: TaskNodeResult): boolean {
    if (!result.error) return false;
    const toolHints = ["tool not found", "not a tool", "invalid tool", "tool failed", "does not exist"];
    return toolHints.some((h) => result.error!.toLowerCase().includes(h));
  }
}
