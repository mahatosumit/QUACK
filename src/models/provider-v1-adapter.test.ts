import assert from "node:assert/strict";
import test from "node:test";
import { QUACK_CONTRACT_VERSION, capabilitySupport, type ExecutionContextV1 } from "../contracts/index.js";
import { ok, type QuackResult } from "../core/types.js";
import { ModelProviderV1Bridge, SYSTEM_PROMPT_METADATA_KEY } from "./provider-v1-adapter.js";
import type { ModelInfo } from "./types.js";
import type { ModelProvider, ModelRequest, ModelResponse, ModelStreamChunk } from "./runtime.js";

const model: ModelInfo = {
  id: "fixture:model",
  name: "model",
  provider: "fixture",
  capabilities: ["reasoning", "embedding"],
  contextWindow: 16_384,
  supportsTools: true,
  latencyMs: 4,
  costPer1kInput: 0.01,
  costPer1kOutput: 0.02,
  status: "available",
};

const context: ExecutionContextV1 = {
  contractVersion: QUACK_CONTRACT_VERSION,
  missionId: "mission-1",
  taskId: "task-1",
  executionId: "execution-1",
  actor: "adapter-test",
};

test("ModelProviderV1Bridge preserves provider identity and reports only callable contract capabilities", async () => {
  const provider = new FakeModelProvider();
  const bridge = new ModelProviderV1Bridge(provider, {
    provider: "openai-compatible",
    id: "fixture",
    model: "model",
    baseUrl: "http://127.0.0.1:4141/v1",
    displayName: "Fixture Provider",
    credentialEnvironmentVariables: ["FIXTURE_API_KEY"],
  });

  assert.deepEqual(bridge.metadata(), {
    contractVersion: QUACK_CONTRACT_VERSION,
    providerId: "fixture",
    displayName: "Fixture Provider",
    runtime: "openai-compatible",
    boundary: "local",
    endpoint: "http://127.0.0.1:4141/v1",
    credentialEnvironmentVariables: ["FIXTURE_API_KEY"],
  });
  const discovered = await bridge.discoverModels();
  assert.equal(discovered[0]?.id, "model");
  const capabilities = discovered[0]?.capabilities ?? [];
  assert.equal(capabilitySupport(capabilities, "text").level, "NATIVE");
  assert.equal(capabilitySupport(capabilities, "reasoning").level, "NATIVE");
  assert.equal(capabilitySupport(capabilities, "cancellation").level, "UNSUPPORTED");
  assert.equal(capabilitySupport(capabilities, "embedding").level, "UNSUPPORTED");
});

test("ModelProviderV1Bridge forwards system prompts without leaking adapter metadata", async () => {
  const provider = new FakeModelProvider();
  const bridge = new ModelProviderV1Bridge(provider, { provider: "openai-compatible", id: "fixture", model: "model" });
  const response = await bridge.generate({
    model: "model",
    prompt: "hello",
    metadata: { [SYSTEM_PROMPT_METADATA_KEY]: "system policy", trace: "trace-1" },
  }, context);

  assert.equal(response.executionId, context.executionId);
  assert.equal(response.providerId, "fixture");
  assert.equal(provider.lastRequest?.system, "system policy");
  assert.deepEqual(provider.lastRequest?.metadata, { trace: "trace-1" });
});

test("ModelProviderV1Bridge emits one terminal stream event when the legacy provider omits it", async () => {
  const provider = new FakeModelProvider(false);
  const bridge = new ModelProviderV1Bridge(provider, { provider: "openai-compatible", id: "fixture", model: "model" });
  const events = [];
  for await (const event of bridge.stream({ model: "model", prompt: "hello" }, context)) events.push(event);

  assert.deepEqual(events.map((event) => event.type), ["TEXT_DELTA", "COMPLETED"]);
  assert.ok(events.every((event) => event.executionId === context.executionId));
});

class FakeModelProvider implements ModelProvider {
  readonly id = "fixture";
  readonly kind = "openai-compatible" as const;
  lastRequest?: ModelRequest & { readonly model: string };

  constructor(private readonly emitsDone = true) {}

  async listModels(): Promise<QuackResult<readonly ModelInfo[]>> {
    return ok([model]);
  }

  async generate(request: ModelRequest & { readonly model: string }): Promise<QuackResult<ModelResponse>> {
    this.lastRequest = request;
    return ok({
      id: "legacy-response",
      providerId: this.id,
      model: request.model,
      text: "ok",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      latencyMs: 1,
      fallbackUsed: false,
    });
  }

  async *stream(request: ModelRequest & { readonly model: string }): AsyncIterable<ModelStreamChunk> {
    this.lastRequest = request;
    yield { providerId: this.id, model: request.model, text: "ok", done: this.emitsDone };
  }
}
