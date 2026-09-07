import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CostOptimizer } from "./cost-optimizer.js";
import { type ProviderCapabilityProfile, type TaskNode } from "./types.js";

const profiles: ProviderCapabilityProfile[] = [
  { providerId: "openai", modelId: "gpt-4", costPer1kInputTokens: 0.03, costPer1kOutputTokens: 0.06, contextWindow: 8192, supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, reasoningScore: 8, latencyP50Ms: 2000, latencyP99Ms: 10000, isLocal: false },
  { providerId: "anthropic", modelId: "claude-3", costPer1kInputTokens: 0.008, costPer1kOutputTokens: 0.024, contextWindow: 100000, supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, reasoningScore: 9, latencyP50Ms: 3000, latencyP99Ms: 15000, isLocal: false },
  { providerId: "ollama", modelId: "llama3", costPer1kInputTokens: 0, costPer1kOutputTokens: 0, contextWindow: 4096, supportsTools: false, supportsStreaming: true, supportsStructuredOutput: false, reasoningScore: 5, latencyP50Ms: 500, latencyP99Ms: 3000, isLocal: true },
];

const makeNode = (overrides?: Partial<TaskNode>): TaskNode => ({
  id: "node",
  description: "test",
  dependencies: [],
  priority: "medium",
  estimatedCost: 1,
  estimatedDurationMs: 1000,
  requiredTools: [],
  timeoutMs: 5000,
  retryPolicy: { maxRetries: 3, backoff: "exponential", baseDelayMs: 1000, maxDelayMs: 30000 },
  status: "pending",
  retryCount: 0,
  ...overrides,
});

describe("CostOptimizer", () => {
  it("selects the cheapest provider with cost_first policy", () => {
    const opt = new CostOptimizer(profiles, "cost_first");
    const decision = opt.selectProvider(makeNode(), "cost_first");
    assert.equal(decision.providerId, "ollama");
    assert.equal(decision.estimatedCost, 0);
  });

  it("selects the fastest provider with fastest_first policy", () => {
    const opt = new CostOptimizer(profiles, "fastest_first");
    const decision = opt.selectProvider(makeNode(), "fastest_first");
    assert.equal(decision.providerId, "ollama");
  });

  it("selects the most capable provider with capability_first", () => {
    const opt = new CostOptimizer(profiles, "capability_first");
    const decision = opt.selectProvider(makeNode(), "capability_first");
    assert.equal(decision.providerId, "anthropic");
  });

  it("selects local provider with local_first", () => {
    const opt = new CostOptimizer(profiles, "local_first");
    const decision = opt.selectProvider(makeNode(), "local_first");
    assert.equal(decision.providerId, "ollama");
  });

  it("selects balanced provider by default", () => {
    const opt = new CostOptimizer(profiles, "balanced");
    const decision = opt.selectProvider(makeNode());
    assert.ok(decision.providerId.length > 0);
    assert.ok(decision.reason.includes("Balanced"));
  });

  it("filters by required capabilities", () => {
    const opt = new CostOptimizer(profiles, "cost_first");
    const node = makeNode({ requiredProviderCapabilities: ["tools"] });
    const decision = opt.selectProvider(node, "cost_first");
    assert.notEqual(decision.providerId, "ollama");
    assert.ok(decision.providerId === "openai" || decision.providerId === "anthropic");
  });

  it("returns unknown when no provider matches", () => {
    const opt = new CostOptimizer([], "cost_first");
    const decision = opt.selectProvider(makeNode());
    assert.equal(decision.providerId, "unknown");
  });

  it("estimateCost computes based on token counts", () => {
    const opt = new CostOptimizer(profiles, "balanced");
    const cost = opt.estimateCost(profiles[0], 1000);
    assert.ok(cost > 0);
    assert.ok(cost < 0.1);
  });

  it("updateProfiles replaces profiles", () => {
    const opt = new CostOptimizer(profiles, "cost_first");
    opt.updateProfiles([profiles[0]]);
    const decision = opt.selectProvider(makeNode(), "cost_first");
    assert.equal(decision.providerId, "openai");
  });
});
