import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RecoveryEngine } from "./recovery-engine.js";
import { type TaskNode, type TaskNodeResult, type RetryPolicy } from "./types.js";

const makeNode = (overrides?: Partial<TaskNode>): TaskNode => ({
  id: "node-1",
  description: "Test",
  dependencies: [],
  priority: "medium",
  estimatedCost: 1,
  estimatedDurationMs: 1000,
  requiredTools: ["tool1"],
  timeoutMs: 5000,
  retryPolicy: { maxRetries: 3, backoff: "exponential", baseDelayMs: 1000, maxDelayMs: 30000 },
  status: "pending",
  retryCount: 0,
  ...overrides,
});

describe("RecoveryEngine", () => {
  const engine = new RecoveryEngine();

  it("maxRetries counts retries after the first attempt", () => {
    const retryPolicy: RetryPolicy = { maxRetries: 1, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 };
    const result: TaskNodeResult = { success: false, error: "transient busy", toolCalls: [], durationMs: 0 };
    assert.equal(engine.buildRecoveryPlan(makeNode({ retryPolicy, retryCount: 0 }), result).action, "retry");
    assert.equal(engine.buildRecoveryPlan(makeNode({ retryPolicy, retryCount: 1 }), result).action, "escalate");
    assert.equal(engine.buildRecoveryPlan(makeNode({ retryPolicy: { ...retryPolicy, maxRetries: 0 } }), result).action, "escalate");
  });

  it("bounds fixed and linear retry delays", () => {
    for (const backoff of ["fixed", "linear"] as const) {
      assert.equal(engine.computeBackoff({ maxRetries: 3, backoff, baseDelayMs: 1000, maxDelayMs: 500 }, 3), 500);
    }
  });

  describe("computeBackoff", () => {
    it("fixed backoff returns base delay", () => {
      const policy: RetryPolicy = { maxRetries: 3, backoff: "fixed", baseDelayMs: 1000, maxDelayMs: 10000 };
      assert.equal(engine.computeBackoff(policy, 1), 1000);
      assert.equal(engine.computeBackoff(policy, 3), 1000);
    });

    it("linear backoff scales with attempt", () => {
      const policy: RetryPolicy = { maxRetries: 3, backoff: "linear", baseDelayMs: 1000, maxDelayMs: 10000 };
      assert.equal(engine.computeBackoff(policy, 0), 1000);
      assert.equal(engine.computeBackoff(policy, 1), 2000);
      assert.equal(engine.computeBackoff(policy, 2), 3000);
    });

    it("exponential backoff doubles each attempt", () => {
      const policy: RetryPolicy = { maxRetries: 3, backoff: "exponential", baseDelayMs: 1000, maxDelayMs: 10000 };
      assert.equal(engine.computeBackoff(policy, 0), 1000);
      assert.equal(engine.computeBackoff(policy, 1), 2000);
      assert.equal(engine.computeBackoff(policy, 2), 4000);
    });

    it("backoff never exceeds maxDelayMs", () => {
      const policy: RetryPolicy = { maxRetries: 5, backoff: "exponential", baseDelayMs: 5000, maxDelayMs: 10000 };
      assert.equal(engine.computeBackoff(policy, 5), 10000);
    });

    it("jitter backoff returns varied values", () => {
      const policy: RetryPolicy = { maxRetries: 3, backoff: "jitter", baseDelayMs: 1000, maxDelayMs: 10000 };
      const results = new Set<number>();
      for (let i = 0; i < 10; i++) {
        results.add(engine.computeBackoff(policy, 1));
      }
      assert.ok(results.size > 1);
    });
  });

  describe("buildRecoveryPlan", () => {
    it("retries on transient failures within limit", () => {
      const node = makeNode({ retryCount: 1 });
      const result: TaskNodeResult = { success: false, error: "timeout", toolCalls: [], durationMs: 1000 };
      const plan = engine.buildRecoveryPlan(node, result);
      assert.equal(plan.action, "retry");
      assert.ok(plan.backoffDelayMs > 0);
    });

    it("escalates when retries exhausted", () => {
      const node = makeNode({ retryCount: 3 });
      const result: TaskNodeResult = { success: false, error: "persistent failure", toolCalls: [], durationMs: 1000 };
      const plan = engine.buildRecoveryPlan(node, result);
      assert.equal(plan.action, "escalate");
    });

    it("escalates on permanent failures", () => {
      const node = makeNode({ retryCount: 0 });
      const result: TaskNodeResult = { success: false, error: "access denied", toolCalls: [], durationMs: 500 };
      const plan = engine.buildRecoveryPlan(node, result);
      assert.equal(plan.action, "escalate");
    });
  });

  describe("classifyFailure", () => {
    it("classifies timeout as transient", () => {
      assert.equal(engine.classifyFailure({ success: false, error: "timeout", toolCalls: [], durationMs: 0 }), "transient");
      assert.equal(engine.classifyFailure({ success: false, error: "connection timeout", toolCalls: [], durationMs: 0 }), "transient");
      assert.equal(engine.classifyFailure({ success: false, error: "Rate limit exceeded", toolCalls: [], durationMs: 0 }), "transient");
    });

    it("classifies access as permanent", () => {
      assert.equal(engine.classifyFailure({ success: false, error: "permission denied", toolCalls: [], durationMs: 0 }), "permanent");
      assert.equal(engine.classifyFailure({ success: false, error: "not found", toolCalls: [], durationMs: 0 }), "permanent");
      assert.equal(engine.classifyFailure({ success: false, error: "invalid syntax", toolCalls: [], durationMs: 0 }), "permanent");
    });

    it("classifies unknown errors", () => {
      assert.equal(engine.classifyFailure({ success: false, error: "something random", toolCalls: [], durationMs: 0 }), "unknown");
    });

    it("handles no error", () => {
      assert.equal(engine.classifyFailure({ success: true, toolCalls: [], durationMs: 0 }), "unknown");
    });
  });

  describe("isRecoverableError", () => {
    it("transient errors are recoverable", () => {
      assert.equal(engine.isRecoverableError("timeout"), true);
    });

    it("permanent errors are not recoverable", () => {
      assert.equal(engine.isRecoverableError("permission denied"), false);
    });
  });
});
