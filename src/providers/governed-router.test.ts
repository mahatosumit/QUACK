import test from "node:test";
import assert from "node:assert/strict";
import { QUACK_CONTRACT_VERSION, type ProviderCapabilitySupport, type ExecutionContextV1, type QuackProviderV1 } from "../contracts/index.js";
import type { CapabilityRequest, CapabilityDecision, CapabilityBroker } from "../security/capability-broker.js";
import { CanonicalProviderRegistry, CapabilityProviderRouter, ProviderRoutingError } from "./kernel.js";
import { GovernedProviderRouter } from "./governed-router.js";

const context: ExecutionContextV1 = {
  contractVersion: QUACK_CONTRACT_VERSION,
  missionId: "mission-1",
  taskId: "task-1",
  executionId: "execution-1",
  actor: "test",
};

class FixedDecisionBroker implements CapabilityBroker {
  readonly requests: CapabilityRequest[] = [];

  constructor(private readonly granted: boolean) {}

  async resolve(request: CapabilityRequest): Promise<CapabilityDecision> {
    this.requests.push(request);
    return { requestId: request.id, capabilityId: request.capabilityId, granted: this.granted, reason: this.granted ? "allowed" : "denied" };
  }
}

test("governed router resolves provider.invoke authority before contacting providers", async () => {
  const registry = new CanonicalProviderRegistry();
  const provider = new FakeProvider("local-echo");
  registry.register(provider);
  const broker = new FixedDecisionBroker(true);
  const governed = new GovernedProviderRouter(new CapabilityProviderRouter(registry), broker);

  const result = await governed.route({
    request: { model: "model", prompt: "hello" },
    requirements: [{ capability: "text", minimumLevel: "NATIVE" }],
    context,
    policy: { privacy: "local-only", allowCloudFallback: false },
    retry: { maxRetries: 0 },
  });

  assert.equal(result.selected.providerId, "local-echo");
  assert.equal(broker.requests.length, 1);
  assert.equal(broker.requests[0].capabilityId, "permission.provider.invoke");
  assert.equal(broker.requests[0].missionId, "mission-1");
  assert.equal(broker.requests[0].actor, "test");
  assert.equal(provider.generateCalls, 1);
});

test("governed router denies provider generation when capability is denied", async () => {
  const registry = new CanonicalProviderRegistry();
  const provider = new FakeProvider("local-echo");
  registry.register(provider);
  const governed = new GovernedProviderRouter(new CapabilityProviderRouter(registry), new FixedDecisionBroker(false));

  await assert.rejects(
    governed.route({
      request: { model: "model", prompt: "hello" },
      requirements: [{ capability: "text", minimumLevel: "NATIVE" }],
      context,
      policy: { privacy: "local-only", allowCloudFallback: false },
      retry: { maxRetries: 0 },
    }),
    (error: unknown) => error instanceof ProviderRoutingError
      && error.normalized.category === "POLICY_DENIED"
      && error.normalized.providerId === "router",
  );
  assert.equal(provider.generateCalls, 0);
  assert.equal(provider.healthCalls, 0);
});

test("governed router rejects when revalidation fails after resolution", async () => {
  const registry = new CanonicalProviderRegistry();
  const provider = new FakeProvider("local-echo");
  registry.register(provider);
  const broker = new class extends FixedDecisionBroker {
    revalidateAuthority(): CapabilityDecision {
      return { requestId: "late", capabilityId: "permission.provider.invoke", granted: false, reason: "grant revoked mid-flight" };
    }
  }(true);
  const governed = new GovernedProviderRouter(new CapabilityProviderRouter(registry), broker);

  await assert.rejects(
    governed.route({
      request: { model: "model", prompt: "hello" },
      requirements: [{ capability: "text", minimumLevel: "NATIVE" }],
      context,
      policy: { privacy: "local-only", allowCloudFallback: false },
      retry: { maxRetries: 0 },
    }),
    (error: unknown) => error instanceof ProviderRoutingError && error.normalized.category === "POLICY_DENIED",
  );
  assert.equal(provider.generateCalls, 0);
});

class FakeProvider implements QuackProviderV1 {
  healthCalls = 0;
  discoveryCalls = 0;
  generateCalls = 0;

  constructor(private readonly id: string) {}

  metadata() {
    return { contractVersion: QUACK_CONTRACT_VERSION, providerId: this.id, displayName: this.id, runtime: "fake", boundary: "local", credentialEnvironmentVariables: [] } as const;
  }

  async health() {
    this.healthCalls += 1;
    return { status: "HEALTHY", checkedAt: new Date().toISOString() } as const;
  }

  async discoverModels() {
    this.discoveryCalls += 1;
    return [{ id: "model", providerId: this.id, runtime: "fake", capabilities: [{ capability: "text", level: "NATIVE" } satisfies ProviderCapabilitySupport] }];
  }

  async capabilities() { return [{ capability: "text", level: "NATIVE" } satisfies ProviderCapabilitySupport]; }

  async generate(request: { readonly model: string; readonly prompt: string }, execution: ExecutionContextV1) {
    this.generateCalls += 1;
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