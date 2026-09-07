import assert from "node:assert/strict";
import test from "node:test";
import { QUACK_CONTRACT_VERSION, type ProviderCapabilitySupport, type ExecutionContextV1, type QuackProviderV1 } from "../contracts/index.js";
import { CanonicalProviderRegistry, CapabilityProviderRouter, ProviderRoutingError } from "./kernel.js";

const context: ExecutionContextV1 = {
  contractVersion: QUACK_CONTRACT_VERSION,
  missionId: "mission-1",
  taskId: "task-1",
  executionId: "execution-1",
  actor: "test",
};

test("local-only policy rejects cloud before contacting it", async () => {
  const registry = new CanonicalProviderRegistry();
  const local = new FakeProvider("local", "local", [{ capability: "text", level: "NATIVE" }]);
  const cloud = new FakeProvider("cloud", "cloud", [{ capability: "text", level: "NATIVE" }]);
  registry.register(cloud);
  registry.register(local);
  const result = await new CapabilityProviderRouter(registry).route({
    request: { model: "model", prompt: "private" },
    requirements: [{ capability: "text", minimumLevel: "NATIVE" }],
    context,
    policy: { privacy: "local-only", allowCloudFallback: false, preferredBoundaries: ["local"] },
    retry: { maxRetries: 0 },
  });
  assert.equal(result.selected.providerId, "local");
  assert.equal(cloud.healthCalls, 0);
  assert.equal(cloud.discoveryCalls, 0);
  assert.equal(cloud.generateCalls, 0);
});

test("native capability requirement rejects degraded advertisement", async () => {
  const registry = new CanonicalProviderRegistry();
  registry.register(new FakeProvider("degraded", "local", [{ capability: "tool-calling", level: "DEGRADED" }]));
  await assert.rejects(
    new CapabilityProviderRouter(registry).route({
      request: { model: "model", prompt: "use a tool" },
      requirements: [{ capability: "tool-calling", minimumLevel: "NATIVE" }],
      context,
      policy: { privacy: "local-only", allowCloudFallback: false },
      retry: { maxRetries: 0 },
    }),
    (error: unknown) => error instanceof ProviderRoutingError && error.normalized.category === "CAPABILITY_MISMATCH",
  );
});

test("fallback is deterministic and records normalized reason", async () => {
  const registry = new CanonicalProviderRegistry();
  registry.register(new FakeProvider("primary", "local", [{ capability: "text", level: "NATIVE" }], new Error("503 provider unavailable")));
  registry.register(new FakeProvider("fallback", "local", [{ capability: "text", level: "NATIVE" }]));
  const result = await new CapabilityProviderRouter(registry).route({
    request: { model: "model", prompt: "hello" },
    requirements: [{ capability: "text", minimumLevel: "NATIVE" }],
    context,
    policy: { privacy: "local-only", allowCloudFallback: false, preferredProviderIds: ["primary", "fallback"] },
    retry: { maxRetries: 0 },
  });
  assert.equal(result.selected.providerId, "fallback");
  assert.equal(result.fallbackEvents[0]?.failureCategory, "PROVIDER_INTERNAL");
  assert.equal(result.fallbackEvents.at(-1)?.selectedFallbackProviderId, "fallback");
});

class FakeProvider implements QuackProviderV1 {
  healthCalls = 0;
  discoveryCalls = 0;
  generateCalls = 0;

  constructor(
    private readonly id: string,
    private readonly boundary: "local" | "cloud",
    private readonly advertised: readonly ProviderCapabilitySupport[],
    private readonly failure?: Error,
  ) {}

  metadata() {
    return { contractVersion: QUACK_CONTRACT_VERSION, providerId: this.id, displayName: this.id, runtime: "fake", boundary: this.boundary, credentialEnvironmentVariables: [] } as const;
  }

  async health() {
    this.healthCalls += 1;
    return { status: "HEALTHY", checkedAt: new Date().toISOString() } as const;
  }

  async discoverModels() {
    this.discoveryCalls += 1;
    return [{ id: "model", providerId: this.id, runtime: "fake", capabilities: this.advertised }];
  }

  async capabilities() { return this.advertised; }

  async generate(request: { readonly model: string; readonly prompt: string }, execution: ExecutionContextV1) {
    this.generateCalls += 1;
    if (this.failure) throw this.failure;
    return {
      executionId: execution.executionId,
      providerId: this.id,
      model: request.model,
      text: "ok",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, source: "provider" },
      latencyMs: 1,
    } as const;
  }
}
