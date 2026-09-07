import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReflectionEngine } from "./reflection-engine.js";
import { type TaskNode, type TaskNodeResult } from "./types.js";

const makeNode = (overrides?: Partial<TaskNode>): TaskNode => ({
  id: "node-1",
  description: "Test node",
  dependencies: [],
  priority: "medium",
  estimatedCost: 1,
  estimatedDurationMs: 1000,
  requiredTools: [],
  timeoutMs: 5000,
  retryPolicy: { maxRetries: 3, backoff: "exponential", baseDelayMs: 1000, maxDelayMs: 30000 },
  status: "completed",
  retryCount: 0,
  ...overrides,
});

describe("ReflectionEngine", () => {
  const engine = new ReflectionEngine();

  it("returns success verdict when objective achieved", () => {
    const node = makeNode({ status: "completed" });
    const result: TaskNodeResult = { success: true, toolCalls: ["tool1"], durationMs: 500 };
    const reflection = engine.reflect(node, result, 500);
    assert.equal(reflection.verdict, "success");
    assert.equal(reflection.objectiveAchieved, true);
    assert.equal(reflection.requiresRetry, false);
    assert.equal(reflection.requiresEscalation, false);
  });

  it("returns needs_retry verdict when execution failed within retry limit", () => {
    const node = makeNode({ status: "failed" });
    const result: TaskNodeResult = { success: false, error: "Something broke", toolCalls: [], durationMs: 1000 };
    const reflection = engine.reflect(node, result, 1000);
    assert.equal(reflection.verdict, "needs_retry");
    assert.equal(reflection.objectiveAchieved, false);
  });

  it("recommends retry when within retry limit", () => {
    const node = makeNode({ status: "failed", retryCount: 1, retryPolicy: { maxRetries: 3, backoff: "exponential", baseDelayMs: 1000, maxDelayMs: 30000 } });
    const result: TaskNodeResult = { success: false, error: "Transient error", toolCalls: [], durationMs: 500 };
    const reflection = engine.reflect(node, result, 500);
    assert.equal(reflection.requiresRetry, true);
    assert.equal(reflection.requiresEscalation, false);
  });

  it("recommends escalation when retries exhausted", () => {
    const node = makeNode({ status: "failed", retryCount: 3, retryPolicy: { maxRetries: 3, backoff: "exponential", baseDelayMs: 1000, maxDelayMs: 30000 } });
    const result: TaskNodeResult = { success: false, error: "Still failing", toolCalls: [], durationMs: 500 };
    const reflection = engine.reflect(node, result, 500);
    assert.equal(reflection.requiresRetry, false);
    assert.equal(reflection.requiresEscalation, true);
  });

  it("produces observations and lessons", () => {
    const node = makeNode({ status: "completed", description: "Write unit tests" });
    const result: TaskNodeResult = { success: true, toolCalls: ["test.tool"], durationMs: 2000 };
    const reflection = engine.reflect(node, result, 2000);
    assert.ok(reflection.observations.length > 0);
    assert.ok(reflection.observations.some((o) => o.includes("Write unit tests")));
  });

  it("generates memory updates for successful nodes", () => {
    const node = makeNode({ status: "completed" });
    const result: TaskNodeResult = { success: true, toolCalls: ["tool1"], durationMs: 100 };
    const reflection = engine.reflect(node, result, 100);
    assert.ok(reflection.memoryUpdates.length > 0);
  });

  it("suggests alternative strategy on failure", () => {
    const node = makeNode({ status: "failed", description: "Complex refactor" });
    const result: TaskNodeResult = { success: false, error: "Failed", toolCalls: ["tool1"], durationMs: 3000 };
    const reflection = engine.reflect(node, result, 3000);
    assert.ok(reflection.alternativeStrategy);
    assert.ok(reflection.alternativeStrategy!.length > 0);
  });

  it("returns confidence score", () => {
    const node = makeNode({ status: "completed" });
    const result: TaskNodeResult = { success: true, toolCalls: [], durationMs: 500 };
    const reflection = engine.reflect(node, result, 500);
    assert.ok(typeof reflection.confidence === "number");
    assert.ok(reflection.confidence >= 0 && reflection.confidence <= 1);
  });
});
