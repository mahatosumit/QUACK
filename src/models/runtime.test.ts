import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId, fail, ok, type QuackResult } from "../core/types.js";
import { type ModelCapability } from "./types.js";
import { createQuackSystem } from "../distributions/swe-system.js";
import { Planner } from "../engine/planner.js";
import { ModelRegistry } from "./registry.js";
import {
  loadModelRuntimeConfig,
  ModelRuntime,
  OllamaModelProvider,
  OpenAICompatibleModelProvider,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type ModelStreamChunk,
} from "./runtime.js";

test("loadModelRuntimeConfig reads config/models.json shape", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quack-model-config-"));
  const file = join(dir, "models.json");
  await writeFile(file, JSON.stringify({
    provider: "ollama",
    model: "qwen3.6:27b",
    providers: [{ provider: "ollama", id: "local", model: "qwen3.6:27b", fallback: true }],
  }), "utf8");
  try {
    const config = loadModelRuntimeConfig(file);
    assert.equal(config.provider, "ollama");
    assert.equal(config.model, "qwen3.6:27b");
    assert.equal(config.providers[0].id, "local");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("OllamaModelProvider generates with token and latency tracking", async () => {
  const restore = mockFetch({
    model: "qwen3.6:27b",
    response: "hello",
    prompt_eval_count: 3,
    eval_count: 2,
    done_reason: "stop",
  });
  try {
    const provider = new OllamaModelProvider({ provider: "ollama", id: "ollama", model: "qwen3.6:27b" });
    const result = await provider.generate({ model: "qwen3.6:27b", prompt: "say hello" });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.text, "hello");
    assert.equal(result.data.usage.totalTokens, 5);
    assert.equal(result.data.providerId, "ollama");
    assert.ok(result.data.latencyMs >= 0);
  } finally {
    restore();
  }
});

test("OllamaModelProvider streams newline-delimited chunks", async () => {
  const restore = mockFetchStream([
    JSON.stringify({ model: "qwen3.6:27b", response: "hel", done: false }),
    JSON.stringify({ model: "qwen3.6:27b", response: "lo", done: true, prompt_eval_count: 3, eval_count: 2 }),
    "",
  ].join("\n"));
  try {
    const provider = new OllamaModelProvider({ provider: "ollama", id: "ollama", model: "qwen3.6:27b" });
    const chunks: ModelStreamChunk[] = [];
    for await (const chunk of provider.stream({ model: "qwen3.6:27b", prompt: "say hello" })) {
      chunks.push(chunk);
    }

    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].text, "hel");
    assert.equal(chunks[1].done, true);
    assert.equal(chunks[1].usage?.totalTokens, 5);
  } finally {
    restore();
  }
});

test("OpenAICompatibleModelProvider parses chat completions usage", async () => {
  const restore = mockFetch({
    model: "gpt-test",
    choices: [{ message: { content: "planned" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
  });
  try {
    const provider = new OpenAICompatibleModelProvider({
      provider: "openai-compatible",
      id: "openai",
      model: "gpt-test",
      apiKey: "test",
      baseUrl: "https://example.test/v1",
    });
    const result = await provider.generate({ model: "gpt-test", prompt: "plan" });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.text, "planned");
    assert.equal(result.data.usage.inputTokens, 4);
    assert.equal(result.data.usage.outputTokens, 6);
  } finally {
    restore();
  }
});

test("OpenAICompatibleModelProvider streams server-sent events", async () => {
  const restore = mockFetchStream([
    "data: {\"model\":\"gpt-test\",\"choices\":[{\"delta\":{\"content\":\"pla\"},\"finish_reason\":null}]}",
    "",
    "data: {\"model\":\"gpt-test\",\"choices\":[{\"delta\":{\"content\":\"nned\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":4,\"completion_tokens\":6,\"total_tokens\":10}}",
    "",
    "data: [DONE]",
    "",
  ].join("\n"));
  try {
    const provider = new OpenAICompatibleModelProvider({
      provider: "openai-compatible",
      id: "openai",
      model: "gpt-test",
      apiKey: "test",
      baseUrl: "https://example.test/v1",
    });
    const chunks: ModelStreamChunk[] = [];
    for await (const chunk of provider.stream({ model: "gpt-test", prompt: "plan" })) {
      chunks.push(chunk);
    }

    assert.equal(chunks.length, 2);
    assert.equal(chunks.map((chunk) => chunk.text).join(""), "planned");
    assert.equal(chunks[1].done, true);
    assert.equal(chunks[1].usage?.totalTokens, 10);
  } finally {
    restore();
  }
});

test("ModelRuntime falls back after provider failure", async () => {
  const registry = new ModelRegistry();
  registry.register(model("primary", "primary-model"));
  registry.register(model("fallback", "fallback-model"));
  const runtime = new ModelRuntime(registry, {
    provider: "openai-compatible",
    model: "primary-model",
    fallbackProviderId: "fallback",
    providers: [
      { provider: "openai-compatible", id: "primary", model: "primary-model" },
      { provider: "openai-compatible", id: "fallback", model: "fallback-model", fallback: true },
    ],
  }, [
    new FakeModelProvider("primary", false),
    new FakeModelProvider("fallback", true),
  ]);

  const result = await runtime.generate({ prompt: "hello", capability: "reasoning" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.providerId, "fallback");
  assert.equal(result.data.fallbackUsed, true);
  assert.equal(runtime.getFailures().length, 1);
});

test("ModelRuntime stream yields provider chunks", async () => {
  const registry = new ModelRegistry();
  registry.register(model("streamer", "stream-model"));
  const runtime = new ModelRuntime(registry, {
    provider: "openai-compatible",
    model: "stream-model",
    providers: [{ provider: "openai-compatible", id: "streamer", model: "stream-model" }],
  }, [new FakeModelProvider("streamer", true)]);

  const chunks: ModelStreamChunk[] = [];
  for await (const chunk of runtime.stream({ prompt: "stream", capability: "reasoning" })) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].done, true);
  assert.equal(chunks[0].text, "ok");
});

test("Planner records model selection metadata when model runtime is configured", () => {
  const registry = new ModelRegistry();
  registry.register(model("planner", "planner-model", ["coding"]));
  const runtime = new ModelRuntime(registry, {
    provider: "openai-compatible",
    model: "planner-model",
    providers: [{ provider: "openai-compatible", id: "planner", model: "planner-model" }],
  }, [new FakeModelProvider("planner", true)]);
  const planner = new Planner({
    defaultRetryPolicy: { maxRetries: 1, backoff: "fixed", baseDelayMs: 1, maxDelayMs: 1 },
    defaultTimeoutMs: 1000,
    maxNodesPerGraph: 10,
    modelRuntime: runtime,
  });

  const plan = planner.createPlan("implement coding change", "context");
  const selected = plan.taskGraph.metadata["selectedModel"];

  assert.equal(typeof selected, "object");
  assert.match(JSON.stringify(selected), /planner-model/);
});

test("createQuackSystem exposes modelRuntime without network access", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "quack-model-system-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const system = createQuackSystem({ workspaceRoot: root, dataDir: join(root, "state") });
  const selected = system.modelRuntime.selectModel({ capability: "reasoning" });

  assert.equal(selected.ok, true);
});

class FakeModelProvider implements ModelProvider {
  readonly kind = "openai-compatible" as const;

  constructor(readonly id: string, private readonly succeeds: boolean) {}

  async listModels() {
    return ok([model(this.id, `${this.id}-model`)]);
  }

  async generate(request: ModelRequest & { readonly model: string }): Promise<QuackResult<ModelResponse>> {
    if (!this.succeeds) {
      return fail({
        code: "model.fake_failed",
        message: `${this.id} failed`,
        category: "provider",
        recoverable: true,
      });
    }
    return ok({
      id: createId("model_response"),
      providerId: this.id,
      model: request.model,
      text: "ok",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      latencyMs: 1,
      fallbackUsed: false,
    });
  }

  async *stream(request: ModelRequest & { readonly model: string }) {
    yield {
      providerId: this.id,
      model: request.model,
      text: "ok",
      done: true,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    };
  }
}

function model(provider: string, name: string, capabilities: readonly ModelCapability[] = ["reasoning"]) {
  return {
    id: `${provider}:${name}`,
    name,
    provider,
    capabilities,
    contextWindow: 8192,
    supportsTools: false,
    latencyMs: 10,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    status: "available" as const,
  };
}

function mockFetch(body: unknown): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function mockFetchStream(body: string): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
