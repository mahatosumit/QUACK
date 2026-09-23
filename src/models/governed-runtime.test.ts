import test from "node:test";
import assert from "node:assert/strict";
import { GovernedModelRuntime } from "./governed-runtime.js";
import type { ModelInfo } from "./types.js";
import type { ModelRequest, ModelResponse, ModelRuntime, ModelStreamChunk } from "./runtime.js";
import type { CapabilityBroker, CapabilityDecision, CapabilityRequest } from "../security/capability-broker.js";
import type { QuackResult } from "../core/types.js";
import { QUACK_CONTRACT_VERSION, type ExecutionContextV1, type ProviderCapabilitySupport, type QuackProviderV1 } from "../contracts/index.js";
import { CanonicalProviderRegistry, CapabilityProviderRouter } from "../providers/kernel.js";
import { GovernedProviderRouter } from "../providers/governed-router.js";

class FixedBroker implements CapabilityBroker {
  readonly requests: CapabilityRequest[] = [];

  constructor(private readonly granted: boolean) {}

  async resolve(request: CapabilityRequest): Promise<CapabilityDecision> {
    this.requests.push(request);
    return { requestId: request.id, capabilityId: request.capabilityId, granted: this.granted, reason: this.granted ? "allowed" : "denied by fixture" };
  }
}

const fakeModel: ModelInfo = {
  id: "qwen", name: "qwen", provider: "ollama", capabilities: ["reasoning"], contextWindow: 8192,
  supportsTools: false, latencyMs: 1, costPer1kInput: 0, costPer1kOutput: 0, status: "available",
};

function fakeRuntime() {
  const state = { generateCalls: 0, streamCalls: 0, lastMetadata: undefined as Record<string, unknown> | undefined };
  const inner = {
    async generate(request: ModelRequest): Promise<QuackResult<ModelResponse>> {
      state.generateCalls += 1;
      state.lastMetadata = request.metadata;
      return { ok: true, data: { id: "resp-1", providerId: "ollama", model: request.model ?? "qwen", text: "ok",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 1, fallbackUsed: false } };
    },
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
      state.streamCalls += 1;
      state.lastMetadata = request.metadata;
      yield { providerId: "ollama", model: request.model ?? "qwen", text: "ok", done: true };
    },
    getFailures: () => [] as readonly { readonly providerId: string; readonly message: string; readonly at: string }[],
    selectModel: () => ({ ok: true as const, data: fakeModel }),
  } as unknown as ModelRuntime;
  return { inner, state };
}

test("governed model generation resolves provider.invoke authority before contacting the provider", async () => {
  const broker = new FixedBroker(true);
  const { inner, state } = fakeRuntime();
  const runtime = new GovernedModelRuntime(inner, broker);

  const result = await runtime.generate({ prompt: "hello", model: "qwen" },
    { missionId: "mission-1", taskId: "task-1", agentId: "agent-1", actor: "observer" });

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.data.text, "ok");
  assert.equal(state.generateCalls, 1);
  assert.equal(broker.requests.length, 1);
  assert.equal(broker.requests[0].capabilityId, "permission.provider.invoke");
  assert.equal(broker.requests[0].missionId, "mission-1");
  assert.equal(broker.requests[0].taskId, "task-1");
  assert.equal(broker.requests[0].agentId, "agent-1");
  assert.equal(broker.requests[0].actor, "observer");
  assert.equal(state.lastMetadata?.["governedDispatch"], true);
});

test("denied model generation fails closed before any provider contact", async () => {
  const broker = new FixedBroker(false);
  const { inner, state } = fakeRuntime();
  const runtime = new GovernedModelRuntime(inner, broker);

  const result = await runtime.generate({ prompt: "hello", model: "qwen" }, { missionId: "mission-1", actor: "observer" });

  assert.ok(!result.ok);
  if (!result.ok) assert.equal(result.error.code, "model.permission_denied");
  assert.equal(state.generateCalls, 0);
});

test("mid-flight authority revocation rejects before provider contact", async () => {
  const { inner, state } = fakeRuntime();
  const broker = new class extends FixedBroker {
    revalidateAuthority(): CapabilityDecision {
      return { requestId: "late", capabilityId: "permission.provider.invoke", granted: false, reason: "revoked mid-flight" };
    }
  }(true);
  const runtime = new GovernedModelRuntime(inner, broker);

  const result = await runtime.generate({ prompt: "hello", model: "qwen" }, { missionId: "mission-1", actor: "observer" });

  assert.ok(!result.ok);
  if (!result.ok) assert.equal(result.error.code, "model.permission_denied");
  assert.equal(state.generateCalls, 0);
});

test("cancelled generation never contacts the provider", async () => {
  const { inner, state } = fakeRuntime();
  const runtime = new GovernedModelRuntime(inner, new FixedBroker(true));
  const controller = new AbortController();
  controller.abort();

  const result = await runtime.generate({ prompt: "hello", model: "qwen" },
    { missionId: "mission-1", actor: "observer", signal: controller.signal });

  assert.ok(!result.ok);
  if (!result.ok) assert.equal(result.error.code, "model.cancelled");
  assert.equal(state.generateCalls, 0);
});

test("governed stream resolves authority first and fails closed when denied", async () => {
  const broker = new FixedBroker(false);
  const { inner, state } = fakeRuntime();
  const runtime = new GovernedModelRuntime(inner, broker);

  await assert.rejects(async () => {
    for await (const _chunk of runtime.stream({ prompt: "hello", model: "qwen" }, { missionId: "mission-1", actor: "observer" })) {
      // no consumer
    }
  }, /denied by fixture/);
  assert.equal(state.streamCalls, 0);
  assert.equal(broker.requests.length, 1);
});

test("governed stream forwards to the provider once authorized", async () => {
  const broker = new FixedBroker(true);
  const { inner, state } = fakeRuntime();
  const runtime = new GovernedModelRuntime(inner, broker);

  const chunks: ModelStreamChunk[] = [];
  for await (const chunk of runtime.stream({ prompt: "hello", model: "qwen" }, { missionId: "mission-1", actor: "observer" })) {
    chunks.push(chunk);
  }
  assert.equal(state.streamCalls, 1);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, "ok");
  assert.equal(state.lastMetadata?.["governedDispatch"], true);
});

test("selectModel stays ungated because it is a metadata-only registry lookup", async () => {
  const broker = new FixedBroker(false);
  const { inner } = fakeRuntime();
  const runtime = new GovernedModelRuntime(inner, broker);

  const selected = runtime.selectModel({ model: "qwen" });
  assert.ok(selected.ok);
  assert.equal(broker.requests.length, 0);
});

test("canonical generation bypasses the legacy router and records canonical routing evidence", async () => {
  const broker = new FixedBroker(true);
  const { inner, state } = fakeRuntime();
  const provider = new CanonicalFakeProvider();
  const registry = new CanonicalProviderRegistry();
  registry.register(provider);
  const runtime = new GovernedModelRuntime(inner, broker, {
    providerRouter: new GovernedProviderRouter(new CapabilityProviderRouter(registry), broker),
  });

  const result = await runtime.generate({ prompt: "hello", model: "qwen", metadata: { privacy: "local-only" } }, {
    missionId: "mission-1", taskId: "task-1", agentId: "agent-1", actor: "observer",
  });

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(state.generateCalls, 0, "legacy ModelRuntime.generate must not select or contact providers");
  assert.equal(provider.generateCalls, 1);
  assert.equal(result.data.routing?.selectedProviderId, "canonical-local");
  assert.equal(result.data.routing?.selectedModel, "qwen");
  assert.equal(result.data.routing?.candidates.length, 1);
  assert.equal(broker.requests.length, 1);
  assert.equal(broker.requests[0].agentId, "agent-1");
});

test("canonical streaming bypasses the legacy router and uses the same governed provider boundary", async () => {
  const broker = new FixedBroker(true);
  const { inner, state } = fakeRuntime();
  const provider = new CanonicalFakeProvider();
  const registry = new CanonicalProviderRegistry();
  registry.register(provider);
  const runtime = new GovernedModelRuntime(inner, broker, {
    providerRouter: new GovernedProviderRouter(new CapabilityProviderRouter(registry), broker),
  });
  const chunks: ModelStreamChunk[] = [];

  for await (const chunk of runtime.stream({ prompt: "hello", model: "qwen", metadata: { privacy: "local-only" } }, {
    missionId: "mission-1", taskId: "task-1", actor: "observer",
  })) chunks.push(chunk);

  assert.equal(state.streamCalls, 0, "legacy ModelRuntime.stream must not select or contact providers");
  assert.equal(provider.streamCalls, 1);
  assert.deepEqual(chunks.map((chunk) => [chunk.text, chunk.done]), [["ok", false], ["", true]]);
  assert.equal(broker.requests.length, 1);
});

class CanonicalFakeProvider implements QuackProviderV1 {
  generateCalls = 0;
  streamCalls = 0;

  metadata() {
    return {
      contractVersion: QUACK_CONTRACT_VERSION,
      providerId: "canonical-local",
      displayName: "Canonical Local",
      runtime: "fixture",
      boundary: "local",
      credentialEnvironmentVariables: [],
    } as const;
  }

  async health() {
    return { status: "HEALTHY", checkedAt: new Date().toISOString() } as const;
  }

  async discoverModels() {
    return [{
      id: "qwen",
      providerId: "canonical-local",
      runtime: "fixture",
      capabilities: [
        { capability: "text", level: "NATIVE" } satisfies ProviderCapabilitySupport,
        { capability: "streaming", level: "NATIVE" } satisfies ProviderCapabilitySupport,
      ],
    }];
  }

  async capabilities() {
    return [
      { capability: "text", level: "NATIVE" } satisfies ProviderCapabilitySupport,
      { capability: "streaming", level: "NATIVE" } satisfies ProviderCapabilitySupport,
    ];
  }

  async generate(request: { readonly model: string; readonly prompt: string }, context: ExecutionContextV1) {
    this.generateCalls += 1;
    return {
      executionId: context.executionId,
      providerId: "canonical-local",
      model: request.model,
      text: "ok",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, source: "provider" },
      latencyMs: 1,
    } as const;
  }

  async *stream(request: { readonly model: string; readonly prompt: string }, context: ExecutionContextV1) {
    this.streamCalls += 1;
    yield { executionId: context.executionId, providerId: "canonical-local", model: request.model, type: "TEXT_DELTA", text: "ok" } as const;
    yield { executionId: context.executionId, providerId: "canonical-local", model: request.model, type: "COMPLETED" } as const;
  }
}
